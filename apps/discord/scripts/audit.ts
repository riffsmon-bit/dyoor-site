import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import { getEnv } from "../src/config/env.js";
import { auditDiscord, formatAudit } from "../src/discord/audit.js";
import { inspectTargetGuild } from "../src/discord/inspect.js";

async function main() {
  const audit = auditDiscord(await inspectTargetGuild(getEnv()), dyoorDiscordConfig);
  console.log(formatAudit(audit));
  if (audit.summary.FAIL > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown audit error");
  process.exitCode = 1;
});
