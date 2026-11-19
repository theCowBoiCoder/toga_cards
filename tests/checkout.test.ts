import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { createInventory } from "../server/utils/inventory";
import { cancelCheckout, recoverCheckouts } from "../server/utils/checkout-recovery";
import { randomBytes } from "node:crypto";

function checkoutFixture(failure?: any, path = ":memory:") {
  const inv = createInventory(path);
  inv.mutate({ action: "card", player: "Player", club: "Arsenal", season: "2026/27",
    collection: "Topps", number: "24", variant: "Base", condition: "Near mint",
    quantity: 2, unitCost: 50, date: "2026-11-19" });
  inv.shop.publish({ cardId: 1, quantity: 2, price: 199, stockConfirmed: true });
  inv.shop.shipping.save({ id: "test", name: "UK postage", price: 91, enabled: true });
  const requests: any[] = [];
  const stripe: any = { checkout: { sessions: { async create(params: any, options: any) {
    requests.push({ params, options });
    if (failure) throw failure;
    return { id: "cs_test_checkout", url: "https://checkout.stripe.com/test" };
  } } } };
  const url = new URL("../server/utils/checkout-service.ts", import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const sourceRequire = createRequire(url);
  const exports: any = {};
  new Function("require", "exports", "process", "createError", outputText)(
    (name: string) => name === "./inventory" ? { getInventory: () => inv }
      : name === "./stripe" ? { stripeClient: () => stripe } : sourceRequire(name), exports,
    { env: { SHOP_URL: "https://shop.example", STRIPE_SECRET_KEY: "sk_test_synthetic", STRIPE_WEBHOOK_SECRET: "whsec_synthetic" } },
    (error: any) => Object.assign(new Error(error.statusMessage), error),
  );
  return { inv, stripe, requests, start: () => exports.startCheckout([{ id: 1, quantity: 1 }], undefined, "test") };
}

test("checkout uses Dashboard payment methods and saves the created session", async () => {
  const f = checkoutFixture();
  try {
    const result = await f.start();
    assert.equal(result.url, "https://checkout.stripe.com/test");
    const { params, options } = f.requests[0];
    assert.equal("payment_method_types" in params, false);
    assert.equal(params.line_items[0].price_data.unit_amount, 199);
    assert.equal(params.shipping_options[0].shipping_rate_data.fixed_amount.amount, 91);
    assert.deepEqual(params.shipping_address_collection.allowed_countries, ["GB"]);
    assert.equal(params.success_url, "https://shop.example/?checkout=success");
    assert.equal(options.idempotencyKey, params.metadata.orderId);
    assert.equal(f.inv.shop.order(params.metadata.orderId).session_id, "cs_test_checkout");
  } finally { f.inv.close(); }
});

for (const [type, statusCode] of [["StripeInvalidRequestError",400], ["StripeAuthenticationError",401], ["StripePermissionError",403]] as const)
  test(`definite ${type} returns reserved stock immediately`, async () => {
    const f = checkoutFixture({ type, statusCode, code: "secret_key_required" });
    try {
      await assert.rejects(f.start);
      assert.equal(f.inv.shop.products()[0].available, 2);
      assert.equal(f.inv.shop.orders()[0].status, "expired");
      assert.equal(f.inv.snapshot().sales.length, 0);
    } finally { f.inv.close(); }
  });

for (const error of [{type:"StripeConnectionError"}, {type:"StripeAPIError",statusCode:500},
  {type:"StripeIdempotencyError",statusCode:400}, {type:"StripeInvalidRequestError",statusCode:409},
  {type:"StripeInvalidRequestError",statusCode:400,code:"idempotency_key_in_use"}])
  test(`uncertain ${error.type}/${error.statusCode} keeps stock reserved`, async () => {
    const f = checkoutFixture(error);
    try {
      await assert.rejects(f.start, /held|checking/i);
      assert.equal(f.inv.shop.products()[0].available, 1);
      assert.equal(f.inv.shop.orders()[0].status, "pending");
    } finally { f.inv.close(); }
  });


function stripeSession(order: any, overrides = {}) {
  return { id: "cs_test_checkout", metadata: { orderId: order.id }, client_reference_id: order.id,
    amount_total: order.total, currency: "gbp", payment_status: "unpaid", status: "open",
    expires_at: Math.floor(Date.now() / 1000) + 1800, ...overrides };
}

test("cancelling closes Stripe before returning stock, and repeating it cannot inflate stock", async () => {
  const f = checkoutFixture();
  try {
    const checkout = await f.start();
    const order = f.inv.shop.order(checkout.orderId);
    assert.match(checkout.cancelToken, /^[a-f0-9]{64}$/);
    assert.equal(new URL(f.requests[0].params.cancel_url).searchParams.get("order"), order.id);
    assert.equal(f.requests[0].params.cancel_url.includes(checkout.cancelToken), false);
    let expired = false;
    f.stripe.checkout.sessions.retrieve = async () => stripeSession(order, { status: expired ? "expired" : "open" });
    f.stripe.checkout.sessions.expire = async () => {
      assert.equal(f.inv.shop.products()[0].available, 1, "stock stays held until Stripe closes the session");
      expired = true;
      return stripeSession(order, { status: "expired" });
    };
    const result = await cancelCheckout(order.id, checkout.cancelToken, f.stripe, f.inv.shop);
    assert.equal(result.status, "expired");
    assert.equal(f.inv.shop.products()[0].available, 2);
    assert.equal((await cancelCheckout(order.id, checkout.cancelToken, f.stripe, f.inv.shop)).status, "expired");
    assert.equal(f.inv.shop.products()[0].available, 2);
  } finally { f.inv.close(); }
});

test("cancellation requires the browser capability and cannot be triggered by an order reference alone", async () => {
  const f = checkoutFixture();
  try {
    const checkout = await f.start();
    f.stripe.checkout.sessions.retrieve = async () => assert.fail("unauthorized cancellation must not call Stripe");
    for (const token of [undefined, "", "a".repeat(64)])
      await assert.rejects(() => cancelCheckout(checkout.orderId, token, f.stripe, f.inv.shop), /not found/);
    assert.equal(f.inv.shop.products()[0].available, 1);
  } finally { f.inv.close(); }
});

test("payment winning a cancellation race is fulfilled once, without restoring sold copies", async () => {
  const f = checkoutFixture();
  try {
    const checkout = await f.start();
    const order = f.inv.shop.order(checkout.orderId);
    let calls = 0;
    f.stripe.checkout.sessions.retrieve = async () => stripeSession(order, calls++ ? {
      status: "complete", payment_status: "paid", customer_details: { email: "buyer@example.test" },
    } : {});
    f.stripe.checkout.sessions.expire = async () => { throw new Error("Already paid"); };
    assert.equal((await cancelCheckout(order.id, checkout.cancelToken, f.stripe, f.inv.shop)).status, "paid");
    assert.equal(f.inv.snapshot().sales.length, 1);
    assert.equal(f.inv.snapshot().cards[0].stock, 1);
    assert.equal(f.inv.shop.products()[0].available, 1);
    await cancelCheckout(order.id, checkout.cancelToken, f.stripe, f.inv.shop);
    assert.equal(f.inv.snapshot().sales.length, 1);
  } finally { f.inv.close(); }
});

test("missed expiry webhook is recovered for legacy linked orders", async () => {
  const f = checkoutFixture();
  try {
    const order = f.inv.shop.reserve([{ id: 1, quantity: 1 }], 91);
    f.inv.shop.attach(order.id, "cs_test_checkout");
    f.stripe.checkout.sessions.retrieve = async () => stripeSession(order, { status: "expired" });
    await recoverCheckouts(f.stripe, f.inv.shop);
    assert.equal(f.inv.shop.order(order.id).status, "expired");
    assert.equal(f.inv.shop.products()[0].available, 2);
  } finally { f.inv.close(); }
});

test("a declined payment keeps its open session reserved until expiry is confirmed", async () => {
  const f = checkoutFixture();
  try {
    const order = f.inv.shop.reserve([{ id: 1, quantity: 1 }], 91);
    f.inv.shop.attach(order.id, "cs_test_checkout");
    f.stripe.checkout.sessions.retrieve = async () => stripeSession(order);
    f.stripe.checkout.sessions.expire = async () => assert.fail("open sessions still within checkout time must remain payable");
    await recoverCheckouts(f.stripe, f.inv.shop);
    assert.equal(f.inv.shop.order(order.id).status, "pending");
    assert.equal(f.inv.shop.products()[0].available, 1);
  } finally { f.inv.close(); }
});

test("timeout recovery replays the persisted request and idempotency key, then checks the actual session", async () => {
  const f = checkoutFixture({ type: "StripeConnectionError" });
  try {
    await assert.rejects(f.start);
    const order = f.inv.shop.orders()[0];
    const stored = f.requests[0];
    f.stripe.checkout.sessions.create = async (request: any, options: any) => {
      assert.deepEqual(request, stored.params);
      assert.deepEqual(options, stored.options);
      return stripeSession(order);
    };
    f.stripe.checkout.sessions.retrieve = async () => stripeSession(order, { status: "expired" });
    // Explicit cancellation claims the attempt immediately; normal recovery obeys its backoff.
    const claim = f.inv.shop.checkouts.claim(order.id)!;
    f.inv.shop.checkouts.finish(order.id, claim.token, "", -1);
    await recoverCheckouts(f.stripe, f.inv.shop);
    assert.equal(f.inv.shop.order(order.id).status, "expired");
    assert.equal(f.inv.shop.products()[0].available, 2);
  } finally { f.inv.close(); }
});

test("an error while linking a created session does not release stock", async () => {
  const f = checkoutFixture();
  try {
    f.inv.shop.attach = () => { throw new Error("Database write interrupted"); };
    await assert.rejects(f.start, /held/);
    assert.equal(f.inv.shop.orders()[0].status, "pending");
    assert.equal(f.inv.shop.products()[0].available, 1);
  } finally { f.inv.close(); }
});

test("legacy unlinked holds and failed reconciliation are never released by age alone", async () => {
  const f = checkoutFixture();
  try {
    const order = f.inv.shop.reserve([{ id: 1, quantity: 1 }], 91);
    f.stripe.checkout.sessions.create = async () => assert.fail("legacy requests must not be invented");
    await recoverCheckouts(f.stripe, f.inv.shop);
    assert.equal(f.inv.shop.order(order.id).status, "pending");
    f.inv.shop.attach(order.id, "cs_test_checkout");
    f.stripe.checkout.sessions.retrieve = async () => { throw new Error("Stripe unavailable"); };
    const claim = f.inv.shop.checkouts.claim(order.id)!;
    f.inv.shop.checkouts.finish(order.id, claim.token, "", -1);
    await recoverCheckouts(f.stripe, f.inv.shop);
    assert.equal(f.inv.shop.products()[0].available, 1);
  } finally { f.inv.close(); }
});

test("a lost expiry response is resolved by fetching Stripe's current session state", async () => {
  const f = checkoutFixture();
  try {
    const checkout = await f.start();
    const order = f.inv.shop.order(checkout.orderId);
    let expired = false;
    f.stripe.checkout.sessions.retrieve = async () => stripeSession(order, { status: expired ? "expired" : "open" });
    f.stripe.checkout.sessions.expire = async () => { expired = true; throw new Error("Connection lost"); };
    assert.equal((await cancelCheckout(order.id, checkout.cancelToken, f.stripe, f.inv.shop)).status, "expired");
    assert.equal(f.inv.shop.products()[0].available, 2);
  } finally { f.inv.close(); }
});

test("mismatched remote session identity cannot release a reservation", async () => {
  const f = checkoutFixture();
  try {
    const checkout = await f.start();
    const order = f.inv.shop.order(checkout.orderId);
    f.stripe.checkout.sessions.retrieve = async () => stripeSession(order, { status: "expired", metadata: { orderId: "another-order" } });
    await cancelCheckout(order.id, checkout.cancelToken, f.stripe, f.inv.shop);
    assert.equal(f.inv.shop.order(order.id).status, "pending");
    assert.equal(f.inv.shop.products()[0].available, 1);
  } finally { f.inv.close(); }
});

test("reservation and Stripe request preparation roll back together", () => {
  const f = checkoutFixture();
  try {
    assert.throws(() => f.inv.shop.checkouts.prepare(
      () => f.inv.shop.reserve([{ id: 1, quantity: 1 }], 91),
      () => { throw new Error("Cannot prepare request"); }, "a".repeat(64)), /Cannot prepare/);
    assert.equal(f.inv.shop.orders().length, 0);
    assert.equal(f.inv.shop.products()[0].available, 2);
  } finally { f.inv.close(); }
});

test("overdue open sessions are explicitly expired before a missed webhook can release stock", async () => {
  const f = checkoutFixture();
  try {
    const order = f.inv.shop.reserve([{ id: 1, quantity: 1 }], 91);
    f.inv.shop.attach(order.id, "cs_test_checkout");
    let expires = 0;
    f.stripe.checkout.sessions.retrieve = async () => stripeSession(order, { expires_at: 1 });
    f.stripe.checkout.sessions.expire = async () => {
      expires++;
      assert.equal(f.inv.shop.products()[0].available, 1);
      return stripeSession(order, { status: "expired" });
    };
    await recoverCheckouts(f.stripe, f.inv.shop);
    assert.equal(expires, 1);
    assert.equal(f.inv.shop.products()[0].available, 2);
  } finally { f.inv.close(); }
});

test("a failure during recovery cannot be reclassified as a definite failure of the original creation", async () => {
  const f = checkoutFixture({ type: "StripeConnectionError" });
  try {
    await assert.rejects(f.start);
    const order = f.inv.shop.orders()[0];
    const claim = f.inv.shop.checkouts.claim(order.id)!;
    f.inv.shop.checkouts.finish(order.id, claim.token, "", -1);
    f.stripe.checkout.sessions.create = async () => { throw { type: "StripeAuthenticationError", statusCode: 401 }; };
    await recoverCheckouts(f.stripe, f.inv.shop);
    assert.equal(f.inv.shop.order(order.id).status, "pending");
    assert.equal(f.inv.shop.products()[0].available, 1);
  } finally { f.inv.close(); }
});

test("an ambiguous creation cannot be replayed using a changed Stripe key or account", async () => {
  const previous = process.env.STRIPE_SECRET_KEY;
  const f = checkoutFixture({ type: "StripeConnectionError" });
  try {
    await assert.rejects(f.start);
    const order = f.inv.shop.orders()[0];
    const claim = f.inv.shop.checkouts.claim(order.id)!;
    f.inv.shop.checkouts.finish(order.id, claim.token, "", -1);
    process.env.STRIPE_SECRET_KEY = "sk_test_another_account";
    f.stripe.checkout.sessions.create = async () => assert.fail("must not create a session in another account");
    await recoverCheckouts(f.stripe, f.inv.shop);
    assert.equal(f.inv.shop.order(order.id).status, "pending");
  } finally {
    if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous;
    f.inv.close();
  }
});

test("leases prevent a worker from recovering an in-flight creation or a stale worker from clearing a new lease", () => {
  const f = checkoutFixture();
  try {
    const prepared = f.inv.shop.checkouts.prepare(
      () => f.inv.shop.reserve([{ id: 1, quantity: 1 }], 91), () => ({ mode: "payment" }), randomBytes(32).toString("hex"));
    assert.equal(f.inv.shop.checkouts.claim(prepared.order.id), null);
    const reclaimed = f.inv.shop.checkouts.claim(prepared.order.id, Date.now() + 6 * 60_000)!;
    assert.ok(reclaimed);
    f.inv.shop.checkouts.finish(prepared.order.id, prepared.token);
    assert.equal(f.inv.shop.checkouts.claim(prepared.order.id), null);
    f.inv.shop.checkouts.finish(prepared.order.id, reclaimed.token);
    assert.ok(f.inv.shop.checkouts.claim(prepared.order.id));
  } finally { f.inv.close(); }
});

test("ambiguous requests are not replayed after the safe idempotency window", async (context) => {
  let clock = Date.now();
  context.mock.method(Date, "now", () => clock);
  const f = checkoutFixture({ type: "StripeConnectionError" });
  try {
    await assert.rejects(f.start);
    clock += 24 * 60 * 60_000;
    f.stripe.checkout.sessions.create = async () => assert.fail("must not create a new session after idempotency retention");
    await recoverCheckouts(f.stripe, f.inv.shop);
    assert.equal(f.inv.shop.orders()[0].status, "pending");
    assert.equal(f.inv.shop.products()[0].available, 1);
  } finally { f.inv.close(); }
});

test("reservations and cancellation authorization survive a process restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "toga-checkout-recovery-"));
  const path = join(directory, "cards.sqlite");
  const f = checkoutFixture(undefined, path);
  let reopened: ReturnType<typeof createInventory> | undefined;
  let closed = false;
  try {
    const checkout = await f.start();
    f.inv.close();
    closed = true;
    reopened = createInventory(path);
    assert.equal(reopened.shop.products()[0].available, 1);
    const order = reopened.shop.order(checkout.orderId);
    f.stripe.checkout.sessions.retrieve = async () => stripeSession(order, { status: "expired" });
    const result = await cancelCheckout(order.id, checkout.cancelToken, f.stripe, reopened.shop);
    assert.equal(result.status, "expired");
    assert.equal(reopened.shop.products()[0].available, 2);
  } finally {
    if (!closed) f.inv.close();
    reopened?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
