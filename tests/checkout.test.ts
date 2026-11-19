import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("checkout uses Dashboard payment methods and saves the created session", async () => {
  const source = readFileSync(
    new URL("../server/utils/checkout-service.ts", import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const order = {
    id: "order-checkout",
    lines: [{ quantity: 1, price: 199, player: "Player", number: "24",
      variant: "Base", collection: "Topps", season: "2026/27", condition: "Near mint" }],
  };
  let attached: unknown[] | undefined;
  let created = false;
  const shop = {
    shipping: { select: () => ({ price: 91, name: "UK postage", min_days: null }) },
    reserve(items: unknown, shipping: number) {
      assert.deepEqual(items, [{ id: 1, quantity: 1 }]);
      assert.equal(shipping, 91);
      return order;
    },
    attach(...args: unknown[]) { attached = args; },
  };
  const stripe = { checkout: { sessions: {
    async create(params: any, options: any) {
      // Reproduce Stripe's rejection of the legacy parameter at the API boundary.
      assert.equal("payment_method_types" in params, false,
        "Stripe rejects payment_method_types when creating Checkout Sessions");
      assert.equal(params.mode, "payment");
      assert.equal(params.metadata.orderId, order.id);
      assert.equal(params.line_items[0].price_data.unit_amount, 199);
      assert.equal(params.shipping_options[0].shipping_rate_data.fixed_amount.amount, 91);
      assert.deepEqual(params.shipping_address_collection.allowed_countries, ["GB"]);
      assert.equal(params.success_url, "https://shop.example/?checkout=success");
      assert.deepEqual(options, { idempotencyKey: order.id });
      created = true;
      return { id: "cs_test_checkout", url: "https://checkout.stripe.com/test" };
    },
  } } };
  const exports: any = {};
  const load = new Function("require", "exports", "process", "defineEventHandler",
    "getHeader", "getRequestURL", "createError", "readBody", outputText);
  load(
    (name: string) => name.endsWith("inventory")
      ? { getInventory: () => ({ shop }) }
      : name.endsWith("shipping") ? { basketCardCount: () => 1 }
      : { stripeClient: () => stripe },
    exports,
    { env: { SHOP_URL: "https://shop.example", SHOP_SHIPPING_PENCE: "91",
      STRIPE_SECRET_KEY: "sk_test_synthetic", STRIPE_WEBHOOK_SECRET: "whsec_synthetic" } },
    (handler: unknown) => handler,
    () => "https://shop.example",
    () => new URL("https://shop.example/api/shop/checkout"),
    (error: { statusMessage: string }) => new Error(error.statusMessage),
    async () => ({ items: [{ id: 1, quantity: 1 }] }),
  );
  assert.deepEqual(await exports.startCheckout([{ id: 1, quantity: 1 }]),
    { url: "https://checkout.stripe.com/test" });
  assert.equal(created, true);
  assert.deepEqual(attached, [order.id, "cs_test_checkout"]);
});
