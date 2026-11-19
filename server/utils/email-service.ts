import nodemailer from "nodemailer";
import type { createEmailOutbox } from "./email-outbox";
import { renderOrderEmail } from "./order-email";

const address = (value: string | undefined) =>
  !!value && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);

export function emailConfiguration(env = process.env) {
  if (env.TOGA_PREVIEW === "1" || env.TOGA_EMAILS_ENABLED !== "1")
    return { ready: false, reason: "Order emails are switched off." } as const;
  const port = Number(env.MAIL_PORT || "587");
  let base: URL;
  try { base = new URL(env.SHOP_URL || ""); } catch {
    return { ready: false, reason: "Set the shop HTTPS URL." } as const;
  }
  if (base.protocol !== "https:" || base.username || base.password)
    return { ready: false, reason: "Set the shop HTTPS URL." } as const;
  if (env.MAIL_MAILER !== "smtp" || !env.MAIL_HOST || !env.MAIL_USERNAME || !env.MAIL_PASSWORD ||
    !Number.isSafeInteger(port) || port < 1 || port > 65535 ||
    !["smtp", "smtps"].includes(env.MAIL_SCHEME || "smtp") ||
    !address(env.MAIL_FROM_ADDRESS) || !address(env.SHOP_NOTIFICATION_EMAIL) ||
    (env.MAIL_REPLY_TO_ADDRESS && !address(env.MAIL_REPLY_TO_ADDRESS)))
    return { ready: false, reason: "Configure SMTP, sender and shop notification address." } as const;
  return { ready: true, reason: "SMTP configured. Delivery results appear below.",
    shopUrl: base.origin, owner: env.SHOP_NOTIFICATION_EMAIL!,
    from: { name: env.MAIL_FROM_NAME || "Toga Cards", address: env.MAIL_FROM_ADDRESS! },
    replyTo: env.MAIL_REPLY_TO_ADDRESS || env.SHOP_NOTIFICATION_EMAIL!,
    transport: {
      host: env.MAIL_HOST, port, secure: env.MAIL_SCHEME === "smtps" || port === 465,
      requireTLS: true,
      auth: { user: env.MAIL_USERNAME, pass: env.MAIL_PASSWORD },
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000,
      disableFileAccess: true, disableUrlAccess: true,
    },
  } as const;
}

// Inject the transport in tests; never make SMTP delivery part of a stock transaction.
export async function deliverOrderEmails(
  outbox: ReturnType<typeof createEmailOutbox>,
  configuration = emailConfiguration(),
  send = async (message: object) => {
    if (!configuration.ready) throw new Error("Email is not configured.");
    return nodemailer.createTransport(configuration.transport).sendMail(message);
  },
) {
  if (!configuration.ready) return;
  for (let count = 0; count < 20; count++) {
    const email = outbox.claim();
    if (!email) break;
    try {
      const to = email.audience === "owner" ? configuration.owner : email.recipient;
      if (!address(to)) throw Object.assign(new Error("Invalid recipient"), { code: "INVALID_RECIPIENT" });
      const result = await send({
        from: configuration.from, to, replyTo: configuration.replyTo,
        messageId: `<${email.id}@${new URL(configuration.shopUrl).hostname}>`,
        ...renderOrderEmail(email, configuration.shopUrl),
      });
      if (!result.accepted?.length || result.rejected?.length)
        throw Object.assign(new Error("Recipient not accepted"), { code: "RECIPIENT_REJECTED" });
      outbox.sent(email.id, email.token);
    } catch (error: any) {
      // Store only a bounded error code, never SMTP responses, credentials or customer data.
      outbox.failed(email.id, email.token, email.attempts, String(error?.code || "DELIVERY_FAILED"));
    }
  }
}
