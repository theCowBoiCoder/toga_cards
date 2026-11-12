import { createStockSyncStore } from "./stock-sync-store";
import { createShopStore } from "./shop-store";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { calculateSetProgress } from "./set-progress";
import { createEbayStore } from "./ebay-store";
import catalogue from "../../catalog/topps-premier-league-2026-27.json";

export function createInventory(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY, player TEXT NOT NULL, club TEXT NOT NULL, season TEXT NOT NULL, collection TEXT NOT NULL, number TEXT NOT NULL, variant TEXT NOT NULL, condition TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS movements (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id), quantity INTEGER NOT NULL, total_cost INTEGER NOT NULL, date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id), quantity INTEGER NOT NULL, gross INTEGER NOT NULL, fees INTEGER NOT NULL, cost INTEGER NOT NULL, date TEXT NOT NULL, platform TEXT NOT NULL);`);
  const integer = (v: unknown, min = 0) => {
    if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > 100000000)
      throw new Error("Enter a valid positive quantity or amount.");
    return Number(v);
  };
  const str = (v: unknown, fallback = "") => {
    const s = typeof v === "string" ? v.trim() : fallback;
    if (!s || s.length > 150)
      throw new Error("Complete all required fields (maximum 150 characters).");
    return s;
  };
  const date = (v: unknown) => {
    const s = str(v);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
      !Number.isFinite(Date.parse(s)) ||
      new Date(s).toISOString().slice(0, 10) !== s
    )
      throw new Error("Enter a valid date.");
    return s;
  };
  function cards() {
    return db
      .prepare(
        `SELECT c.*, COALESCE(m.quantity,0)-COALESCE(s.quantity,0) stock, COALESCE(m.total_cost,0)-COALESCE(s.cost,0) stock_cost FROM cards c LEFT JOIN (SELECT card_id,SUM(quantity) quantity,SUM(total_cost) total_cost FROM movements GROUP BY card_id) m ON m.card_id=c.id LEFT JOIN (SELECT card_id,SUM(quantity) quantity,SUM(cost) cost FROM sales GROUP BY card_id) s ON s.card_id=c.id ORDER BY c.id DESC`,
      )
      .all() as any[];
  }
  const shop = createShopStore(db, cards, (body) => mutate(body), {
    assertIdle: () => stockSync.assertIdle(),
    request: (id, quantity) => stockSync.request(id, quantity),
    sold: (id, quantity) => stockSync.sold(id, quantity),
  });
  const ebay = createEbayStore(db, cards);
  const stockSync = createStockSyncStore(db, cards);
  function snapshot() {
    const holdings = cards();
    return {
      cards: holdings,
      sets: calculateSetProgress(holdings),
      sales: db
        .prepare(
          "SELECT s.*, c.player,c.club,c.number,c.variant, e.fees_confirmed AS ebay_fees_confirmed, e.key AS ebay_order_key FROM sales s JOIN cards c ON c.id=s.card_id LEFT JOIN ebay_orders e ON e.sale_id=s.id ORDER BY s.date DESC,s.id DESC",
        )
        .all(),
    };
  }
  // Import catalogue metadata only. Existing holdings and transactions are untouched.
  const importCatalogue = db.transaction((catalog: typeof catalogue) => {
    const find = db.prepare(
      "SELECT id FROM cards WHERE season=? AND collection=? AND number=? AND variant=? AND player=? AND club=?",
    );
    const insert = db.prepare(
      "INSERT INTO cards(player,club,season,collection,number,variant,condition) VALUES (?,?,?,?,?,?,?)",
    );
    let inserted = 0;
    for (const card of catalog.cards) {
      if (
        !find.get(
          catalog.season,
          catalog.collection,
          card.number,
          card.variant,
          card.player,
          card.club,
        )
      ) {
        insert.run(
          card.player,
          card.club,
          catalog.season,
          catalog.collection,
          card.number,
          card.variant,
          "Not assessed",
        );
        inserted++;
      }
    }
    return inserted;
  });
  const mutate = db.transaction((body: any) => {
    stockSync.assertIdle();
    if (body.action === "card") {
      const fields = [
        "player",
        "club",
        "season",
        "collection",
        "number",
        "variant",
        "condition",
      ].map((k) => str(body[k]));
      const id = db
        .prepare(
          "INSERT INTO cards(player,club,season,collection,number,variant,condition) VALUES (?,?,?,?,?,?,?)",
        )
        .run(...fields).lastInsertRowid;
      const quantity = integer(body.quantity, 1),
        unitCost = integer(body.unitCost);
      db.prepare(
        "INSERT INTO movements(card_id,quantity,total_cost,date) VALUES (?,?,?,?)",
      ).run(id, quantity, integer(quantity * unitCost), date(body.date));
    } else if (body.action === "adjust") {
      const card = cards().find((c) => c.id === integer(body.cardId, 1));
      if (!card) throw new Error("Card not found.");
      if (integer(body.expectedStock) !== card.stock)
        throw new Error(
          "Stock has changed. Refresh the page before setting stock.",
        );
      const target = integer(body.quantity);
      if (target < shop.committed(card.id))
        throw new Error("Release website allocation before reducing stock.");
      const difference = target - card.stock;
      const cost =
        difference >= 0
          ? integer(difference * integer(body.unitCost))
          : target === 0
            ? -card.stock_cost
            : -Math.round((card.stock_cost / card.stock) * -difference);
      if (difference)
        db.prepare(
          "INSERT INTO movements(card_id,quantity,total_cost,date) VALUES (?,?,?,?)",
        ).run(card.id, difference, cost, date(body.date));
    } else if (body.action === "stock" || body.action === "sale") {
      const card = cards().find((c) => c.id === integer(body.cardId, 1));
      if (!card) throw new Error("Card not found.");
      const quantity = integer(body.quantity, 1);
      if (body.action === "stock")
        db.prepare(
          "INSERT INTO movements(card_id,quantity,total_cost,date) VALUES (?,?,?,?)",
        ).run(
          card.id,
          quantity,
          integer(quantity * integer(body.unitCost)),
          date(body.date),
        );
      else {
        if (
          body.platform !== "Website" &&
          shop.committed(card.id) > 0 &&
          quantity > card.stock - shop.committed(card.id)
        )
          throw new Error(
            "Stock is allocated to the website. Release allocation first.",
          );
        if (quantity > card.stock)
          throw new Error("There is not enough stock for this sale.");
        const gross = integer(quantity * integer(body.unitPrice)),
          fees = integer(body.fees);
        if (fees > gross) throw new Error("Fees cannot exceed the sale total.");
        const cost =
          quantity === card.stock
            ? card.stock_cost
            : Math.round((card.stock_cost / card.stock) * quantity);
        db.prepare(
          "INSERT INTO sales(card_id,quantity,gross,fees,cost,date,platform) VALUES (?,?,?,?,?,?,?)",
        ).run(
          card.id,
          quantity,
          gross,
          fees,
          cost,
          date(body.date),
          str(body.platform),
        );
      }
    } else throw new Error("Unknown action.");
    return snapshot();
  });
  return {
    snapshot,
    mutate,
    importCatalogue,
    ebay,
    shop,
    stockSync,
    health: () => db.prepare("SELECT 1 FROM cards LIMIT 1").get(),
    close: () => db.close(),
  };
}
let inventory: ReturnType<typeof createInventory>;
export function getInventory() {
  if (!inventory) {
    const dir = process.env.DATA_DIR || join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    inventory = createInventory(join(dir, "cards.sqlite"));
    inventory.importCatalogue(catalogue);
  }
  return inventory;
}
