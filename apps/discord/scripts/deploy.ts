import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import { inspectContractRegistry } from "../src/blockchain/contract.js";
import { managedMessagePlan, publishManagedPanels } from "../src/bot/panels.js";
import { commandRegistrationPlan, registerGuildCommands } from "../src/bot/register-commands.js";
import { getEnv } from "../src/config/env.js";
import { AppRepository } from "../src/database/repositories.js";
import { openMigratedDatabase } from "../src/database/database.js";
import { auditDiscord, formatAudit } from "../src/discord/audit.js";
import { automodPlan, provisionAutomod } from "../src/discord/automod.js";
import {
  blockingPlanFailures,
  isTemporaryAdministratorFailure,
  temporaryAdminMigrationEnabled,
} from "../src/discord/deployment-gate.js";
import { createDiscordRest, inspectTargetGuild } from "../src/discord/inspect.js";
import { findBotManagedRole } from "../src/discord/inspect.js";
import { addPlanActions, buildDiscordPlan, formatDiscordPlan } from "../src/discord/plan.js";
import { provisionGuild } from "../src/discord/provision.js";
import { snapshotStorageRoot, writeDiscordSnapshot } from "../src/discord/snapshot.js";

async function confirmDeployment(guildId: string) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Interactive terminal required for live Discord deployment confirmation");
  }
  const phrase = `DEPLOY DYOOR TO ${guildId}`;
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(`\nType exactly: ${phrase}\n> `);
    if (answer !== phrase) throw new Error("Confirmation did not match; nothing changed");
  } finally {
    readline.close();
  }
}

async function confirmAdministratorRemoved(botRoleName: string) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Interactive terminal required to confirm Administrator removal");
  }
  const phrase = `ADMINISTRATOR REMOVED FROM ${botRoleName}`;
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(
      `\nRemove Administrator from ${botRoleName}, then type exactly: ${phrase}\n> `,
    );
    if (answer !== phrase) throw new Error("Administrator removal confirmation did not match");
  } finally {
    readline.close();
  }
}

function extras(
  snapshot: Awaited<ReturnType<typeof inspectTargetGuild>>,
  repository: AppRepository,
  env: ReturnType<typeof getEnv>,
) {
  return [
    ...managedMessagePlan(repository, dyoorDiscordConfig, env).map((message) => ({
      operation: message.operation,
      resource: "MESSAGE" as const,
      name: message.key,
      detail: `#${message.channelName}`,
    })),
    ...automodPlan(snapshot, dyoorDiscordConfig),
    ...commandRegistrationPlan(snapshot),
  ];
}

async function main() {
  const env = getEnv();
  const database = openMigratedDatabase(env.DATABASE_PATH);
  try {
    const repository = new AppRepository(database);
    const [before, contracts] = await Promise.all([
      inspectTargetGuild(env),
      inspectContractRegistry(env),
    ]);
    const failedContracts = contracts.filter((contract) => !contract.ok);
    if (failedContracts.length) {
      throw new Error(
        `Contract validation failed: ${failedContracts.map((item) => `${item.label}: ${item.error}`).join("; ")}`,
      );
    }

    const preAudit = auditDiscord(before, dyoorDiscordConfig);
    console.log(formatAudit(preAudit));

    const snapshotPath = await writeDiscordSnapshot(
      before,
      snapshotStorageRoot(),
      repository.listManagedMessages(),
    );
    console.log(`\nPre-deployment snapshot: ${snapshotPath}`);

    const plan = addPlanActions(
      buildDiscordPlan(before, dyoorDiscordConfig),
      extras(before, repository, env),
    );
    console.log(`\n${formatDiscordPlan(plan)}`);
    const botRoleName = findBotManagedRole(before).name;
    const allowTemporaryAdministrator = temporaryAdminMigrationEnabled(
      process.env.DYOOR_DISCORD_TEMPORARY_ADMIN,
      env.DISCORD_GUILD_ID,
    );
    const blockingFailures = blockingPlanFailures(
      plan.actions,
      botRoleName,
      allowTemporaryAdministrator,
    );
    if (blockingFailures.length > 0) {
      throw new Error("Pre-deployment plan contains failures; nothing changed");
    }
    if (allowTemporaryAdministrator) {
      const temporaryFailure = plan.actions.some((action) =>
        isTemporaryAdministratorFailure(action, botRoleName),
      );
      if (!temporaryFailure) {
        throw new Error("Temporary Administrator migration flag was set but is not required");
      }
      console.log(
        `\nTemporary migration exception accepted for ${botRoleName}; final verification remains blocked until Administrator is removed.`,
      );
    }
    if (!env.VERIFICATION_BASE_URL || !env.SESSION_HMAC_SECRET) {
      throw new Error("Secure wallet verification is not fully configured; nothing changed");
    }
    if (!env.OPENSEA_API_KEY) {
      throw new Error("Season 1/Season 2 sales source is not configured; nothing changed");
    }

    await confirmDeployment(env.DISCORD_GUILD_ID);
    const rest = createDiscordRest(env);
    const structural = await provisionGuild(rest, before, dyoorDiscordConfig);
    console.log(`\nStructure: ${JSON.stringify(structural)}`);

    const afterStructure = await inspectTargetGuild(env);
    const automod = await provisionAutomod(rest, afterStructure, dyoorDiscordConfig);
    console.log(`AutoMod: ${JSON.stringify(automod)}`);
    const commands = await registerGuildCommands(rest, env, repository);
    console.log(`Commands: ${JSON.stringify(commands)}`);
    const panels = await publishManagedPanels(
      rest,
      afterStructure,
      repository,
      dyoorDiscordConfig,
      env,
    );
    console.log(`Managed messages: ${JSON.stringify(panels)}`);

    if (allowTemporaryAdministrator) await confirmAdministratorRemoved(botRoleName);

    const after = await inspectTargetGuild(env);
    const postPlan = addPlanActions(
      buildDiscordPlan(after, dyoorDiscordConfig),
      extras(after, repository, env),
    );
    if (postPlan.summary.creates || postPlan.summary.updates || postPlan.summary.failures) {
      throw new Error(`Post-deployment verification failed:\n${formatDiscordPlan(postPlan)}`);
    }
    const postAudit = auditDiscord(after, dyoorDiscordConfig);
    console.log(`\n${formatAudit(postAudit)}`);
    if (postAudit.summary.FAIL > 0) throw new Error("Post-deployment audit contains failures");
    console.log("\nDYØØR Discord provisioning complete. Deletes performed: 0");
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown deployment error");
  process.exitCode = 1;
});
