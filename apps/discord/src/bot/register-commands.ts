import { Routes, type REST } from "discord.js";
import { createHash } from "node:crypto";
import type { AppEnv } from "../config/env.js";
import type { AppRepository } from "../database/repositories.js";
import type { GuildSnapshot } from "../discord/inspect.js";
import type { PlanAction } from "../discord/plan.js";
import { commandJson } from "./command-definitions.js";

function commandHash() {
  return createHash("sha256").update(JSON.stringify(commandJson)).digest("hex");
}

export function commandRegistrationNeeded(repository: AppRepository) {
  return repository.getServerState<{ hash: string }>("guild-command-hash")?.hash !== commandHash();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key, child]) =>
            child !== undefined &&
            !(Array.isArray(child) && child.length === 0) &&
            !(child === false && (key === "required" || key === "autocomplete")),
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function comparableCommand(command: Record<string, unknown>) {
  return canonicalize({
    name: command.name,
    description: command.description,
    type: command.type ?? 1,
    options: command.options ?? [],
    default_member_permissions: command.default_member_permissions ?? null,
    nsfw: command.nsfw ?? false,
  });
}

export function commandRegistrationPlan(snapshot: GuildSnapshot): PlanAction[] {
  const desired = commandJson.map((command) =>
    comparableCommand(command as unknown as Record<string, unknown>),
  );
  const existing = snapshot.guildCommands.map((command) =>
    comparableCommand(command as unknown as Record<string, unknown>),
  );
  if (JSON.stringify(existing) === JSON.stringify(desired)) return [];
  return [
    {
      operation: existing.length === 0 ? "CREATE" : "UPDATE",
      resource: "COMMANDS",
      name: "DYØØR guild slash commands",
      detail: `${commandJson.length} commands; guild-scoped registration`,
    },
  ];
}

export async function registerGuildCommands(rest: REST, env: AppEnv, repository: AppRepository) {
  const result = await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
    {
      body: commandJson,
    },
  );
  repository.setServerState("guild-command-hash", {
    hash: commandHash(),
    updatedAt: new Date().toISOString(),
  });
  return { registered: Array.isArray(result) ? result.length : commandJson.length };
}
