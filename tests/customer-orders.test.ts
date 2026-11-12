import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createInventory } from "../server/utils/inventory";
import { issueRefund, synchronizeRefund } from "../server/utils/refund-service";

function paid(customerId = 10) {
  const inv = createInventory(":memory:");
  inv.mutate({
    action: "card",
    player: "Test Player",
    club: "Arsenal",
    season: "2026",
    collection: "Test set",
    number: "1",
    variant: "Base",
    condition: "Near mint",
    quantity: 4,
    unitCost: 50,
    date: "2026-11-12",
  });
  inv.shop.publish({
    cardId: 1,
    quantity: 4,
    price: 200,
    stockConfirmed: true,
  });
  const order = inv.shop.reserve([{ id: 1, quantity: 2 }], 100, customerId);
  inv.shop.attach(order.id, "cs_test");
  inv.shop.complete({
    id: "cs_test",
    payment_status: "paid",
    currency: "gbp",
    amount_total: 500,
    payment_intent: "pi_test",
    customer_details: { email: "test@example.test" },
  });
  return { inv, order };
}

test("customer order history and return requests are isolated by bound customer identity", () => {
  const { inv, order } = paid();
  assert.equal(inv.shop.customerOrders(10).length, 1);
  assert.equal(inv.shop.customerOrders(20).length, 0);
  assert.throws(() => inv.shop.customerOrder(20, order.id), /not found/);
  assert.throws(
    () => inv.shop.requestReturn(20, order.id, "Return please"),
    /not found/,
  );
  inv.shop.requestReturn(10, order.id, "Damaged in transit");
  assert.throws(
    () => inv.shop.requestReturn(10, order.id, "Duplicate"),
    /already exists/,
  );
  const visible = inv.shop.customerOrder(10, order.id);
  assert.equal("session_id" in visible, false);
  assert.equal("payment_intent" in visible, false);
  assert.equal("sale_id" in visible.items[0], false);
  inv.close();
});

test("tracking is shown to the owner and unsafe tracking links are rejected", () => {
  const { inv, order } = paid();
  assert.throws(
    () => inv.shop.dispatch(order.id, "ref", "Carrier", "javascript:alert(1)"),
    /HTTPS/,
  );
  inv.shop.dispatch(
    order.id,
    "ref",
    "Royal Mail",
    "https://www.royalmail.com/track-your-item",
  );
  const visible = inv.shop.customerOrder(10, order.id);
  assert.equal(visible.carrier, "Royal Mail");
  assert.ok(visible.dispatched_at);
  assert.equal(inv.snapshot().cards[0].stock, 2);
  inv.close();
});

test("refund requests reserve remaining balance and retries keep one identity without restocking", () => {
  const { inv, order } = paid();
  const id = randomUUID();
  const first = inv.shop.prepareRefund(order.id, 300, "Partial return", id);
  assert.equal(
    inv.shop.prepareRefund(order.id, 300, "Partial return", id).id,
    first.id,
  );
  assert.throws(
    () => inv.shop.prepareRefund(order.id, 100, "Other", randomUUID()),
    /reconciliation/,
  );
  assert.throws(
    () => inv.shop.prepareRefund(order.id, 200, "Changed", id),
    /do not match/,
  );
  inv.shop.recordRefund({
    id: "re_test",
    payment_intent: "pi_test",
    amount: 300,
    currency: "gbp",
    status: "pending",
    metadata: { refundId: id },
  });
  assert.equal(inv.shop.refundSummary(order.id).refundHeld, 300);
  inv.shop.recordRefund({
    id: "re_test",
    payment_intent: "pi_test",
    amount: 300,
    currency: "gbp",
    status: "succeeded",
    metadata: { refundId: id },
  });
  assert.equal(
    inv.shop.prepareRefund(order.id, 300, "Partial return", id).stripe_id,
    "re_test",
  );
  assert.throws(
    () => inv.shop.prepareRefund(order.id, 201, "Too much", randomUUID()),
    /remaining/,
  );
  assert.equal(inv.shop.refundSummary(order.id).refunded, 300);
  assert.equal(inv.snapshot().cards[0].stock, 2);
  inv.close();
});

test("external Stripe refunds reconcile once and failed refunds release their held balance", () => {
  const { inv, order } = paid();
  const r = {
    id: "re_external",
    payment_intent: "pi_test",
    amount: 100,
    currency: "gbp",
    status: "pending",
  };
  inv.shop.recordRefund(r);
  inv.shop.recordRefund(r);
  assert.equal(inv.shop.refunds(order.id).length, 1);
  inv.shop.recordRefund({ ...r, status: "failed" });
  assert.equal(inv.shop.refundSummary(order.id).refundHeld, 0);
  inv.shop.prepareRefund(order.id, 500, "Full refund", randomUUID());
  assert.throws(
    () => inv.shop.recordRefund({ ...r, currency: "usd" }),
    /does not match/,
  );
  inv.close();
});

