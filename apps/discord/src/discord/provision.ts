import { ChannelType, Routes, type REST } from "discord.js";
import type { APIGuildChannel, APIRole, APIOverwrite } from "discord-api-types/v10";
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
  discordChannelType,
  normalizeOverwrites,
  privilegedPermissions,
} from "./permissions.js";

const reason = "Approved DYØØR idempotent server provisioning";

export interface DeployResult {
  rolesCreated: number;
  rolesUpdated: number;
  categoriesCreated: number;
  categoriesUpdated: number;
  channelsCreated: number;
  channelsUpdated: number;
  deletes: 0;
}

function unique<T>(matches: readonly T[], label: string): T | undefined {
  if (matches.length > 1) throw new Error(`Refusing to provision duplicate ${label}`);
  return matches[0];
}

function namesFor(item: { name: string; aliases?: readonly string[] }) {
  return new Set([item.name, ...(item.aliases ?? [])].map((value) => value.toLowerCase()));
}

function resolveRole(roles: readonly APIRole[], desired: DesiredRole) {
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

function resolveCategory(channels: readonly APIGuildChannel[], desired: DesiredCategory) {
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

function resolveChannel(channels: readonly APIGuildChannel[], desired: DesiredChannel) {
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

function sameOverwrites(left: readonly APIOverwrite[] | undefined, right: readonly APIOverwrite[]) {
  return (
    JSON.stringify(normalizeOverwrites(left ?? [])) === JSON.stringify(normalizeOverwrites(right))
  );
}

function createRoleBody(role: DesiredRole) {
  return {
    name: role.name,
    permissions: role.permissions.toString(),
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
  };
}

function channelDiffers(
  existing: APIGuildChannel,
  desired: DesiredChannel,
  categoryId: string,
  overwrites: readonly APIOverwrite[],
) {
  if (existing.name !== desired.name || existing.parent_id !== categoryId) return true;
  if (!sameOverwrites(existing.permission_overwrites, overwrites)) return true;
  if (existing.type === ChannelType.GuildText) {
    const topic = "topic" in existing ? existing.topic : null;
    const slowmode = "rate_limit_per_user" in existing ? existing.rate_limit_per_user : 0;
    return (
      (topic ?? undefined) !== desired.topic || (slowmode ?? 0) !== (desired.slowmodeSeconds ?? 0)
    );
  }
  return false;
}

export async function provisionGuild(
  rest: REST,
  snapshot: GuildSnapshot,
  config: ProjectConfig,
): Promise<DeployResult> {
  const result: DeployResult = {
    rolesCreated: 0,
    rolesUpdated: 0,
    categoriesCreated: 0,
    categoriesUpdated: 0,
    channelsCreated: 0,
    channelsUpdated: 0,
    deletes: 0,
  };
  const guildId = snapshot.guild.id;
  let roles = [...snapshot.roles];

  for (const desired of config.roles) {
    const existing = resolveRole(roles, desired);
    if (!existing) {
      const created = (await rest.post(Routes.guildRoles(guildId), {
        body: createRoleBody(desired),
        reason,
      })) as APIRole;
      roles.push(created);
      result.rolesCreated += 1;
      continue;
    }
    const privileged = privilegedPermissions(existing);
    if (existing.name !== desired.name || privileged.length > 0) {
      const updated = (await rest.patch(Routes.guildRole(guildId, existing.id), {
        body: {
          ...(existing.name !== desired.name ? { name: desired.name } : {}),
          ...(privileged.length > 0 ? { permissions: desired.permissions.toString() } : {}),
        },
        reason,
      })) as APIRole;
      roles = roles.map((role) => (role.id === updated.id ? updated : role));
      result.rolesUpdated += 1;
    }
  }

  roles = (await rest.get(Routes.guildRoles(guildId))) as APIRole[];
  const botRole = unique(
    roles.filter((role) => role.tags?.bot_id === snapshot.bot.id),
    "bot-managed role",
  );
  if (!botRole) throw new Error("Bot-managed role disappeared during provisioning");
  const roleIds = new Map<RoleKey, string>();
  for (const desired of config.roles) {
    const live = resolveRole(roles, desired);
    if (!live) throw new Error(`Role ${desired.name} was not created`);
    if (live.position >= botRole.position)
      throw new Error(`Bot role must remain above ${desired.name}`);
    roleIds.set(desired.key, live.id);
  }
  const staffRoleIds = new Map<StaffRoleKey, string>();
  for (const reference of config.staffRoles) {
    const role = roles.find((candidate) => candidate.id === reference.existingId);
    if (!role || role.name !== reference.name)
      throw new Error(`Staff role ${reference.name} changed`);
    if (role.position <= botRole.position)
      throw new Error(`${reference.name} must be above the bot role`);
    staffRoleIds.set(reference.key, role.id);
  }

  let channels = [...snapshot.channels];
  const permissionContext = {
    everyoneId: guildId,
    botRoleId: botRole.id,
    roleIds,
    staffRoleIds,
  };
  for (const desiredCategory of config.categories) {
    let category = resolveCategory(channels, desiredCategory);
    if (!category) {
      category = (await rest.post(Routes.guildChannels(guildId), {
        body: { name: desiredCategory.name, type: ChannelType.GuildCategory },
        reason,
      })) as APIGuildChannel;
      channels.push(category);
      result.categoriesCreated += 1;
    } else if (category.name !== desiredCategory.name) {
      const updated = (await rest.patch(Routes.channel(category.id), {
        body: { name: desiredCategory.name },
        reason,
      })) as APIGuildChannel;
      channels = channels.map((channel) => (channel.id === updated.id ? updated : channel));
      category = updated;
      result.categoriesUpdated += 1;
    }

    for (const desired of desiredCategory.channels) {
      const type = discordChannelType(desired.type);
      const overwrites = buildOverwrites(desired.access, permissionContext);
      const existing = resolveChannel(channels, desired);
      const body = {
        name: desired.name,
        type,
        parent_id: category.id,
        permission_overwrites: overwrites,
        ...(desired.type === "text"
          ? { topic: desired.topic ?? null, rate_limit_per_user: desired.slowmodeSeconds ?? 0 }
          : {}),
      };
      if (!existing) {
        const created = (await rest.post(Routes.guildChannels(guildId), {
          body,
          reason,
        })) as APIGuildChannel;
        channels.push(created);
        result.channelsCreated += 1;
      } else if (channelDiffers(existing, desired, category.id, overwrites)) {
        const updated = (await rest.patch(Routes.channel(existing.id), {
          body,
          reason,
        })) as APIGuildChannel;
        channels = channels.map((channel) => (channel.id === updated.id ? updated : channel));
        result.channelsUpdated += 1;
      }
    }
  }

  return result;
}
