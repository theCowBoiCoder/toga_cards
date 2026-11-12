import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export function createShippingStore(db: Database.Database) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS shop_shipping_options (id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL, min_days INTEGER, max_days INTEGER, enabled INTEGER NOT NULL DEFAULT 1)`,
  );
  const all = () =>
    db
      .prepare("SELECT * FROM shop_shipping_options ORDER BY price,name,id")
      .all() as any[];
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
    db.prepare(
      "INSERT INTO shop_shipping_options VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price=excluded.price,min_days=excluded.min_days,max_days=excluded.max_days,enabled=excluded.enabled",
    ).run(id, name, body.price, min, max, body.enabled ? 1 : 0);
    return { id };
  });
  function select(id: unknown) {
    const options = available();
    const choice =
      typeof id === "string" && id
        ? options.find((option) => option.id === id)
        : options.length === 1
          ? options[0]
          : null;
    if (!choice) throw new Error("Choose an available delivery option.");
    return choice;
  }
  return { all, available, save, select };
}
