import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { APIGuildChannel, APIRole } from "discord-api-types/v10";
import type { DesiredChannel, DesiredRole, ProjectConfig } from "./model.js";
import type { GuildSnapshot } from "./inspect.js";
import { buildDiscordPlan } from "./plan.js";
import {
  dangerousEveryonePermissions,
  privilegedPermissions,
  requiredBotPermissions,
} from "./permissions.js";
import { findBotManagedRole } from "./inspect.js";
import { automodPlan } from "./automod.js";

export type AuditStatus = "PASS" | "WARN" | "FAIL";

export interface AuditCheck {
  status: AuditStatus;
  name: string;
  detail: string;
}

export interface DiscordAudit {
  checkedAt: string;
  checks: AuditCheck[];
  summary: Record<AuditStatus, number>;
}

function overwriteBits(channel: APIGuildChannel, roleId: string) {
  const overwrite = channel.permission_overwrites?.find(
    (candidate) => Number(candidate.type) === 0 && candidate.id === roleId,
  );
  return {
    allow: BigInt(overwrite?.allow ?? 0),
    deny: BigInt(overwrite?.deny ?? 0),
  };
}

function roleMatch(roles: readonly APIRole[], desired: DesiredRole) {
  if (desired.existingId) {
    const byId = roles.find((role) => role.id === desired.existingId);
    if (byId) return byId;
  }
  const names = new Set(
    [desired.name, ...(desired.aliases ?? [])].map((name) => name.toLowerCase()),
  );
  return roles.find((role) => !role.managed && names.has(role.name.toLowerCase()));
}

function channelMatch(channels: readonly APIGuildChannel[], desired: DesiredChannel) {
  if (desired.existingId) {
    const byId = channels.find((channel) => channel.id === desired.existingId);
    if (byId) return byId;
  }
  const names = new Set(
    [desired.name, ...(desired.aliases ?? [])].map((name) => name.toLowerCase()),
  );
  return channels.find((channel) => names.has(channel.name.toLowerCase()));
}

function expectedAudience(policy: DesiredChannel["access"]) {
  if (policy === "season1-ascended-chat") return ["season1", "ascended"] as const;
  if (policy === "season2-chat") return ["season2"] as const;
  if (policy === "hoodyoor-chat") return ["hoodyoor"] as const;
  if (
    policy === "dyoorified-readonly" ||
    policy === "dyoorified-chat" ||
    policy === "sales-readonly" ||
    policy === "ticket-panel"
  ) {
    return ["dyoorified"] as const;
  }
  return [] as const;
}

