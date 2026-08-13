import pino from "pino";
import { getEnv } from "../config/env.js";

const REDACTED_PATHS = [
  "token",
  "*.token",
  "authorization",
  "*.authorization",
  "req.headers.authorization",
  "DISCORD_BOT_TOKEN",
  "RPC_URL",
  "signature",
  "*.signature",
  "sessionToken",
  "*.sessionToken",
  "nonce",
  "*.nonce",
];

export function createLogger() {
  const env = getEnv();
  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
    base: { service: "dyoor-discord" },
  });
}
