const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/options.js', 'utf8');

function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source section: ${start}`);
  return source.slice(first, last);
}

test('endpoint card escapes imported IDs and names', () => {
  const list = { innerHTML: '' };
  const context = {
    apiEndpoints: [{ id: 'x" onmouseover="alert(1)', name: '<img src=x>', qpm: 10, enabled: true }],
    elements: { endpointsList: list },
    chrome: { storage: { local: { get: (key, callback) => callback({}) } } },
    bindEndpointCardEvents() {}
  };
  const escaper = section('  function escapeHtml(', '  // 当前节点配置状态');
  const render = section('  function renderEndpointsList(', '  // 绑定节点卡片事件');
  vm.runInNewContext(escaper + render + '\nrenderEndpointsList();', context);
  assert.equal((list.innerHTML.match(/data-id="x&quot; onmouseover=&quot;alert\(1\)"/g) || []).length, 3);
  assert.match(list.innerHTML, /&lt;img src=x&gt;/);
  assert.doesNotMatch(list.innerHTML, /<img src=x>/);
});

test('settings export preserves endpoints and requires opt-in for all API keys', async () => {
  const handlerSource = section('    async function collectBackupData()', '    // 导出数据');
  async function exportSettings(syncData, includeKeys) {
    const context = {
      elements: {
        exportSettings: { checked: true }, exportApiKeys: { checked: includeKeys },
        exportWords: { checked: false }, exportStats: { checked: false }, exportCache: { checked: false }
      },
      chrome: { storage: { sync: { get: async () => syncData } } },
      Date
    };
    vm.runInNewContext(handlerSource + '\nthis.collect = collectBackupData;', context);
    return JSON.parse(JSON.stringify((await context.collect()).settings));
  }
  const syncData = {
    apiKey: 'single-secret',
    apiEndpoints: [
      { id: 'one', endpoint: 'https://one.example', apiKey: 'first-secret', enabled: true },
      { id: 'two', endpoint: 'https://two.example', apiKey: 'second-secret', enabled: false }
    ],
    apiConfigs: { old: { apiKey: 'legacy-secret', model: 'old-model' } }
  };
  const redacted = await exportSettings(syncData, false);
  assert.deepEqual(redacted.apiEndpoints.map(ep => [ep.id, ep.apiKey]), [['one', ''], ['two', '']]);
  assert.equal(redacted.apiKey, '');
  assert.equal(redacted.apiConfigs.old.apiKey, '');
  assert.equal(redacted.apiConfigs.old.model, 'old-model');
  assert.doesNotMatch(JSON.stringify(redacted), /secret/);
  const full = await exportSettings(syncData, true);
  assert.deepEqual(full.apiEndpoints, syncData.apiEndpoints);
  assert.deepEqual(full.apiConfigs, syncData.apiConfigs);
  assert.equal(full.apiKey, syncData.apiKey);
  assert.equal('apiEndpoints' in await exportSettings({}, false), false);
});

test('WebDAV uses HTTPS, explicit credentials and refuses unsafe URLs and HTTP failures', async () => {
  const calls = [];
  const context = {
    elements: {
      webdavUrl: { value: 'https://dav.example/backups/data.json' },
      webdavUsername: { value: '用户' },
      webdavPassword: { value: 'secret' }
    },
    URL, TextEncoder, btoa,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 201 };
    }
  };
  const request = section('    async function webdavRequest(', '    elements.webdavUpload.addEventListener');
  vm.runInNewContext(request + '\nthis.request = webdavRequest;', context);
  await context.request('PUT', '{"version":"1.0"}');
  assert.equal(calls[0].url, 'https://dav.example/backups/data.json');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(Buffer.from(calls[0].options.headers.Authorization.slice(6), 'base64').toString(), '用户:secret');
  await context.request('GET');
  assert.equal(calls[1].options.method, 'GET');
  for (const url of [
    'http://dav.example/data.json', 'https://user:pass@dav.example/data.json',
    'https://dav.example/data.json?token=secret', 'https://dav.example/data.json#fragment',
    'https://dav.example/directory/'
  ]) {
    context.elements.webdavUrl.value = url;
    await assert.rejects(context.request('GET'), /HTTPS/);
  }
  context.elements.webdavUrl.value = 'https://dav.example/data.json';
  context.fetch = async () => ({ ok: false, status: 401 });
  await assert.rejects(context.request('GET'), /HTTP 401/);
});

test('backup restore validates input, removes duplicate cache entries, and surfaces storage errors', async () => {
  const writes = [];
  const context = {
    chrome: { storage: {
      sync: { set: async value => writes.push(['sync', value]) },
      local: { set: async value => writes.push(['local', value]) }
    } }
  };
  const restore = section('    async function restoreBackupData(', '    async function webdavRequest(');
  vm.runInNewContext(restore + '\nthis.restore = restoreBackupData;', context);
  await assert.rejects(context.restore({ version: '1.0', cache: {} }), /格式/);
  assert.equal(writes.length, 0);
  await context.restore({
    version: '0.9', settings: JSON.parse('{"theme":"dark","__proto__":{"polluted":true},"unrelated":"ignore"}'),
    cache: [{ key: 'one', value: 1 }, { key: 'one', value: 2 }]
  });
  assert.equal(writes[0][1].theme, 'dark');
  assert.equal(Object.hasOwn(writes[0][1], '__proto__'), false);
  assert.equal(Object.hasOwn(writes[0][1], 'unrelated'), false);
  assert.equal(writes[1][1].vocabmeld_word_cache.length, 1);
  context.chrome.storage.sync.set = async () => { throw new Error('quota exceeded'); };
  await assert.rejects(context.restore({ version: '1.0', settings: { theme: 'light' } }), /quota exceeded/);
});

test('connection test explains 403 without implying every 403 has the same cause', async () => {
  const context = {
    elements: {
      endpointUrl: { value: 'https://api.example/v1/chat/completions' },
      endpointApiKey: { value: 'test-key' },
      endpointModel: { value: 'model' },
      testEndpointBtn: {},
      testEndpointResult: {}
    },
    chrome: { runtime: {
      getURL: () => 'chrome-extension://example/',
      sendMessage: (request, callback) => callback({ success: false, status: 403, message: 'HTTP 403' })
    } },
    showGlobalToast() {},
    showEndpointToast() {}
  };
  const handler = section('  async function testEndpointConnection(', '  // 显示全局提示');
  vm.runInNewContext(handler + '\nthis.testConnection = testEndpointConnection;', context);
  await context.testConnection();
  assert.match(context.elements.testEndpointResult.textContent, /chrome-extension:\/\/example/);
  assert.match(context.elements.testEndpointResult.textContent, /密钥权限/);
  assert.equal(context.elements.testEndpointBtn.disabled, false);
});