export function auditDiscord(snapshot: GuildSnapshot, config: ProjectConfig): DiscordAudit {
  const checks: AuditCheck[] = [];
  const add = (status: AuditStatus, name: string, detail: string) =>
    checks.push({ status, name, detail });

  add("PASS", "Bot authentication", `${snapshot.bot.username} (${snapshot.bot.id}) authenticated`);
  add(
    snapshot.guild.id === config.expected.guildId &&
      snapshot.guild.name === config.expected.guildName
      ? "PASS"
      : "FAIL",
    "Guild identity",
    `${snapshot.guild.name} (${snapshot.guild.id})`,
  );
  add(
    snapshot.guild.owner_id === config.expected.ownerId ? "PASS" : "FAIL",
    "Owner identity",
    snapshot.guild.owner_id,
  );
  add(
    snapshot.application.id === config.expected.applicationId ? "PASS" : "FAIL",
    "Application identity",
    `${snapshot.application.name} (${snapshot.application.id})`,
  );
  add(
    snapshot.application.bot_public ? "WARN" : "PASS",
    "Public bot installation",
    snapshot.application.bot_public
      ? "application is public and can be installed in other servers"
      : "restricted to the owner/team",
  );

  const everyone = snapshot.roles.find((role) => role.id === snapshot.guild.id);
  if (!everyone) {
    add("FAIL", "@everyone role", "missing from API response");
  } else {
    const dangerous = dangerousEveryonePermissions(everyone);
    add(
      dangerous.length === 0 ? "PASS" : "FAIL",
      "Dangerous @everyone permissions",
      dangerous.length === 0 ? "none detected" : dangerous.join(", "),
    );
  }

  const botRole = findBotManagedRole(snapshot);
  const botBase = BigInt(botRole.permissions) | BigInt(everyone?.permissions ?? 0);
  const botPermissions = new PermissionsBitField(botBase);
  add(
    botPermissions.has(PermissionFlagsBits.Administrator) ? "FAIL" : "PASS",
    "Bot Administrator permission",
    botPermissions.has(PermissionFlagsBits.Administrator) ? "remove Administrator" : "not granted",
  );
  const missing = requiredBotPermissions(config) & ~botBase;
  add(
    missing === 0n ? "PASS" : "FAIL",
    "Bot least-privilege capability set",
    missing === 0n ? "complete without Administrator" : `missing bitfield ${missing}`,
  );

  const configuredRoles = new Map(
    config.roles.map((desired) => [desired.key, roleMatch(snapshot.roles, desired)] as const),
  );
  for (const desired of config.roles) {
    const live = configuredRoles.get(desired.key);
    add(
      live ? "PASS" : "FAIL",
      `Role: ${desired.name}`,
      live ? `present at position ${live.position}` : "missing",
    );
    if (live) {
      add(
        live.position < botRole.position ? "PASS" : "FAIL",
        `Role hierarchy: ${desired.name}`,
        `role ${live.position}; bot ${botRole.position}`,
      );
      const dangerous = privilegedPermissions(live);
      add(
        dangerous.length === 0 ? "PASS" : "FAIL",
        `Holder-role privilege: ${desired.name}`,
        dangerous.length ? dangerous.join(", ") : "no moderation or administrative permissions",
      );
    }
  }

  for (const reference of config.staffRoles) {
    const live = snapshot.roles.find((role) => role.id === reference.existingId);
    add(
      live?.name === reference.name ? "PASS" : "FAIL",
      `Staff role: ${reference.name}`,
      live ? `ID ${live.id}; position ${live.position}` : "missing",
    );
    if (live) {
      add(
        live.position > botRole.position ? "PASS" : "FAIL",
        `Protected hierarchy: ${reference.name}`,
        live.position > botRole.position
          ? "bot cannot manage this role"
          : "role is below bot and can be manipulated if the bot is compromised",
      );
    }
  }

  const protectedIds = new Set([
    snapshot.guild.id,
    botRole.id,
    ...config.roles.map((role) => configuredRoles.get(role.key)?.id).filter(Boolean),
    ...config.staffRoles.map((role) => role.existingId),
  ]);
  const privilegedBelowBot = snapshot.roles.filter(
    (role) =>
      !role.managed &&
      !protectedIds.has(role.id) &&
      role.position < botRole.position &&
      privilegedPermissions(role).length > 0,
  );
  add(
    privilegedBelowBot.length === 0 ? "PASS" : "FAIL",
    "Bot-manageable privileged roles",
    privilegedBelowBot.length
      ? privilegedBelowBot
          .map((role) => `${role.name}: ${privilegedPermissions(role).join(", ")}`)
          .join("; ")
      : "none",
  );

  const thirdPartyAdmins = snapshot.roles.filter(
    (role) =>
      role.managed &&
      role.tags?.bot_id &&
      role.tags.bot_id !== snapshot.bot.id &&
      new PermissionsBitField(BigInt(role.permissions)).has(PermissionFlagsBits.Administrator),
  );
  add(
    thirdPartyAdmins.length === 0 ? "PASS" : "WARN",
    "Third-party Administrator bots",
    thirdPartyAdmins.length
      ? thirdPartyAdmins.map((role) => role.name).join(", ")
      : "none detected",
  );

  for (const category of config.categories) {
    for (const desired of category.channels) {
      const live = channelMatch(snapshot.channels, desired);
      add(
        live ? "PASS" : "FAIL",
        `Channel: ${desired.key}`,
        live ? `#${live.name} (${live.id})` : "missing",
      );
      if (!live) continue;
      const everyoneBits = overwriteBits(live, snapshot.guild.id);
      if (desired.access === "entry-readonly" || desired.access === "entry-verification") {
        const correct =
          (everyoneBits.allow & PermissionFlagsBits.ViewChannel) !== 0n &&
          (everyoneBits.deny & PermissionFlagsBits.SendMessages) !== 0n;
        add(
          correct ? "PASS" : "FAIL",
          `Entry access: ${desired.key}`,
          correct ? "new members can view but cannot post" : "entry permissions are incorrect",
        );
      } else {
        const hidden = (everyoneBits.deny & PermissionFlagsBits.ViewChannel) !== 0n;
        add(
          hidden ? "PASS" : "FAIL",
          `Private boundary: ${desired.key}`,
          hidden ? "@everyone denied View Channel" : "@everyone is not explicitly denied",
        );
      }
      for (const key of expectedAudience(desired.access)) {
        const role = configuredRoles.get(key);
        if (!role) continue;
        const bits = overwriteBits(live, role.id);
        const allowed = (bits.allow & PermissionFlagsBits.ViewChannel) !== 0n;
        add(
          allowed ? "PASS" : "FAIL",
          `Role access: ${desired.key} ← ${role.name}`,
          allowed ? "View Channel allowed" : "required role lacks View Channel",
        );
      }
    }
  }

  const legacySignatureCommand = snapshot.guildCommands.find(
    (command) =>
      command.name === "verify-confirm" &&
      command.options?.some((option) => option.name === "signature"),
  );
  add(
    legacySignatureCommand ? "FAIL" : "PASS",
    "Signature handling UX",
    legacySignatureCommand
      ? "legacy command asks users to paste wallet signatures into Discord"
      : "signatures remain inside the secure verification browser flow",
  );

  add(
    snapshot.guild.features.some((feature) => String(feature) === "COMMUNITY") ? "PASS" : "WARN",
    "Discord Community",
    snapshot.guild.features.some((feature) => String(feature) === "COMMUNITY")
      ? "enabled"
      : "manual setup required",
  );
  add(
    Number(snapshot.guild.verification_level) >= 2 ? "PASS" : "FAIL",
    "Verification level",
    `level ${snapshot.guild.verification_level}`,
  );
  add(
    Number(snapshot.guild.explicit_content_filter) === 2 ? "PASS" : "WARN",
    "Explicit media filtering",
    `setting ${snapshot.guild.explicit_content_filter}`,
  );
  add(
    Number(snapshot.guild.mfa_level) > 0 ? "PASS" : "FAIL",
    "Moderator 2FA",
    Number(snapshot.guild.mfa_level) > 0 ? "required" : "not required",
  );

  const onboardingEnabled = snapshot.onboarding?.enabled === true;
  add(
    onboardingEnabled ? "PASS" : "WARN",
    "Discord onboarding",
    onboardingEnabled ? "enabled" : "disabled",
  );
  const memberIntent = ((snapshot.application.flags ?? 0) & ((1 << 14) | (1 << 15))) !== 0;
  add(
    memberIntent ? "PASS" : "FAIL",
    "Server Members intent",
    memberIntent ? "enabled" : "not enabled; join monitoring and member sync are incomplete",
  );

  if (snapshot.inspectionErrors.length) {
    for (const error of snapshot.inspectionErrors) {
      add(error.severity, `${error.resource} inspection`, error.message);
    }
  } else {
    add(
      "PASS",
      "Discord security inspection scope",
      "AutoMod, onboarding, integrations, and webhooks readable",
    );
  }

  const automodActions = automodPlan(snapshot, config).filter(
    (action) => action.resource === "AUTOMOD" && action.operation !== "UNMANAGED",
  );
  for (const desired of config.automodRules) {
    const action = automodActions.find((candidate) => candidate.name === desired.name);
    add(
      !action || action.operation === "UNCHANGED"
        ? "PASS"
        : action.operation === "WARN"
          ? "WARN"
          : "FAIL",
      `AutoMod: ${desired.name}`,
      action
        ? (action.detail ?? `${action.operation.toLowerCase()} required`)
        : "present and current",
    );
  }

  const plan = buildDiscordPlan(snapshot, config);
  add(
    plan.summary.deletes === 0 ? "PASS" : "FAIL",
    "Deletion policy",
    `planned deletes: ${plan.summary.deletes}`,
  );

  const summary = {
    PASS: checks.filter((check) => check.status === "PASS").length,
    WARN: checks.filter((check) => check.status === "WARN").length,
    FAIL: checks.filter((check) => check.status === "FAIL").length,
  };
  return { checkedAt: new Date().toISOString(), checks, summary };
}

export function formatAudit(audit: DiscordAudit) {
  return [
    ...audit.checks.map((check) => `${check.status} ${check.name} — ${check.detail}`),
    "",
    `PASS: ${audit.summary.PASS}`,
    `WARN: ${audit.summary.WARN}`,
    `FAIL: ${audit.summary.FAIL}`,
  ].join("\n");
}
