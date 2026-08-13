import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import { inspectContractRegistry } from "../src/blockchain/contract.js";
import { getEnv } from "../src/config/env.js";
import { openMigratedDatabase } from "../src/database/database.js";
import { AppRepository } from "../src/database/repositories.js";
import { findBotManagedRole, inspectTargetGuild } from "../src/discord/inspect.js";
import { SalesRepository } from "../src/sales/repository.js";
import { OpenSeaSalesService } from "../src/sales/service.js";
import { VerificationRepository } from "../src/verification/repository.js";
import { VerificationService } from "../src/verification/service.js";
import { buildVerificationServer } from "../src/web/server.js";

type Status = "PASS" | "WARN" | "FAIL";
interface Check {
  status: Status;
  name: string;
  detail: string;
}

async function main() {
  const env = getEnv();
  const checks: Check[] = [];
  const add = (status: Status, name: string, detail: string) =>
    checks.push({ status, name, detail });

  const contracts = await inspectContractRegistry(env);
  for (const contract of contracts) {
    if (contract.ok && contract.inspection) {
      add("PASS", `${contract.label} RPC`, `${contract.inspection.network} responded`);
      add("PASS", `${contract.label} chain`, `chain ID ${contract.inspection.chainId}`);
      add("PASS", `${contract.label} bytecode`, `deployed at ${contract.inspection.address}`);
      add("PASS", `${contract.label} ownership`, contract.inspection.ownershipMethod);
    } else {
      add("FAIL", `${contract.label} module`, contract.error ?? "validation failed");
    }
  }

  try {
    const snapshot = await inspectTargetGuild(env);
    add("PASS", "Bot authentication", `${snapshot.bot.username} (${snapshot.bot.id})`);
    add("PASS", "Target guild", `${snapshot.guild.name} (${snapshot.guild.id})`);
    add("PASS", "Guild owner", snapshot.guild.owner_id);
    const botRole = findBotManagedRole(snapshot);
    for (const desired of dyoorDiscordConfig.roles) {
      const existingId = "existingId" in desired ? desired.existingId : undefined;
      const role =
        (existingId
          ? snapshot.roles.find((candidate) => candidate.id === existingId)
          : undefined) ?? snapshot.roles.find((candidate) => candidate.name === desired.name);
      add(
        role ? "PASS" : "FAIL",
        `${desired.name} role`,
        role ? `position ${role.position}` : "not deployed",
      );
      if (role) {
        add(
          botRole.position > role.position ? "PASS" : "FAIL",
          `${desired.name} hierarchy`,
          `bot ${botRole.position}; role ${role.position}`,
        );
      }
    }
    const sales = snapshot.channels.find((channel) => channel.id === env.SALES_CHANNEL_ID);
    add(
      sales ? "PASS" : "FAIL",
      "Existing sales channel",
      sales ? `#${sales.name} (${sales.id})` : "configured channel is missing",
    );
    for (const error of snapshot.inspectionErrors)
      add(error.severity, `${error.resource} inspection`, error.message);
  } catch (error) {
    add("FAIL", "Discord validation", error instanceof Error ? error.message : "unknown failure");
  }

  const database = openMigratedDatabase(env.DATABASE_PATH);
  try {
    const row = database.prepare("SELECT 1 AS ok").get() as { ok: number };
    add(row.ok === 1 ? "PASS" : "FAIL", "Database", "SQLite migrations and query succeeded");
    const appRepository = new AppRepository(database);
    const verificationRepository = new VerificationRepository(database);

    if (!env.VERIFICATION_BASE_URL) {
      add("FAIL", "Verification URL", "VERIFICATION_BASE_URL is not configured");
    } else if (!env.SESSION_HMAC_SECRET) {
      add("FAIL", "Verification session secret", "SESSION_HMAC_SECRET is not configured");
    } else {
      try {
        const service = new VerificationService(env, verificationRepository);
        const web = await buildVerificationServer({
          env,
          repository: verificationRepository,
          service,
          onVerified: () => Promise.resolve(),
        });
        try {
          const response = await web.inject({ method: "GET", url: "/health" });
          add(
            response.statusCode === 200 ? "PASS" : "FAIL",
            "Verification backend",
            `health endpoint returned HTTP ${response.statusCode}`,
          );
        } finally {
          await web.close();
        }
      } catch (error) {
        add(
          "FAIL",
          "Verification backend",
          error instanceof Error ? error.message : "startup failed",
        );
      }
    }

    if (!env.OPENSEA_API_KEY) {
      add("FAIL", "Sales source", "OPENSEA_API_KEY is not configured");
    } else {
      const salesService = new OpenSeaSalesService(
        env,
        appRepository,
        new SalesRepository(database),
      );
      for (const source of await salesService.checkSources()) {
        add(source.ok ? "PASS" : "FAIL", `${source.key} sales source`, source.detail);
      }
    }
  } finally {
    database.close();
  }

  for (const check of checks) console.log(`${check.status} ${check.name} — ${check.detail}`);
  const counts = {
    PASS: checks.filter((check) => check.status === "PASS").length,
    WARN: checks.filter((check) => check.status === "WARN").length,
    FAIL: checks.filter((check) => check.status === "FAIL").length,
  };
  console.log(`\nPASS: ${counts.PASS}\nWARN: ${counts.WARN}\nFAIL: ${counts.FAIL}`);
  if (counts.FAIL) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown holder health-check error");
  process.exitCode = 1;
});
