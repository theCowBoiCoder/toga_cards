import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const project = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(process.execPath, ["node_modules/nuxt/bin/nuxt.mjs", "dev", "--port", "3100", "--host", "127.0.0.1"], {
  cwd: project,
  env: { ...process.env, DATA_DIR: fileURLToPath(new URL("../.preview-data", import.meta.url)), TOGA_PREVIEW: "1" },
  stdio: "inherit",
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", code => process.exit(code ?? 0));
