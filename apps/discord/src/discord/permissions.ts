import { ChannelType, OverwriteType, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { APIRole, APIOverwrite } from "discord-api-types/v10";
import type { AccessPolicy, ProjectConfig, RoleKey, StaffRoleKey } from "./model.js";

const VIEW = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
const TEXT_WRITE =
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.UseExternalEmojis |
  PermissionFlagsBits.CreatePublicThreads |
  PermissionFlagsBits.CreatePrivateThreads |
  PermissionFlagsBits.SendMessagesInThreads;
const VOICE =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.Stream;

const DANGEROUS_EVERYONE = {
  Administrator: PermissionFlagsBits.Administrator,
  ManageGuild: PermissionFlagsBits.ManageGuild,
  ManageRoles: PermissionFlagsBits.ManageRoles,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  ManageWebhooks: PermissionFlagsBits.ManageWebhooks,
  BanMembers: PermissionFlagsBits.BanMembers,
  KickMembers: PermissionFlagsBits.KickMembers,
  MentionEveryone: PermissionFlagsBits.MentionEveryone,
  ManageMessages: PermissionFlagsBits.ManageMessages,
} as const;

export const PRIVILEGED_ROLE_PERMISSIONS =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.MentionEveryone;

export interface PermissionContext {
  everyoneId: string;
  botRoleId: string;
  roleIds: ReadonlyMap<RoleKey, string>;
  staffRoleIds: ReadonlyMap<StaffRoleKey, string>;
}

interface MutableOverwrite {
  id: string;
  type: OverwriteType.Role;
  allow: bigint;
  deny: bigint;
}

function merge(
  entries: Map<string, MutableOverwrite>,
  id: string,
  allow: bigint = 0n,
  deny: bigint = 0n,
) {
  const entry = entries.get(id) ?? { id, type: OverwriteType.Role, allow: 0n, deny: 0n };
  entry.allow = (entry.allow | allow) & ~deny;
  entry.deny = (entry.deny | deny) & ~allow;
  entries.set(id, entry);
}

export function buildOverwrites(policy: AccessPolicy, context: PermissionContext): APIOverwrite[] {
  const entries = new Map<string, MutableOverwrite>();
  const role = (key: RoleKey) => {
    const id = context.roleIds.get(key);
    if (!id) throw new Error(`Missing deployed role ID for ${key}`);
    return id;
  };
  const staff = [...context.staffRoleIds.values()];
  const botAndStaff = [context.botRoleId, ...staff];
  const dyoorifiedAccess = [
    role("dyoorified"),
    role("season1"),
    role("ascended"),
    role("season2"),
    role("hoodyoor"),
  ];

  if (policy === "entry-readonly") {
    merge(entries, context.everyoneId, VIEW, TEXT_WRITE);
    botAndStaff.forEach((id) => merge(entries, id, VIEW | TEXT_WRITE));
  } else if (policy === "entry-verification") {
    merge(entries, context.everyoneId, VIEW, TEXT_WRITE);
    dyoorifiedAccess.forEach((id) => merge(entries, id, 0n, PermissionFlagsBits.ViewChannel));
    botAndStaff.forEach((id) => merge(entries, id, VIEW | TEXT_WRITE));
  } else if (policy === "dyoorified-readonly" || policy === "sales-readonly") {
    merge(entries, context.everyoneId, 0n, PermissionFlagsBits.ViewChannel);
    dyoorifiedAccess.forEach((id) => merge(entries, id, VIEW, TEXT_WRITE));
    botAndStaff.forEach((id) => merge(entries, id, VIEW | TEXT_WRITE));
  } else if (policy === "dyoorified-chat") {
    merge(entries, context.everyoneId, 0n, PermissionFlagsBits.ViewChannel);
    [...dyoorifiedAccess, ...botAndStaff].forEach((id) => merge(entries, id, VIEW | TEXT_WRITE));
  } else if (policy === "season1-ascended-chat") {
    merge(entries, context.everyoneId, 0n, PermissionFlagsBits.ViewChannel);
    [role("season1"), role("ascended"), ...botAndStaff].forEach((id) =>
      merge(entries, id, VIEW | TEXT_WRITE),
    );
  } else if (policy === "season2-chat") {
    merge(entries, context.everyoneId, 0n, PermissionFlagsBits.ViewChannel);
    [role("season2"), ...botAndStaff].forEach((id) => merge(entries, id, VIEW | TEXT_WRITE));
  } else if (policy === "hoodyoor-chat") {
    merge(entries, context.everyoneId, 0n, PermissionFlagsBits.ViewChannel);
    [role("hoodyoor"), ...botAndStaff].forEach((id) => merge(entries, id, VIEW | TEXT_WRITE));
  } else if (policy === "ticket-panel") {
    merge(entries, context.everyoneId, 0n, PermissionFlagsBits.ViewChannel);
    dyoorifiedAccess.forEach((id) => merge(entries, id, VIEW, TEXT_WRITE));
    botAndStaff.forEach((id) => merge(entries, id, VIEW | TEXT_WRITE));
  } else if (policy === "staff-chat") {
    merge(entries, context.everyoneId, 0n, PermissionFlagsBits.ViewChannel);
    botAndStaff.forEach((id) => merge(entries, id, VIEW | TEXT_WRITE));
  } else if (policy === "staff-readonly") {
    merge(entries, context.everyoneId, 0n, PermissionFlagsBits.ViewChannel);
    staff.forEach((id) => merge(entries, id, VIEW, TEXT_WRITE));
    merge(entries, context.botRoleId, VIEW | TEXT_WRITE);
  }

  return [...entries.values()]
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      allow: entry.allow.toString(),
      deny: entry.deny.toString(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function dangerousEveryonePermissions(role: Pick<APIRole, "permissions">): string[] {
  const permissions = new PermissionsBitField(BigInt(role.permissions));
  return Object.entries(DANGEROUS_EVERYONE)
    .filter(([, flag]) => permissions.has(flag))
    .map(([name]) => name);
}

export function privilegedPermissions(role: Pick<APIRole, "permissions">): string[] {
  const value = BigInt(role.permissions);
  return Object.entries({
    Administrator: PermissionFlagsBits.Administrator,
    ManageGuild: PermissionFlagsBits.ManageGuild,
    ManageRoles: PermissionFlagsBits.ManageRoles,
    ManageChannels: PermissionFlagsBits.ManageChannels,
    ManageWebhooks: PermissionFlagsBits.ManageWebhooks,
    KickMembers: PermissionFlagsBits.KickMembers,
    BanMembers: PermissionFlagsBits.BanMembers,
    ModerateMembers: PermissionFlagsBits.ModerateMembers,
    ManageMessages: PermissionFlagsBits.ManageMessages,
    MentionEveryone: PermissionFlagsBits.MentionEveryone,
  })
    .filter(([, flag]) => (value & flag) !== 0n)
    .map(([name]) => name);
}

export function requiredBotPermissions(config: ProjectConfig): bigint {
  void config;
  return (
    PermissionFlagsBits.ManageGuild |
    PermissionFlagsBits.ManageRoles |
    PermissionFlagsBits.ManageChannels |
    PermissionFlagsBits.ViewChannel |
    PermissionFlagsBits.ReadMessageHistory |
    PermissionFlagsBits.SendMessages |
    PermissionFlagsBits.ManageMessages |
    PermissionFlagsBits.EmbedLinks |
    PermissionFlagsBits.AttachFiles |
    PermissionFlagsBits.KickMembers |
    PermissionFlagsBits.BanMembers |
    PermissionFlagsBits.ModerateMembers |
    PermissionFlagsBits.ManageThreads |
    PermissionFlagsBits.UseApplicationCommands
  );
}

export function discordChannelType(type: "text" | "voice") {
  return type === "text" ? ChannelType.GuildText : ChannelType.GuildVoice;
}

export function normalizeOverwrites(overwrites: readonly APIOverwrite[]) {
  return overwrites
    .map((item) => ({
      id: String(item.id),
      type: Number(item.type),
      allow: String(item.allow),
      deny: String(item.deny),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export const channelPermissionSets = { VIEW, TEXT_WRITE, VOICE } as const;
