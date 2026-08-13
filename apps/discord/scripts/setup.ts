import { inspectContractRegistry } from "../src/blockchain/contract.js";
import { getEnv } from "../src/config/env.js";
import { inspectTargetGuild, findBotManagedRole } from "../src/discord/inspect.js";
import { dangerousEveryonePermissions } from "../src/discord/permissions.js";

async function main() {
  const env = getEnv();
  console.log("✓ Environment values validated without printing secrets");
  const [snapshot, contracts] = await Promise.all([
    inspectTargetGuild(env),
    inspectContractRegistry(env),
  ]);
  const everyone = snapshot.roles.find((role) => role.id === snapshot.guild.id);
  if (!everyone) throw new Error("@everyone role was not returned by Discord");
  const dangerous = dangerousEveryonePermissions(everyone);
  if (dangerous.length) throw new Error(`Dangerous @everyone permissions: ${dangerous.join(", ")}`);
  const botRole = findBotManagedRole(snapshot);

  console.log(`✓ Existing bot authenticated: ${snapshot.bot.username} (${snapshot.bot.id})`);
  console.log(`✓ Target guild verified: ${snapshot.guild.name} (${snapshot.guild.id})`);
  console.log(`✓ Guild owner verified: ${snapshot.guild.owner_id}`);
  console.log(`✓ Bot-managed role found at position ${botRole.position}`);
  console.log(
    `✓ Inspected ${snapshot.roles.length} roles and ${snapshot.channels.length} channels`,
  );
  console.log("✓ @everyone dangerous base-permission audit passed");
  for (const contract of contracts) {
    if (!contract.ok) throw new Error(`${contract.label} validation failed: ${contract.error}`);
    console.log(
      `✓ ${contract.label}: ${contract.inspection?.network} (${contract.inspection?.chainId}), ${contract.inspection?.ownershipMethod}`,
    );
  }
  console.log("\nSetup inspection complete. No Discord resources were changed.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown setup error");
  process.exitCode = 1;
});
