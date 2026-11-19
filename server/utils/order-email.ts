import type { OutboxEmail } from "./email-outbox";

const money = (pence: number) => new Intl.NumberFormat("en-GB", {
  style: "currency", currency: "GBP",
}).format(pence / 100);
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
function paragraph(line: string) {
  const match = /^(.*?: )(https:\/\/\S+)$/.exec(line);
  if (match) {
    try {
      const url = new URL(match[2]);
      if (url.protocol === "https:" && !url.username && !url.password)
        return `${escape(match[1])}<a href="${escape(url.href)}" style="color:#12634a">${escape(url.href)}</a>`;
    } catch {}
  }
  return escape(line);
}

export function renderOrderEmail(email: Pick<OutboxEmail, "kind" | "audience" | "payload">, shopUrl: string) {
  const { order, amount, reason, response, returnStatus } = JSON.parse(email.payload);
  const owner = email.audience === "owner";
  const titles = {
    "order-paid": owner ? "New paid order" : "Your order is confirmed",
    "order-dispatched": owner ? "Order dispatched" : "Your order is on its way",
    "return-requested": owner ? "New return or refund request" : "We received your return or refund request",
    "return-updated": "Your return or refund request has been updated",
    "refund-completed": owner ? "Refund confirmed" : "Your refund has been issued",
    "refund-failed": "Refund needs review",
  };
  const title = titles[email.kind];
  const lines = [`Order reference: ${order.id}`];
  if (email.kind === "order-paid") {
    lines.push(owner ? "Payment has been verified. This order is ready to prepare."
      : "Thank you for shopping with Toga Cards. Your payment has been confirmed.");
    for (const item of order.items)
      lines.push(`${item.quantity} × ${item.player} #${item.number} · ${item.variant} — ${money(item.price * item.quantity)}`);
    lines.push(`Delivery${order.shipping_method ? ` (${order.shipping_method})` : ""}: ${money(order.shipping)}`,
      `Total paid: ${money(order.total)}`);
    let shipping: any = {};
    try { shipping = JSON.parse(order.address || "{}"); } catch {}
    const address = shipping.address || {};
    const addressLines = [shipping.name, address.line1, address.line2, address.city,
      address.state, address.postal_code, address.country].filter(Boolean);
    if (addressLines.length) lines.push("Delivery address:", ...addressLines);
  }
  if (email.kind === "order-dispatched") {
    lines.push("Your order has been dispatched.");
    if (order.carrier) lines.push(`Carrier: ${order.carrier}`);
    lines.push(`Postage / tracking reference: ${order.tracking_reference}`);
    // Only include a validated HTTPS link, even if legacy data contains another scheme.
    try {
      const url = new URL(order.tracking_url);
      if (url.protocol === "https:" && !url.username && !url.password)
        lines.push(`Track your parcel: ${url.href}`);
    } catch {}
  }
  if (email.kind === "return-requested")
    lines.push("The shop will review this request and send an update.", `Reason: ${reason}`);
  if (email.kind === "return-updated")
    lines.push(`Request status: ${returnStatus}`, String(response));
  if (email.kind === "refund-completed")
    lines.push(`Refund issued: ${money(amount)}`,
      "Stripe has confirmed the refund. Your payment provider determines when it appears in your account.");
  if (email.kind === "refund-failed")
    lines.push(`Refund amount: ${money(amount)}`, "The refund was not confirmed. Review it in admin and Stripe before retrying.");
  if (owner) {
    lines.push(`Customer email: ${order.email || "Not supplied"}`, `Manage order: ${shopUrl}/admin/orders`);
  } else if (order.customer_id) {
    lines.push(`View your order (sign in required): ${shopUrl}/account/orders/${encodeURIComponent(order.id)}`);
  }
  lines.push("Toga Cards");
  const text = `${title}\n\n${lines.join("\n\n")}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#17212b">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:white;border-radius:12px">
    <tr><td style="padding:28px;background:#17212b;color:white;font-size:22px;font-weight:bold">TOGA CARDS</td></tr>
    <tr><td style="padding:28px"><h1 style="font-size:24px;line-height:1.3;margin:0 0 24px">${escape(title)}</h1>
    ${lines.map((line) => `<p style="line-height:1.6;margin:0 0 16px;overflow-wrap:anywhere">${paragraph(line)}</p>`).join("")}
    </td></tr></table></td></tr></table></body></html>`;
  return { subject: `${title} · Toga Cards · ${order.id}`, text, html };
}
