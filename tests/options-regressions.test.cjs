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
  const handlerSource = section("    elements.exportDataBtn.addEventListener('click', async () => {", '    // 导入数据');
  async function exportSettings(syncData, includeKeys) {
    let handler, blob;
    const context = {
      elements: {
        exportDataBtn: { addEventListener: (event, fn) => { handler = fn; } },
        exportSettings: { checked: true }, exportApiKeys: { checked: includeKeys },
        exportWords: { checked: false }, exportStats: { checked: false }, exportCache: { checked: false }
      },
      chrome: { storage: { sync: { get: (keys, callback) => callback(syncData) } } },
      Blob, URL: { createObjectURL: value => { blob = value; return 'blob:test'; }, revokeObjectURL() {} },
      document: { createElement: () => ({ click() {} }) }, Date
    };
    vm.runInNewContext(handlerSource, context);
    await handler();
    return JSON.parse(await blob.text()).settings;
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
