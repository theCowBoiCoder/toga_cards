import { getInventory } from "../utils/inventory";
import { deliverOrderEmails, emailConfiguration } from "../utils/email-service";

export default defineNitroPlugin((nitro) => {
  const configuration = emailConfiguration();
  if (!configuration.ready) return;
  let running: Promise<void> | undefined;
  const tick = () => {
    if (running) return;
    running = deliverOrderEmails(getInventory().shop.emails, configuration)
      .catch(() => { console.error("Order email worker needs review."); })
      .finally(() => { running = undefined; });
  };
  tick();
  const timer = setInterval(tick, 15_000);
  timer.unref();
  nitro.hooks.hook("close", async () => {
    clearInterval(timer);
    await running;
  });
});
