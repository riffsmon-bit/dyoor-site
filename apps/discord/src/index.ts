import { startRuntime } from "./bot/runtime.js";

startRuntime().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "DYØØR runtime failed");
  process.exitCode = 1;
});
