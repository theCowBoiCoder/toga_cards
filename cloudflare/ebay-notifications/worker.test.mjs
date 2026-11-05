import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createDecipheriv } from 'node:crypto';
import worker from './worker.mjs';

const secret = 'a'.repeat(64);
const base = 'https://test.workers.dev';
function environment() {
  const rows = new Map();
  return {
    rows, RELAY_SECRET: secret, VERIFICATION_TOKEN: 'v'.repeat(40), PROCESSING_READY: 'true',
    DB: { prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async run() {
          if (sql.startsWith('INSERT') && !rows.has(values[0])) rows.set(values[0], { id: values[0], envelope: values[1], received_at: values[2] });
          if (sql.startsWith('DELETE')) rows.delete(values[0]);
          return { success: true };
        },
        async all() { return { success: true, results: [...rows.values()] }; },
      };
    } },
  };
}
const call = (path, env, options) => worker.fetch(new Request(base + path, options), env);
test('staged deployment cannot activate the notification subscription', async () => {
  assert.equal((await call('/api/ebay/deletion?challenge_code=123', {})).status, 503);
});
test('challenge uses exact endpoint and required hash order', async () => {
  const env = environment();
  const response = await call('/api/ebay/deletion?challenge_code=123', env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challengeResponse: createHash('sha256').update('123' + env.VERIFICATION_TOKEN + base + '/api/ebay/deletion').digest('hex') });
});
test('durable queue encrypts exact payload, deduplicates and requires authentication', async () => {
  const env = environment();
  const raw = JSON.stringify({ metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' }, notification: { notificationId: 'test', data: { username: 'synthetic' } } });
  const options = { method: 'POST', body: raw, headers: { 'x-ebay-signature': 'signature-awaiting-local-verification' } };
  assert.equal((await call('/api/ebay/deletion', env, options)).status, 204);
  assert.equal((await call('/api/ebay/deletion', env, options)).status, 204);
  assert.equal(env.rows.size, 1);
  assert.equal((await call('/queue', env)).status, 401);
  const authorization = { Authorization: `Bearer ${secret}` };
  const response = await call('/queue', env, { headers: authorization });
  const { notifications: [row] } = await response.json();
  assert.ok(!row.envelope.includes('synthetic'));
  const encrypted = JSON.parse(row.envelope);
  const data = Buffer.from(encrypted.ciphertext, 'hex');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), Buffer.from(encrypted.iv, 'hex'));
  cipher.setAuthTag(data.subarray(-16));
  const decoded = JSON.parse(Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]).toString());
  assert.equal(decoded.raw, raw);
  assert.equal(decoded.signature, options.headers['x-ebay-signature']);
  assert.equal((await call('/queue/' + row.id, env, { method: 'DELETE' })).status, 401);
  assert.equal(env.rows.size, 1);
  assert.equal((await call('/queue/' + row.id, env, { method: 'DELETE', headers: authorization })).status, 204);
  assert.equal(env.rows.size, 0);
});
test('storage failure is not acknowledged', async () => {
  const env = environment();
  env.DB.prepare = () => { throw new Error('offline'); };
  assert.equal((await call('/api/ebay/deletion', env, { method: 'POST' })).status, 503);
});
test('missing signatures and oversized bodies are rejected', async () => {
  assert.equal((await call('/api/ebay/deletion', environment(), { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await call('/api/ebay/deletion', environment(), { method: 'POST', body: 'x'.repeat(32769), headers: { 'x-ebay-signature': 'x' } })).status, 400);
});
test('OAuth relay only redirects to fixed local callback and preserves state', async () => {
  const state = 'b'.repeat(64);
  const response = await call('/api/ebay/callback?state=' + state + '&code=test%2Bcode&redirect_uri=https://evil.example', {});
  const location = new URL(response.headers.get('Location'));
  assert.equal(location.origin, 'http://127.0.0.1:3000');
  assert.equal(location.searchParams.get('code'), 'test+code');
  assert.equal(location.searchParams.get('state'), state);
  assert.equal(location.searchParams.has('redirect_uri'), false);
  assert.equal((await call('/api/ebay/callback?code=test', {})).status, 400);
});
