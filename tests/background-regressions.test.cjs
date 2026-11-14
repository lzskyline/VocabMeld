const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('API connection test preserves 403 status and server details', async () => {
  const source = fs.readFileSync('js/background.js', 'utf8');
  const start = source.indexOf('async function testApiConnection(');
  const end = source.indexOf('// 测试 Gemini API 连接', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    isGeminiApi: () => false,
    fetch: async () => ({
      ok: false, status: 403,
      json: async () => ({ error: { message: 'forbidden' } })
    })
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.testConnection = testApiConnection;', context);
  const result = await context.testConnection('https://api.example', 'key', 'model');
  assert.equal(result.success, false);
  assert.equal(result.status, 403);
  assert.equal(result.message, 'HTTP 403: forbidden');
});
