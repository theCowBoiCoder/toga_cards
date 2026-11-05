import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createCipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeNotificationBatch, verifyNotification } from '../server/utils/ebay-notifications';
import { createInventory } from '../server/utils/inventory';
import { listingKey } from '../server/utils/ebay-store';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const secret = 'a'.repeat(64);
const raw = JSON.stringify({ metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION', schemaVersion: '1.0' }, notification: { notificationId: 'synthetic', data: { eiasToken: 'synthetic-seller' } } });
const header = Buffer.from(JSON.stringify({ kid: 'test-key', signature: sign('sha1', Buffer.from(raw), privateKey).toString('base64') })).toString('base64');
function row(body = raw, signature = header) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify({ raw: body, signature })), cipher.final(), cipher.getAuthTag()]);
  return { id: 'b'.repeat(64), envelope: JSON.stringify({ iv: iv.toString('hex'), ciphertext: bytes.toString('hex') }) };
}
test('real ECC signatures verify; altered payloads and malformed headers do not', async () => {
  assert.equal(await verifyNotification(raw, header, async () => pem), true);
  assert.equal(await verifyNotification(raw.replace('synthetic-seller', 'attacker'), header, async () => pem), false);
  assert.equal(await verifyNotification(raw, 'invalid', async () => pem), false);
});
test('queue processing verifies before acting, and retries key retrieval and processing failures without acknowledgement', async () => {
  let processed = 0, acknowledged = 0;
  const deps = { secret, getKey: async () => pem, process: () => { processed++; }, acknowledge: async () => { acknowledged++; } };
  await assert.rejects(consumeNotificationBatch([row()], { ...deps, getKey: async () => { throw new Error('network'); } }));
  assert.equal(processed, 0); assert.equal(acknowledged, 0);
  await assert.rejects(consumeNotificationBatch([row()], { ...deps, process: () => { throw new Error('database busy'); } }));
  assert.equal(acknowledged, 0);
  await consumeNotificationBatch([row()], deps);
  assert.equal(processed, 1); assert.equal(acknowledged, 1);
  await consumeNotificationBatch([row(raw.replace('synthetic-seller', 'attacker'))], deps);
  assert.equal(processed, 1); assert.equal(acknowledged, 2);
});
test('envelope tampering cannot acknowledge or process a notification', async () => {
  let calls = 0;
  await assert.rejects(consumeNotificationBatch([row()], { secret: 'c'.repeat(64), getKey: async () => pem, process: () => { calls++; }, acknowledge: async () => { calls++; } }));
  assert.equal(calls, 0);
});
test('seller deletion erases imported records, preserves stock and costs, survives reopen and replay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toga-deletion-'));
  let inv = createInventory(join(dir, 'test.sqlite'));
  try {
    inv.mutate({ action: 'card', player: 'Test', club: 'Test', season: '2026/27', collection: 'Test', number: '1', variant: 'Base', condition: 'Mint', quantity: 5, unitCost: 100, date: '2026-09-08' });
    inv.ebay.setSetting('seller', 'synthetic'); inv.ebay.setSetting('sellerEias', 'synthetic-seller'); inv.ebay.setSetting('tokens', 'synthetic-token');
    const key = listingKey('item', 'sku');
    inv.ebay.ingest([{ key, itemId: 'item', sku: 'sku', title: 'Test', available: 4, variation: '' }], [{ key: 'order', orderId: 'external-order', itemId: 'item', sku: 'sku', title: 'Test', quantity: 1, gross: 500, currency: 'GBP', created: new Date().toISOString(), paid: true, cancelled: false, variation: '' }], new Date().toISOString());
    inv.ebay.mapListing(key, 1); inv.ebay.reviewOrder('order', 'apply', 50);
    const before = inv.snapshot().cards;
    inv.ebay.processAccountDeletion({ eiasToken: 'unrelated' });
    assert.equal(inv.snapshot().sales.length, 1);
    inv.ebay.processAccountDeletion({ eiasToken: 'synthetic-seller' });
    assert.deepEqual(inv.snapshot().cards, before);
    assert.equal(inv.snapshot().sales.length, 0);
    assert.equal(inv.ebay.snapshot().orders.length, 0);
    assert.equal(inv.ebay.snapshot().listings.length, 0);
    assert.equal(inv.ebay.setting('tokens'), ''); assert.equal(inv.ebay.setting('sellerEias'), '');
    inv.close(); inv = createInventory(join(dir, 'test.sqlite'));
    inv.ebay.processAccountDeletion({ eiasToken: 'synthetic-seller' });
    assert.deepEqual(inv.snapshot().cards, before);
    assert.throws(() => inv.ebay.ingest([], [], new Date().toISOString()), /deleted/);
  } finally { inv.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('missing seller identity blocks acknowledgement rather than guessing', () => {
  const inv = createInventory(':memory:');
  try {
    inv.ebay.setSetting('seller', 'legacy');
    assert.throws(() => inv.ebay.processAccountDeletion({ eiasToken: 'unknown' }), /identity/);
  } finally { inv.close(); }
});
