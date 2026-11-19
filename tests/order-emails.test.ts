import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInventory } from "../server/utils/inventory";
import { deliverOrderEmails, emailConfiguration } from "../server/utils/email-service";
import { renderOrderEmail } from "../server/utils/order-email";

const configured = () => emailConfiguration({
  TOGA_EMAILS_ENABLED: "1", MAIL_MAILER: "smtp", SHOP_URL: "https://shop.example",
  MAIL_HOST: "smtp.example", MAIL_PORT: "587", MAIL_USERNAME: "synthetic",
  MAIL_PASSWORD: "synthetic", MAIL_FROM_ADDRESS: "orders@shop.example",
  SHOP_NOTIFICATION_EMAIL: "owner@example.test",
});
function setup(path = ":memory:") {
  const inv = createInventory(path);
  inv.mutate({ action: "card", player: "Test <Player>", club: "Arsenal", season: "2026",
    collection: "Test", number: "1", variant: "Base", condition: "Near mint",
    quantity: 4, unitCost: 50, date: "2026-11-19" });
  inv.shop.publish({ cardId: 1, quantity: 4, price: 200, stockConfirmed: true });
  const order = inv.shop.reserve([{ id: 1, quantity: 2 }], 100, 10, "Royal Mail");
  inv.shop.attach(order.id, "cs_test_email");
  const session = { id: "cs_test_email", payment_status: "paid", currency: "gbp",
    amount_total: 500, payment_intent: "pi_test_email",
    customer_details: { email: "buyer@example.test" },
    collected_information: { shipping_details: { name: "Test Buyer",
      address: { line1: "1 Test Street", postal_code: "TE1 1ST", country: "GB" } } } };
  return { inv, order, session };
}

test("only verified payment queues emails, with one customer and one owner message on replay", async () => {
  const { inv, order, session } = setup();
  try {
    assert.equal(inv.shop.emails.history().length, 0);
    assert.throws(() => inv.shop.complete({ ...session, amount_total: 1 }), /does not match/);
    assert.equal(inv.shop.emails.history().length, 0);
    inv.shop.complete(session);
    inv.shop.complete(session);
    assert.equal(inv.shop.emails.history().length, 2);
    const delivered: any[] = [];
    await deliverOrderEmails(inv.shop.emails, configured(), async (message: any) => {
      delivered.push(message);
      return { accepted: [message.to], rejected: [] };
    });
    assert.deepEqual(delivered.map((m) => m.to).sort(), ["buyer@example.test", "owner@example.test"]);
    assert.match(delivered[0].text, /Total paid: £5.00/);
    assert.match(delivered[0].text, /Delivery \(Royal Mail\): £1.00/);
    assert.match(delivered[0].text, /1 Test Street/);
    assert.match(delivered[0].html, /Test &lt;Player&gt;/);
    assert.doesNotMatch(delivered[0].html, /Test <Player>/);
    assert.match(delivered[0].subject, new RegExp(order.id));
    assert.equal(inv.shop.emails.history().every((m: any) => m.status === "sent"), true);
    await deliverOrderEmails(inv.shop.emails, configured(), async () => assert.fail("sent emails must not resend"));
  } finally { inv.close(); }
});

test("dispatch and return updates snapshot their event and duplicate dispatch cannot queue again", async () => {
  const { inv, order, session } = setup();
  try {
    inv.shop.complete(session);
    inv.shop.dispatch(order.id, "RM123", "Royal Mail", "https://tracking.example/RM123");
    inv.shop.dispatch(order.id, "RM123", "Royal Mail", "https://tracking.example/RM123");
    inv.shop.requestReturn(10, order.id, "Damaged <card>");
    inv.shop.reviewReturn(order.id, "approved", "Please return it to the shop.");
    assert.equal(inv.shop.emails.history().length, 8);
    const delivered: any[] = [];
    await deliverOrderEmails(inv.shop.emails, configured(), async (message: any) => {
      delivered.push(message); return { accepted: [message.to], rejected: [] };
    });
    assert.equal(delivered.filter((m) => m.text.includes("Postage / tracking reference: RM123")).length, 2);
    assert.equal(delivered.filter((m) => m.text.includes("Request status: approved")).length, 2);
    assert.equal(delivered.filter((m) => m.html.includes("Damaged &lt;card&gt;")).length, 2);
  } finally { inv.close(); }
});

