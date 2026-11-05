// Paste this entire file into the Cloudflare Worker editor.
// Setup instructions: docs/cloudflare-ebay.md
const encoder = new TextEncoder();
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const json = (value, status = 200) => Response.json(value, { status, headers });
const hex = (buffer) => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
const digest = async (text) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

async function authorised(request, secret) {
  const supplied = request.headers.get('Authorization') || '';
  if (supplied.length > 200) return false;
  const expected = await digest(`Bearer ${secret}`);
  const actual = await digest(supplied);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}

async function encrypt(text, secret) {
  const key = await crypto.subtle.importKey('raw',
    Uint8Array.from(secret.match(/../g), byte => parseInt(byte, 16)),
    'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text));
  // Web Crypto appends its 16-byte authentication tag to the ciphertext.
  return JSON.stringify({ iv: hex(iv), ciphertext: hex(ciphertext) });
}

async function boundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Empty body');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) { await reader.cancel(); throw new Error('Body too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/' && request.method === 'GET') {
        return json({ service: 'TOGA eBay notification relay', status: 'Setup required; see local deployment guide.' });
      }

      // Fixed destination: never accept a caller-supplied redirect URL.
      if (url.pathname === '/api/ebay/callback' && request.method === 'GET') {
        const state = url.searchParams.get('state') || '';
        if (!/^[a-f0-9]{64}$/.test(state)) return json({ error: 'Invalid state' }, 400);
        const target = new URL('http://127.0.0.1:3000/api/ebay/callback');
        target.searchParams.set('state', state);
        for (const name of ['code', 'error']) {
          const value = url.searchParams.get(name);
          if (value && value.length <= 8192) target.searchParams.set(name, value);
        }
        if (!target.searchParams.has('code') && !target.searchParams.has('error')) return json({ error: 'Missing OAuth result' }, 400);
        return new Response(null, { status: 302, headers: { ...headers, Location: target.href } });
      }

      if (!['/api/ebay/deletion', '/queue'].includes(url.pathname) && !/^\/queue\/[a-f0-9]{64}$/.test(url.pathname)) {
        return json({ error: 'Not found' }, 404);
      }
      // Do not enable eBay subscription until its local consumer is installed and tested.
      if (!env.DB || !/^[a-f0-9]{64}$/.test(env.RELAY_SECRET || '') ||
          !/^[A-Za-z0-9_-]{32,80}$/.test(env.VERIFICATION_TOKEN || '') || env.PROCESSING_READY !== 'true') {
        return json({ error: 'Notification setup is not complete' }, 503);
      }

      if (url.pathname === '/api/ebay/deletion' && request.method === 'GET') {
        const challenge = url.searchParams.get('challenge_code');
        if (!challenge || challenge.length > 4096) return json({ error: 'Missing or invalid challenge' }, 400);
        return json({ challengeResponse: await digest(challenge + env.VERIFICATION_TOKEN + url.origin + url.pathname) });
      }

      const isQueue = url.pathname.startsWith('/queue');
      if (isQueue && !await authorised(request, env.RELAY_SECRET)) return json({ error: 'Unauthorized' }, 401);
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, received_at TEXT NOT NULL)').run();

      if (url.pathname === '/api/ebay/deletion' && request.method === 'POST') {
        let raw, signature;
        try {
          signature = request.headers.get('x-ebay-signature');
          if (!signature || signature.length > 8192) throw new Error('Missing signature');
          raw = await boundedBody(request);
          const payload = JSON.parse(raw);
          if (payload.metadata?.topic !== 'MARKETPLACE_ACCOUNT_DELETION' ||
              typeof payload.notification?.notificationId !== 'string' || !payload.notification?.data) throw new Error('Invalid notification');
        } catch { return json({ error: 'Invalid notification' }, 400); }
        // Preserve exact signed bytes. The local consumer MUST verify eBay's
        // signature before taking action. Receipt alone does not establish trust.
        const id = await digest(JSON.stringify([signature, raw]));
        const envelope = await encrypt(JSON.stringify({ signature, raw }), env.RELAY_SECRET);
        const result = await env.DB.prepare('INSERT OR IGNORE INTO notifications (id,envelope,received_at) VALUES (?,?,?)')
          .bind(id, envelope, new Date().toISOString()).run();
        if (!result.success) throw new Error('Storage failed');
        return new Response(null, { status: 204, headers });
      }
      if (url.pathname === '/queue' && request.method === 'GET') {
        const result = await env.DB.prepare('SELECT id,envelope,received_at FROM notifications ORDER BY received_at,id LIMIT 50').all();
        if (!result.success) throw new Error('Storage failed');
        return json({ notifications: result.results });
      }
      if (/^\/queue\/[a-f0-9]{64}$/.test(url.pathname) && request.method === 'DELETE') {
        const result = await env.DB.prepare('DELETE FROM notifications WHERE id=?').bind(url.pathname.split('/')[2]).run();
        if (!result.success) throw new Error('Storage failed');
        return new Response(null, { status: 204, headers });
      }
      return json({ error: 'Method not allowed' }, 405);
    } catch {
      // No bodies, OAuth codes, tokens or personal data in application logs.
      return json({ error: 'Service unavailable; retry later' }, 503);
    }
  },
};
