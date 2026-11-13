import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { combinedPostage, type ShippingBand } from "../../shared/shipping";

export function createShippingStore(db: Database.Database) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS shop_shipping_options (id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL, min_days INTEGER, max_days INTEGER, enabled INTEGER NOT NULL DEFAULT 1)`,
  );
  const columns = new Set((db.prepare("PRAGMA table_info(shop_shipping_options)").all() as any[]).map(column => column.name));
  if (!columns.has("packaging")) db.exec("ALTER TABLE shop_shipping_options ADD COLUMN packaging INTEGER NOT NULL DEFAULT 0");
  if (!columns.has("bands")) db.exec("ALTER TABLE shop_shipping_options ADD COLUMN bands TEXT NOT NULL DEFAULT '[]'");
  const all = () =>
    db
      .prepare("SELECT * FROM shop_shipping_options ORDER BY price,name,id")
      .all().map((row: any) => ({ ...row, bands: JSON.parse(row.bands) })) as any[];
  const available = () => all().filter((option) => option.enabled === 1);
  const save = db.transaction((body: any) => {
    const id = body.id || randomUUID();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (
      typeof id !== "string" ||
      id.length > 100 ||
      !name ||
      name.length > 80 ||
      !Number.isSafeInteger(body.price) ||
      body.price < 0 ||
      body.price > 1000000
    )
      throw new Error("Enter a delivery name and a valid price.");
    const min = body.minDays == null ? null : body.minDays,
      max = body.maxDays == null ? null : body.maxDays;
    if (
      (min === null) !== (max === null) ||
      (min !== null &&
        (!Number.isSafeInteger(min) ||
          !Number.isSafeInteger(max) ||
          min < 1 ||
          max < min ||
          max > 60))
    )
      throw new Error(
        "Enter both delivery estimates, between 1 and 60 working days, or leave both blank.",
      );
    if (typeof body.enabled !== "boolean")
      throw new Error("Choose whether this delivery option is enabled.");
    const packaging = body.packaging ?? 0;
    const bands: ShippingBand[] = body.bands ?? [];
    if (!Number.isSafeInteger(packaging) || packaging < 0 || packaging > 1000000 ||
        !Array.isArray(bands) || bands.length > 20)
      throw new Error("Enter a valid packaging allowance and up to 20 postage bands.");
    let previous = 0;
    for (const band of bands) {
      if (!band || !Number.isSafeInteger(band.upToCards) || band.upToCards <= previous || band.upToCards > 1000000 ||
          !Number.isSafeInteger(band.price) || band.price < 0 || band.price > 1000000)
        throw new Error("Postage bands must have increasing card limits and valid prices.");
      previous = band.upToCards;
    }
    db.prepare(
      "INSERT INTO shop_shipping_options (id,name,price,min_days,max_days,enabled,packaging,bands) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price=excluded.price,min_days=excluded.min_days,max_days=excluded.max_days,enabled=excluded.enabled,packaging=excluded.packaging,bands=excluded.bands",
    ).run(id, name, bands[0]?.price ?? body.price, min, max, body.enabled ? 1 : 0, packaging, JSON.stringify(bands.map(band => ({ upToCards: band.upToCards, price: band.price }))));
    return { id };
  });
  function select(id: unknown, cards = 1) {
    const options = available();
    const choice =
      typeof id === "string" && id
        ? options.find((option) => option.id === id)
        : options.length === 1
          ? options[0]
          : null;
    if (!choice) throw new Error("Choose an available delivery option.");
    const price = combinedPostage(choice, cards);
    if (price === null) throw new Error("This basket exceeds the delivery limit. Please contact us for a postage quote.");
    return { ...choice, price };
  }
  const installRoyalMail = db.transaction(() => {
    if (all().length) return;
    // Royal Mail online price guide, effective 5 October 2026. One holder per card;
    // multiple cards go in one small parcel. Verify packed size/weight before posting.
    for (const [id, name, single, parcel] of [
      ["royal-mail-second", "Royal Mail 2nd Class", 155, 440],
      ["royal-mail-first", "Royal Mail 1st Class", 320, 570],
    ] as const) save({ id, name, price: single, packaging: 50,
      bands: [{ upToCards: 1, price: single }, { upToCards: 100, price: parcel }], enabled: true });
  });
  return { all, available, save, select, installRoyalMail };
}