test("received return totals restore stock and original cost exactly once, without restoring sale allocation", () => {
  const { inv, order } = paid();
  inv.shop.openReturn(order.id, "Wrong cards");
  assert.throws(() => inv.shop.restockReturn(order.id, 1, 1), /received/);
  inv.shop.reviewReturn(order.id, "approved", "Please return the cards.");
  inv.shop.reviewReturn(order.id, "received", "Cards received and inspected.");
  inv.shop.restockReturn(order.id, 1, 1);
  inv.shop.restockReturn(order.id, 1, 1);
  assert.equal(inv.snapshot().cards[0].stock, 3);
  inv.shop.restockReturn(order.id, 1, 2);
  assert.equal(inv.snapshot().cards[0].stock, 4);
  assert.equal(inv.snapshot().cards[0].stock_cost, 200);
  assert.equal(inv.shop.committed(1), 2);
  assert.equal(inv.snapshot().sales.length, 1);
  assert.throws(() => inv.shop.restockReturn(order.id, 1, 3), /quantity/);
  inv.close();
});

test("ambiguous Stripe timeout and duplicate successful submissions cannot issue a second refund", async () => {
  const { inv, order } = paid();
  const requestId = randomUUID(),
    remote: any[] = [];
  let calls = 0;
  const stripe: any = {
    checkout: {
      sessions: {
        retrieve: async () => ({
          id: "cs_test",
          payment_status: "paid",
          amount_total: 500,
          currency: "gbp",
          payment_intent: "pi_test",
          metadata: { orderId: order.id },
        }),
      },
    },
    refunds: {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          for (const row of remote) yield row;
        },
      }),
      create: async (body: any, options: any) => {
        calls++;
        assert.equal(options.idempotencyKey, `toga-refund-${requestId}`);
        remote.push({
          id: "re_timeout",
          ...body,
          currency: "gbp",
          status: "succeeded",
        });
        throw new Error("Network timeout");
      },
      retrieve: async () => remote[0],
    },
  };
  await assert.rejects(
    issueRefund(order.id, 100, "Partial refund", requestId, stripe, inv.shop),
    /timeout/,
  );
  assert.equal(inv.shop.refunds(order.id)[0].status, "requested");
  await issueRefund(
    order.id,
    100,
    "Partial refund",
    requestId,
    stripe,
    inv.shop,
  );
  await issueRefund(
    order.id,
    100,
    "Partial refund",
    requestId,
    stripe,
    inv.shop,
  );
  assert.equal(calls, 1);
  assert.equal(inv.shop.refundSummary(order.id).refunded, 100);
  inv.close();
});

test("a refund event arriving before payment completion reconciles the order once", async () => {
  const { inv } = paid();
  const order = inv.shop.reserve([{ id: 1, quantity: 1 }], 0, 10);
  inv.shop.attach(order.id, "cs_early");
  const refund = {
    id: "re_early",
    payment_intent: "pi_early",
    currency: "gbp",
    amount: 200,
    status: "succeeded",
  };
  const stripe: any = {
    refunds: { retrieve: async () => refund },
    checkout: {
      sessions: {
        list: async () => ({
          data: [
            {
              id: "cs_early",
              payment_intent: "pi_early",
              payment_status: "paid",
              amount_total: 200,
              currency: "gbp",
              metadata: { orderId: order.id },
            },
          ],
        }),
      },
    },
  };
  await synchronizeRefund("re_early", stripe, inv.shop);
  await synchronizeRefund("re_early", stripe, inv.shop);
  assert.equal(inv.shop.order(order.id).status, "paid");
  assert.equal(inv.shop.refundSummary(order.id).refunded, 200);
  assert.equal(inv.snapshot().sales.length, 2);
  assert.equal(inv.snapshot().cards[0].stock, 1);
  inv.close();
});

test("a definitive Stripe rejection records failure while connection failures remain unconfirmed", async () => {
  const { inv, order } = paid();
  const id = randomUUID();
  const stripe: any = {
    checkout: {
      sessions: {
        retrieve: async () => ({
          id: "cs_test",
          payment_status: "paid",
          amount_total: 500,
          currency: "gbp",
          payment_intent: "pi_test",
          metadata: { orderId: order.id },
        }),
      },
    },
    refunds: {
      list: () => ({ async *[Symbol.asyncIterator]() {} }),
      create: async () => {
        throw Object.assign(new Error("Provider rejected refund"), {
          type: "StripeInvalidRequestError",
        });
      },
    },
  };
  await assert.rejects(
    issueRefund(order.id, 100, "Rejected request", id, stripe, inv.shop),
    /rejected/,
  );
  assert.equal(inv.shop.refundRequest(id).status, "failed");
  assert.equal(inv.shop.refundSummary(order.id).refundHeld, 0);
  assert.ok(inv.shop.prepareRefund(order.id, 100, "New request", randomUUID()));
  inv.close();
});
