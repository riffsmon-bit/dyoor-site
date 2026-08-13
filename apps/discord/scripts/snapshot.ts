import { getEnv } from "../src/config/env.js";
import { AppRepository } from "../src/database/repositories.js";
import { openMigratedDatabase } from "../src/database/database.js";
import { inspectTargetGuild } from "../src/discord/inspect.js";
import { snapshotStorageRoot, writeDiscordSnapshot } from "../src/discord/snapshot.js";

async function main() {
  const env = getEnv();
  const snapshot = await inspectTargetGuild(env);
  const database = openMigratedDatabase(env.DATABASE_PATH);
  const messages = new AppRepository(database).listManagedMessages();
  database.close();
  const path = await writeDiscordSnapshot(snapshot, snapshotStorageRoot(), messages);
  console.log(`Discord configuration snapshot written: ${path}`);
  console.log("This is a configuration recovery snapshot, not a Discord message backup.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown snapshot error");
  process.exitCode = 1;
});
