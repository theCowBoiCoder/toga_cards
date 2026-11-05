import { createDecipheriv, createPublicKey, verify } from 'node:crypto';
import { getInventory } from './inventory';

export function decryptNotification(envelope: string, secret: string) {
  const value = JSON.parse(envelope);
  if (!/^[a-f0-9]{24}$/.test(value.iv) || !/^[a-f0-9]{32,200000}$/.test(value.ciphertext) || value.ciphertext.length % 2) throw new Error('Invalid envelope');
  const bytes = Buffer.from(value.ciphertext, 'hex');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), Buffer.from(value.iv, 'hex'));
  cipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]).toString('utf8'));
}

export async function verifyNotification(raw: string, header: string, getKey: (id: string) => Promise<string>) {
  let signature: any;
  try {
    signature = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(signature.kid) || typeof signature.signature !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(signature.signature)) return false;
    JSON.parse(raw);
  } catch { return false; }
  // Retrieval failure is retryable, not evidence that a message is forged.
  const key = createPublicKey(await getKey(signature.kid));
  if (key.asymmetricKeyType !== 'ec') throw new Error('Unsupported notification key');
  const bytes = Buffer.from(signature.signature, 'base64');
  // The official eBay event SDK uses SHA-1 ECDSA and JSON.stringify(message).
  return verify('sha1', Buffer.from(raw), key, bytes) || verify('sha1', Buffer.from(JSON.stringify(JSON.parse(raw))), key, bytes);
}

let appToken = { value: '', expires: 0 };
const keys = new Map<string, { value: string; expires: number }>();
async function publicKey(id: string) {
  const cached = keys.get(id);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (appToken.expires < Date.now()) {
    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Cannot obtain verification token');
    const result = await response.json();
    if (!result.access_token || !Number.isFinite(result.expires_in)) throw new Error('Invalid application token');
    appToken = { value: result.access_token, expires: Date.now() + (result.expires_in - 120) * 1000 };
  }
  const response = await fetch(`https://api.ebay.com/commerce/notification/v1/public_key/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${appToken.value}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) { if (response.status === 401) appToken.expires = 0; throw new Error('Cannot retrieve notification public key'); }
  const result = await response.json();
  if (typeof result.key !== 'string') throw new Error('Invalid public key');
  const value = result.key.replace(/-----BEGIN PUBLIC KEY-----\s*/, '-----BEGIN PUBLIC KEY-----\n').replace(/\s*-----END PUBLIC KEY-----/, '\n-----END PUBLIC KEY-----');
  if (keys.size >= 100) keys.delete(keys.keys().next().value!);
  keys.set(id, { value, expires: Date.now() + 3600000 });
  return value;
}

export async function consumeNotificationBatch(rows: any[], dependencies: {
  secret: string; getKey: (id: string) => Promise<string>; process: (data: any) => void; acknowledge: (id: string) => Promise<void>;
}) {
  for (const row of rows) {
    if (!/^[a-f0-9]{64}$/.test(row.id)) throw new Error('Invalid queue row');
    const { raw, signature } = decryptNotification(row.envelope, dependencies.secret);
    if (typeof raw !== 'string' || typeof signature !== 'string') throw new Error('Invalid message');
    if (await verifyNotification(raw, signature, dependencies.getKey)) {
      const value = JSON.parse(raw);
      if (value.metadata?.topic !== 'MARKETPLACE_ACCOUNT_DELETION' || value.metadata?.schemaVersion !== '1.0' || !value.notification?.data || !value.notification?.notificationId) throw new Error('Unsupported notification schema');
      dependencies.process(value.notification.data);
    }
    await dependencies.acknowledge(row.id);
  }
}

let running: Promise<void> | undefined;
export function pollEbayNotifications(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const store = getInventory().ebay;
    try {
      const origin = new URL(process.env.EBAY_RELAY_URL || '');
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid relay origin');
      const secret = process.env.EBAY_RELAY_SECRET || '';
      if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Missing relay secret');
      const request = async (path: string, method = 'GET') => {
        const response = await fetch(new URL(path, origin), { method, headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Relay unavailable');
        return response;
      };
      for (let page = 0; page < 20; page++) {
        const result = await (await request('/queue')).json();
        if (!Array.isArray(result.notifications) || result.notifications.length > 50) throw new Error('Invalid relay response');
        store.setSetting('notificationOldest', result.notifications[0]?.received_at || '');
        if (!result.notifications.length) {
          store.setSetting('notificationLastCheck', new Date().toISOString());
          store.setSetting('notificationError', '');
          return;
        }
        await consumeNotificationBatch(result.notifications, { secret, getKey: publicKey, process: data => store.processAccountDeletion(data), acknowledge: async id => { await request(`/queue/${id}`, 'DELETE'); } });
      }
      throw new Error('Notification backlog');
    } catch {
      const message = 'eBay notification checks need attention. Verify Cloudflare setup and active eBay keys; pending messages will retry. Stock imports are paused.';
      store.setSetting('notificationError', message);
      throw new Error(message);
    }
  })();
  return running.finally(() => { running = undefined; });
}
