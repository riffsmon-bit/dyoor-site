import { ChannelType, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { APIGuildChannel, APIRole } from "discord-api-types/v10";
import type {
  DesiredCategory,
  DesiredChannel,
  DesiredRole,
  ProjectConfig,
  RoleKey,
  StaffRoleKey,
} from "./model.js";
import type { GuildSnapshot } from "./inspect.js";
import {
  buildOverwrites,
  dangerousEveryonePermissions,
  discordChannelType,
  normalizeOverwrites,
  privilegedPermissions,
  requiredBotPermissions,
} from "./permissions.js";
import { findBotManagedRole } from "./inspect.js";

export type PlanOperation = "CREATE" | "UPDATE" | "UNCHANGED" | "UNMANAGED" | "WARN" | "FAIL";
export type PlanResource =
  | "ROLE"
  | "CATEGORY"
  | "CHANNEL"
  | "MESSAGE"
  | "EVENT"
  | "COMMANDS"
  | "AUTOMOD"
  | "PERMISSIONS"
  | "SERVER"
  | "CONTRACT"
  | "SALES";

export interface PlanAction {
  operation: PlanOperation;
  resource: PlanResource;
  name: string;
  detail?: string;
}

export interface DiscordPlan {
  generatedAt: string;
  guildId: string;
  guildName: string;
  actions: PlanAction[];
  summary: {
    creates: number;
    updates: number;
    unchanged: number;
    deletes: 0;
    unmanaged: number;
    warnings: number;
    failures: number;
  };
}

function summarize(actions: readonly PlanAction[]): DiscordPlan["summary"] {
  const count = (operation: PlanOperation) =>
    actions.filter((item) => item.operation === operation).length;
  return {
    creates: count("CREATE"),
    updates: count("UPDATE"),
    unchanged: count("UNCHANGED"),
    deletes: 0,
    unmanaged: count("UNMANAGED"),
    warnings: count("WARN"),
    failures: count("FAIL"),
  };
}

export function addPlanActions(plan: DiscordPlan, actions: readonly PlanAction[]): DiscordPlan {
  const combined = [...plan.actions, ...actions];
  return { ...plan, actions: combined, summary: summarize(combined) };
}

function unique<T>(matches: readonly T[], label: string): T | undefined {
  if (matches.length > 1) throw new Error(`Duplicate existing Discord resources match ${label}`);
  return matches[0];
}

function namesFor(item: { name: string; aliases?: readonly string[] }) {
  return new Set([item.name, ...(item.aliases ?? [])].map((value) => value.toLowerCase()));
}

function desiredRoleMatch(roles: readonly APIRole[], desired: DesiredRole) {
  if (desired.existingId) {
    const byId = roles.find((role) => role.id === desired.existingId);
    if (byId) return byId;
  }
  const names = namesFor(desired);
  return unique(
    roles.filter((role) => !role.managed && names.has(role.name.toLowerCase())),
    `role ${desired.name}`,
  );
}

function desiredCategoryMatch(channels: readonly APIGuildChannel[], desired: DesiredCategory) {
  if (desired.existingId) {
    const byId = channels.find(
      (channel) => channel.id === desired.existingId && channel.type === ChannelType.GuildCategory,
    );
    if (byId) return byId;
  }
  const names = namesFor(desired);
  return unique(
    channels.filter(
      (channel) =>
        channel.type === ChannelType.GuildCategory && names.has(channel.name.toLowerCase()),
    ),
    `category ${desired.name}`,
  );
}

function desiredChannelMatch(channels: readonly APIGuildChannel[], desired: DesiredChannel) {
  const type = discordChannelType(desired.type);
  if (desired.existingId) {
    const byId = channels.find(
      (channel) => channel.id === desired.existingId && channel.type === type,
    );
    if (byId) return byId;
  }
  const names = namesFor(desired);
  return unique(
    channels.filter((channel) => channel.type === type && names.has(channel.name.toLowerCase())),
    `channel ${desired.name}`,
  );
}

function roleNeedsSecurityUpdate(existing: APIRole, desired: DesiredRole) {
  return existing.name !== desired.name || privilegedPermissions(existing).length > 0;
}

function channelDifferences(
  channel: APIGuildChannel,
  desired: DesiredChannel,
  categoryId: string | undefined,
  overwrites: ReturnType<typeof buildOverwrites> | undefined,
) {
  const reasons: string[] = [];
  if (channel.name !== desired.name) reasons.push(`name → ${desired.name}`);
  if (categoryId && channel.parent_id !== categoryId) reasons.push("category placement");
  if (channel.type === ChannelType.GuildText) {
    const topic = "topic" in channel ? channel.topic : null;
    const slowmode = "rate_limit_per_user" in channel ? channel.rate_limit_per_user : 0;
    if ((topic ?? undefined) !== desired.topic) reasons.push("topic");
    if ((slowmode ?? 0) !== (desired.slowmodeSeconds ?? 0)) reasons.push("slowmode");
  }
  if (
    overwrites &&
    JSON.stringify(normalizeOverwrites(channel.permission_overwrites ?? [])) !==
      JSON.stringify(normalizeOverwrites(overwrites))
  ) {
    reasons.push("permission overwrites");
  }
  return reasons;
}

export function buildDiscordPlan(snapshot: GuildSnapshot, config: ProjectConfig): DiscordPlan {
  const actions: PlanAction[] = [];
  const everyone = snapshot.roles.find((role) => role.id === snapshot.guild.id);
  if (!everyone) throw new Error("Discord snapshot is missing the @everyone role");
  const botRole = findBotManagedRole(snapshot);

  const dangerous = dangerousEveryonePermissions(everyone);
  actions.push({
    operation: dangerous.length ? "FAIL" : "UNCHANGED",
    resource: "PERMISSIONS",
    name: "@everyone base permissions",
    detail: dangerous.length
      ? `dangerous permissions: ${dangerous.join(", ")}`
      : "no dangerous permissions",
  });

  const botPermissions = new PermissionsBitField(
    BigInt(everyone.permissions) | BigInt(botRole.permissions),
  );
  const required = requiredBotPermissions(config);
  const missingBotPermissions = required & ~botPermissions.bitfield;
  const botIsAdmin = botPermissions.has(PermissionFlagsBits.Administrator);
  if (botIsAdmin) {
    actions.push({
      operation: "FAIL",
      resource: "PERMISSIONS",
      name: botRole.name,
      detail: "Administrator is prohibited for the DYØØR bot",
    });
  } else if (missingBotPermissions !== 0n) {
    actions.push({
      operation: "FAIL",
      resource: "PERMISSIONS",
      name: botRole.name,
      detail: `missing required permission bitfield ${missingBotPermissions}`,
    });
  } else {
    actions.push({
      operation: "UNCHANGED",
      resource: "PERMISSIONS",
      name: botRole.name,
      detail: "least-privilege production permission set is satisfied",
    });
  }

  const roleIds = new Map<RoleKey, string>();
  const managedRoleIds = new Set<string>();
  for (const desired of config.roles) {
    const existing = desiredRoleMatch(snapshot.roles, desired);
    if (!existing) {
      actions.push({ operation: "CREATE", resource: "ROLE", name: desired.name });
      continue;
    }
    roleIds.set(desired.key, existing.id);
    managedRoleIds.add(existing.id);
    if (existing.position >= botRole.position) {
      actions.push({
        operation: "FAIL",
        resource: "ROLE",
        name: existing.name,
        detail: `bot position ${botRole.position}; role position ${existing.position}`,
      });
    } else if (roleNeedsSecurityUpdate(existing, desired)) {
      actions.push({
        operation: "UPDATE",
        resource: "ROLE",
        name: existing.name,
        detail:
          existing.name === desired.name
            ? "remove privileged base permissions"
            : `rename to ${desired.name}`,
      });
    } else {
      actions.push({ operation: "UNCHANGED", resource: "ROLE", name: existing.name });
    }
  }

  const staffRoleIds = new Map<StaffRoleKey, string>();
  for (const reference of config.staffRoles) {
    const existing = snapshot.roles.find((role) => role.id === reference.existingId);
    if (!existing || existing.name !== reference.name) {
      actions.push({
        operation: "FAIL",
        resource: "ROLE",
        name: reference.name,
        detail: existing
          ? `configured ID currently belongs to ${existing.name}`
          : "configured staff role is missing",
      });
      continue;
    }
    staffRoleIds.set(reference.key, existing.id);
    if (existing.position <= botRole.position) {
      actions.push({
        operation: "FAIL",
        resource: "ROLE",
        name: existing.name,
        detail: `staff role must be above bot; staff ${existing.position}, bot ${botRole.position}`,
      });
    } else {
      actions.push({
        operation: "UNCHANGED",
        resource: "ROLE",
        name: existing.name,
        detail: "protected above the bot role",
      });
    }
  }

  for (const role of snapshot.roles) {
    if (
      role.id === snapshot.guild.id ||
      role.id === botRole.id ||
      role.managed ||
      managedRoleIds.has(role.id) ||
      [...staffRoleIds.values()].includes(role.id)
    ) {
      continue;
    }
    const privileged = privilegedPermissions(role);
    if (role.position < botRole.position && privileged.length > 0) {
      actions.push({
        operation: "FAIL",
        resource: "ROLE",
        name: role.name,
        detail: `privileged role is manageable by bot: ${privileged.join(", ")}`,
      });
    } else {
      actions.push({
        operation: "UNMANAGED",
        resource: "ROLE",
        name: role.name,
        detail: "preserved; deletes remain disabled",
      });
    }
  }

  const canResolveOverwrites =
    roleIds.size === config.roles.length && staffRoleIds.size === config.staffRoles.length;
  const permissionContext = canResolveOverwrites
    ? { everyoneId: snapshot.guild.id, botRoleId: botRole.id, roleIds, staffRoleIds }
    : undefined;
  const managedChannelIds = new Set<string>();
  const managedCategoryIds = new Set<string>();

  for (const desiredCategory of config.categories) {
    const category = desiredCategoryMatch(snapshot.channels, desiredCategory);
    if (!category) {
      actions.push({ operation: "CREATE", resource: "CATEGORY", name: desiredCategory.name });
    } else {
      managedCategoryIds.add(category.id);
      actions.push(
        category.name === desiredCategory.name
          ? { operation: "UNCHANGED", resource: "CATEGORY", name: category.name }
          : {
              operation: "UPDATE",
              resource: "CATEGORY",
              name: category.name,
              detail: `rename to ${desiredCategory.name}`,
            },
      );
    }

    for (const desired of desiredCategory.channels) {
      const existing = desiredChannelMatch(snapshot.channels, desired);
      if (!existing) {
        actions.push({
          operation: "CREATE",
          resource: "CHANNEL",
          name: desired.type === "text" ? `#${desired.name}` : desired.name,
          detail: `${desiredCategory.name}; ${desired.access}`,
        });
        continue;
      }
      managedChannelIds.add(existing.id);
      const overwrites = permissionContext
        ? buildOverwrites(desired.access, permissionContext)
        : undefined;
      const differences = channelDifferences(existing, desired, category?.id, overwrites);
      if (!permissionContext) differences.push("permission overwrites after role creation");
      actions.push({
        operation: differences.length ? "UPDATE" : "UNCHANGED",
        resource: "CHANNEL",
        name: `#${existing.name}`,
        detail: differences.length ? differences.join(", ") : desired.access,
      });
    }
  }

  for (const channel of snapshot.channels) {
    const managed =
      (channel.type === ChannelType.GuildCategory && managedCategoryIds.has(channel.id)) ||
      (channel.type !== ChannelType.GuildCategory && managedChannelIds.has(channel.id));
    if (!managed) {
      actions.push({
        operation: "UNMANAGED",
        resource: channel.type === ChannelType.GuildCategory ? "CATEGORY" : "CHANNEL",
        name: channel.name,
        detail: "preserved; deletes remain disabled",
      });
    }
  }

  actions.push({
    operation: snapshot.guild.features.some((feature) => String(feature) === "COMMUNITY")
      ? "UNCHANGED"
      : "WARN",
    resource: "SERVER",
    name: "Community",
    detail: snapshot.guild.features.some((feature) => String(feature) === "COMMUNITY")
      ? "enabled"
      : "must be enabled manually",
  });
  actions.push({
    operation: Number(snapshot.guild.mfa_level) > 0 ? "UNCHANGED" : "FAIL",
    resource: "SERVER",
    name: "Moderator 2FA",
    detail:
      Number(snapshot.guild.mfa_level) > 0 ? "required" : "not required; enable before deployment",
  });
  const memberIntent = ((snapshot.application.flags ?? 0) & ((1 << 14) | (1 << 15))) !== 0;
  actions.push({
    operation: memberIntent ? "UNCHANGED" : "FAIL",
    resource: "SERVER",
    name: "Server Members intent",
    detail: memberIntent
      ? "enabled for member joins and role synchronization"
      : "enable in the existing bot application before deployment",
  });
  if (snapshot.inspectionErrors.length > 0) {
    for (const error of snapshot.inspectionErrors) {
      actions.push({
        operation: error.severity,
        resource: "SERVER",
        name: `${error.resource} inspection`,
        detail: error.message,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    guildId: snapshot.guild.id,
    guildName: snapshot.guild.name,
    actions,
    summary: summarize(actions),
  };
}

export function formatDiscordPlan(plan: DiscordPlan): string {
  const lines = ["DYØØR Discord dry-run", `Target: ${plan.guildName} (${plan.guildId})`, ""];
  for (const action of plan.actions) {
    lines.push(
      `${action.operation} ${action.resource}: ${action.name}${action.detail ? ` — ${action.detail}` : ""}`,
    );
  }
  lines.push(
    "",
    `Creates: ${plan.summary.creates}`,
    `Updates: ${plan.summary.updates}`,
    `Unchanged: ${plan.summary.unchanged}`,
    "Deletes: 0",
    `Unmanaged: ${plan.summary.unmanaged}`,
    `Warnings: ${plan.summary.warnings}`,
    `Failures: ${plan.summary.failures}`,
  );
  return lines.join("\n");
}
