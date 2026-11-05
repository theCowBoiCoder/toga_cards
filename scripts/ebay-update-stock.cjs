// Run inside the app container. Dry-run by default; --apply changes eBay quantities.
// Only already-matched, active, single-card fixed-price listings are eligible.
const crypto = require('node:crypto');
const Database = require('/app/.output/server/node_modules/better-sqlite3');

(async () => {
  const { XMLParser } = await import('/app/.output/server/node_modules/fast-xml-parser/src/fxp.js');
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true });
  const db = new Database('/app/data/cards.sqlite', { readonly: true });
  const setting = name => db.prepare('SELECT value FROM ebay_settings WHERE key=?').get(name)?.value || '';
  if (setting('stockSyncEnabled') === 'true') throw new Error('Automatic stock sync is active. Use the admin stock controls instead of this legacy script.');
  if (setting('accountDeleted') || setting('lastError') || setting('notificationError')) throw new Error('Resolve connection errors before updating stock.');
  if (Date.now() - Date.parse(setting('lastSync')) > 120000 || !setting('lastSync')) throw new Error('Run a successful sync immediately before this command.');
  const raw = Buffer.from(setting('tokens'), 'base64');
  const cipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.EBAY_TOKEN_KEY, 'hex'), raw.subarray(0, 12));
  cipher.setAuthTag(raw.subarray(12, 28));
  const tokens = JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString());
  if (tokens.expiresAt < Date.now() + 300000) throw new Error('Refresh the seller connection before this command.');
  const records = db.prepare('SELECT l.key,l.payload,m.card_id FROM ebay_listings l JOIN ebay_mappings m ON m.key=l.key WHERE l.active=1').all()
    .map(r => ({ ...JSON.parse(r.payload), cardId: r.card_id }));
  const stock = id => db.prepare('SELECT COALESCE((SELECT SUM(quantity) FROM movements WHERE card_id=?),0)-COALESCE((SELECT SUM(quantity) FROM sales WHERE card_id=?),0) quantity').get(id, id).quantity;
  const esc = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  async function call(name, body) {
    const response = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST', headers: { 'Content-Type': 'text/xml', 'X-EBAY-API-CALL-NAME': name, 'X-EBAY-API-SITEID': '3', 'X-EBAY-API-COMPATIBILITY-LEVEL': '1477', 'X-EBAY-API-IAF-TOKEN': tokens.access_token },
      body: `<?xml version="1.0"?><${name}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${name}Request>`, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = parser.parse(await response.text())[`${name}Response`];
    if (!value || !['Success', 'Warning'].includes(value.Ack)) {
      const errors = Array.isArray(value?.Errors) ? value.Errors : [value?.Errors];
      throw new Error(`eBay error ${errors.map(e => e?.ErrorCode || 'unknown').join(',')}`);
    }
    return value;
  }
  const getItem = async id => (await call('GetItem', `<ItemID>${esc(id)}</ItemID>`)).Item;
  const available = item => Number(item.Quantity) - Number(item.SellingStatus?.QuantitySold || 0);
  let updated = 0, additional = 0, skipped = 0;
  for (const listing of records) {
    const allocated = db.prepare("SELECT quantity FROM shop_listings WHERE card_id=?").get(listing.cardId)?.quantity || 0;
    const target = Math.max(0, stock(listing.cardId) - allocated);
    if (target <= listing.available) continue;
    const result = { itemId: listing.itemId, cardId: listing.cardId, previous: listing.available, target };
    if (records.filter(r => r.cardId === listing.cardId).length !== 1) {
      skipped++; console.log(JSON.stringify({ ...result, status: 'skipped', reason: 'Multiple listings share this stock' })); continue;
    }
    if (listing.variation) { skipped++; console.log(JSON.stringify({ ...result, status: 'skipped', reason: 'Variation requires separate allocation' })); continue; }
    try {
      const item = await getItem(listing.itemId);
      if (item.ListingType !== 'FixedPriceItem' || item.Variations || item.SellingStatus?.ListingStatus !== 'Active') throw new Error('Not an active single-card fixed-price listing');
      if (available(item) !== listing.available) throw new Error('Live quantity changed; resync first');
      if (stock(listing.cardId) - (db.prepare("SELECT quantity FROM shop_listings WHERE card_id=?").get(listing.cardId)?.quantity || 0) !== target || setting('accountDeleted') || setting('notificationError')) throw new Error('Local state changed');
      const mapping = db.prepare('SELECT card_id FROM ebay_mappings WHERE key=?').get(listing.key);
      if (mapping?.card_id !== listing.cardId) throw new Error('Mapping changed');
      if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ ...result, status: 'planned' })); continue; }
      // Absolute AVAILABLE quantity: no price, title, shipping or policy fields sent.
      await call('ReviseInventoryStatus', `<InventoryStatus><ItemID>${esc(listing.itemId)}</ItemID><Quantity>${target}</Quantity></InventoryStatus>`);
      const after = await getItem(listing.itemId);
      if (available(after) !== target) throw new Error('Verification differs; check live listing before retry');
      updated++; additional += target - listing.available;
      console.log(JSON.stringify({ ...result, status: 'verified' }));
    } catch (error) {
      console.log(JSON.stringify({ ...result, status: 'needs-review', reason: /^HTTP |^eBay error |^Not an |^Live quantity|^Local state|^Mapping changed|^Verification/.test(error.message) ? error.message : 'Request outcome uncertain; inspect live quantity before retrying' }));
      // Stop on uncertain outcomes rather than risking a series of blind writes.
      db.close(); process.exitCode = 1; return;
    }
  }
  console.log(JSON.stringify({ summary: true, applied: process.argv.includes('--apply'), updated, additional, skipped }));
  db.close();
})().catch(error => { console.error('Stock update stopped: ' + (/^Resolve |^Run a |^Refresh /.test(error.message) ? error.message : 'Check configuration; no automatic retry.')); process.exitCode = 1; });