test("refund completion sends once; failed refunds alert only the owner", () => {
  const { inv, order, session } = setup();
  try {
    inv.shop.complete(session);
    const refund = { id: "re_email", payment_intent: "pi_test_email", currency: "gbp", amount: 100, status: "pending" };
    inv.shop.recordRefund(refund);
    assert.equal(inv.shop.emails.history().length, 2);
    inv.shop.recordRefund({ ...refund, status: "succeeded" });
    inv.shop.recordRefund({ ...refund, status: "succeeded" });
    assert.equal(inv.shop.emails.history().filter((m: any) => m.kind === "refund-completed").length, 2);
    const request = randomUUID();
    inv.shop.prepareRefund(order.id, 100, "Test rejection", request);
    inv.shop.failRefundRequest(request);
    inv.shop.failRefundRequest(request);
    assert.equal(inv.shop.emails.history().filter((m: any) => m.kind === "refund-failed").length, 1);
  } finally { inv.close(); }
});

test("SMTP errors preserve paid stock, back off and retain a stable message identity across retries", async () => {
  const { inv, order, session } = setup();
  try {
    inv.shop.complete(session);
    const identities: string[] = [];
    await deliverOrderEmails(inv.shop.emails, configured(), async (message: any) => {
      identities.push(message.messageId);
      throw Object.assign(new Error("Sensitive provider reply"), { code: "ETIMEDOUT" });
    });
    assert.equal(inv.shop.order(order.id).status, "paid");
    assert.equal(inv.snapshot().cards[0].stock, 2);
    assert.equal(inv.shop.emails.claim(), null, "wait until backoff expires");
    assert.equal(inv.shop.emails.history().every((m: any) => m.error_code === "ETIMEDOUT"), true);
    assert.doesNotMatch(JSON.stringify(inv.shop.emails.history()), /Sensitive provider reply/);
    for (let i = 0; i < 2; i++) {
      const email = inv.shop.emails.claim(Date.now() + 60_000)!;
      assert.ok(identities.includes(`<${email.id}@shop.example>`));
      inv.shop.emails.failed(email.id, email.token, 8, "EAUTH");
    }
    const failed = inv.shop.emails.history() as any[];
    assert.equal(failed.every((m) => m.status === "failed"), true);
    inv.shop.emails.retry(failed[0].id);
    assert.throws(() => inv.shop.emails.retry(failed[0].id), /Only failed/);
    const email = inv.shop.emails.claim()!;
    inv.shop.emails.sent(email.id, "wrong-lease");
    assert.equal((inv.shop.emails.history() as any[]).find((m) => m.id === email.id).status, "sending");
    inv.shop.emails.sent(email.id, email.token);
  } finally { inv.close(); }
});

test("outbox survives restart and expired leases recover without simultaneous claims", () => {
  const directory = mkdtempSync(join(tmpdir(), "toga-email-test-"));
  let inv: ReturnType<typeof createInventory> | undefined;
  try {
    const fixture = setup(join(directory, "cards.sqlite"));
    inv = fixture.inv;
    inv.shop.complete(fixture.session);
    const first = inv.shop.emails.claim(1000 + Date.now())!;
    const second = inv.shop.emails.claim(1000 + Date.now())!;
    assert.notEqual(first.id, second.id);
    assert.equal(inv.shop.emails.claim(), null);
    inv.close();
    inv = createInventory(join(directory, "cards.sqlite"));
    const recovered = inv.shop.emails.claim(Date.now() + 11 * 60_000)!;
    assert.ok(recovered);
    inv.shop.emails.sent(recovered.id, first.token);
    assert.equal((inv.shop.emails.history() as any[]).find((m) => m.id === recovered.id).status, "sending");
    inv.shop.emails.sent(recovered.id, recovered.token);
  } finally { inv?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("disabled or incomplete configuration never claims messages or attempts delivery", async () => {
  const { inv, session } = setup();
  try {
    inv.shop.complete(session);
    for (const configuration of [emailConfiguration({}), emailConfiguration({ TOGA_EMAILS_ENABLED: "1" }),
      emailConfiguration({ TOGA_PREVIEW: "1", TOGA_EMAILS_ENABLED: "1" })]) {
      assert.equal(configuration.ready, false);
      await deliverOrderEmails(inv.shop.emails, configuration, async () => assert.fail("must not send"));
    }
    assert.equal(inv.shop.emails.history().every((m: any) => m.attempts === 0), true);
  } finally { inv.close(); }
});

test("guest emails do not link to protected account orders; unsafe HTML and tracking are escaped", () => {
  const message = renderOrderEmail({ kind: "order-dispatched", audience: "customer", payload: JSON.stringify({
    order: { id: "guest", customer_id: null, carrier: "<script>test</script>",
      tracking_reference: "<img src=x>", tracking_url: "javascript:alert(1)" },
  }) }, "https://shop.example");
  assert.doesNotMatch(message.html, /<script>|<img|javascript:|\/account\/orders/);
  assert.match(message.html, /&lt;img src=x&gt;/);
});
