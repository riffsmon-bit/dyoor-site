import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import { managedMessagePlan } from "../src/bot/panels.js";
import { commandRegistrationPlan } from "../src/bot/register-commands.js";
import { getEnv } from "../src/config/env.js";
import { automodPlan } from "../src/discord/automod.js";
import { AppRepository } from "../src/database/repositories.js";
import { openMigratedDatabase } from "../src/database/database.js";
import { inspectTargetGuild } from "../src/discord/inspect.js";
import { addPlanActions, buildDiscordPlan, formatDiscordPlan } from "../src/discord/plan.js";

async function main() {
  const env = getEnv();
  const snapshot = await inspectTargetGuild(env);
  const database = openMigratedDatabase(env.DATABASE_PATH);
  const repository = new AppRepository(database);
  const messageActions = managedMessagePlan(repository, dyoorDiscordConfig, env).map((message) => ({
    operation: message.operation,
    resource: "MESSAGE" as const,
    name: message.key,
    detail: `#${message.channelName}`,
  }));
  const extraActions = [
    ...messageActions,
    ...automodPlan(snapshot, dyoorDiscordConfig),
    ...commandRegistrationPlan(snapshot),
  ];
  database.close();
  const plan = addPlanActions(buildDiscordPlan(snapshot, dyoorDiscordConfig), extraActions);
  console.log(formatDiscordPlan(plan));
  if (plan.summary.failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown planning error");
  process.exitCode = 1;
});
