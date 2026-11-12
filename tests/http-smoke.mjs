// Run after npm run build. All data and payment events are synthetic; no external requests.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(
  process.env.TOGA_SMOKE_MODULE_ROOT || import.meta.url,
);
const Database = require("better-sqlite3");
const Stripe = (
  await import(
    process.env.TOGA_SMOKE_MODULE_ROOT
      ? "file:///app/.output/server/node_modules/stripe/esm/stripe.esm.node.js"
      : "stripe"
  )
).default;
const directory = await mkdtemp(join(tmpdir(), "toga-shop-smoke-"));
const listener = createServer();
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const origin = `http://127.0.0.1:${port}`,
  password = randomBytes(24).toString("hex"),
  secret = "whsec_local_synthetic_test";
const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
const child = spawn(process.execPath, [".output/server/index.mjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: directory,
    TOGA_PREVIEW: "1",
    LARAVEL_ADMIN_ENABLED: "false",
    ADMIN_USER: "admin",
    ADMIN_PASSWORD: password,
    STRIPE_SECRET_KEY: "sk_test_synthetic",
    STRIPE_WEBHOOK_SECRET: secret,
    EBAY_RELAY_URL: "",
  },
  stdio: "ignore",
});
let db;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + "/api/shop/catalogue")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Production server starts");
  for (const path of [
    "/api/inventory",
    "/api/inventory/",
    "/api/export",
    "/api/admin/shop",
    "/api/ebay",
    "/admin",
    "/%61pi/inventory",
  ])
    assert.equal((await fetch(origin + path)).status, 401, path);
  const request = async (path, body) => {
    const response = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        authorization,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(
      response.status,
      200,
      `${path}: ${await response.clone().text()}`,
    );
    return response.json();
  };
  assert.equal(
    (await fetch(origin + "/admin", { headers: { authorization } })).status,
    200,
    "SSR admin page",
  );
  assert.equal(
    (
      await fetch(origin + "/api/admin/shop", {
        method: "POST",
        headers: {
          authorization,
          Origin: "https://invalid.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  let catalog = await fetch(origin + "/api/shop/catalogue").then((r) =>
    r.json(),
  );
  assert.equal(catalog.products.length, 1138);
  assert.equal(catalog.checkoutReady, false);
  await request("/api/inventory", {
    action: "card",
    player: "Smoke fixture",
    club: "Test club",
    season: "2026/27",
    collection: "Test only",
    number: "TEST",
    variant: "Base",
    condition: "Near mint",
    quantity: 3,
    unitCost: 50,
    date: "2026-11-05",
  });
  const health = await fetch(origin + '/api/health').then(r => r.json());
  assert.equal(health.ok, true);
  assert.deepEqual(Object.keys(health).sort(), ['ok','revision']);
  const inventory = await request("/api/inventory");
  const card = inventory.cards.find((c) => c.player === "Smoke fixture");
  await request("/api/admin/shop", {
    cardId: card.id,
    quantity: 2,
    price: 199,
    stockConfirmed: true,
  });
  const proxied = await fetch(origin + '/api/admin/shop', {
    method:'POST',headers:{authorization,Origin:origin.replace('http:','https:'),'X-Forwarded-Proto':'https','Content-Type':'application/json'},
    body:JSON.stringify({cardId:card.id,quantity:2,price:199,stockConfirmed:true}),
  });
  assert.equal(proxied.status,200,'HTTPS reverse-proxy origin accepted');
  db = new Database(join(directory, "cards.sqlite"));
  const order = (id, session) => {
    db.prepare(
      "INSERT INTO shop_orders(id,status,session_id,total,shipping,created) VALUES (?,'pending',?,349,150,?)",
    ).run(id, session, new Date().toISOString());
    db.prepare("INSERT INTO shop_order_items(order_id,card_id,quantity,price) VALUES (?,?,1,199)").run(
      id,
      card.id,
    );
  };
  order("order_smoke", "cs_smoke");
  const stripe = new Stripe("sk_test_synthetic");
  const send = async (type, session, valid = true) => {
    const payload = JSON.stringify({
      id: `evt_${type}`,
      object: "event",
      type,
      data: { object: session },
    });
    return fetch(origin + "/api/shop/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": valid
          ? stripe.webhooks.generateTestHeaderString({ payload, secret })
          : "invalid",
      },
      body: payload,
    });
  };
  const session = {
    id: "cs_smoke",
    payment_status: "paid",
    amount_total: 349,
    currency: "gbp",
  };
  assert.equal(
    (await send("checkout.session.completed", session, false)).status,
    400,
  );
  assert.equal((await send("checkout.session.completed", session)).status, 200);
  assert.equal((await send("checkout.session.completed", session)).status, 200);
  const after = await request("/api/inventory");
  assert.equal(after.cards.find((c) => c.id === card.id).stock, 2);
  assert.equal(after.sales.filter((s) => s.card_id === card.id).length, 1);
  order("order_expire", "cs_expire");
  catalog = await fetch(origin + "/api/shop/catalogue").then((r) => r.json());
  assert.equal(catalog.products.find((c) => c.id === card.id).available, 0);
  assert.equal(
    (await send("checkout.session.expired", { id: "cs_expire" })).status,
    200,
  );
  catalog = await fetch(origin + "/api/shop/catalogue").then((r) => r.json());
  assert.equal(catalog.products.find((c) => c.id === card.id).available, 1);
  console.log(
    "Production HTTP smoke passed: protected admin/APIs, SSR, CSRF, signed webhook, duplicate payment replay, sale deduction and expiry release.",
  );
} finally {
  db?.close();
  if (child.exitCode === null) {
    const stopped = new Promise((r) => child.once("exit", r));
    child.kill();
    await stopped;
  }
  const target = resolve(directory),
    base = resolve(tmpdir());
  if (
    !target.startsWith(base + sep) ||
    !target.slice(base.length + 1).startsWith("toga-shop-smoke-")
  )
    throw new Error("Unsafe test cleanup path");
  await rm(target, { recursive: true, force: true });
}
