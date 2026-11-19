import { recoverCheckouts } from "../utils/checkout-recovery";

export default defineNitroPlugin((nitro) => {
  if (process.env.TOGA_PREVIEW === "1" || !process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return;
  let running: Promise<void> | undefined;
  const tick = () => {
    if (running) return;
    running = recoverCheckouts().catch(() => {
      console.error("Checkout recovery needs review.");
    }).finally(() => { running = undefined; });
  };
  tick();
  const timer = setInterval(tick, 60_000);
  timer.unref();
  nitro.hooks.hook("close", async () => { clearInterval(timer); await running; });
});
