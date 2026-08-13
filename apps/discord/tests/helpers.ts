import { ChannelType, PermissionFlagsBits } from "discord.js";
import { GuildFeature } from "discord-api-types/v10";
import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import type { EntitlementRead } from "../src/blockchain/contract.js";
import type { AppEnv } from "../src/config/env.js";
import {
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "../src/database/database.js";
import type { GuildSnapshot } from "../src/discord/inspect.js";
import type { HolderRoleKey, RoleKey, StaffRoleKey } from "../src/discord/model.js";
import { buildOverwrites, requiredBotPermissions } from "../src/discord/permissions.js";

export const ids = {
  guild: dyoorDiscordConfig.expected.guildId,
  client: dyoorDiscordConfig.expected.applicationId,
  owner: dyoorDiscordConfig.expected.ownerId,
  botRole: "1488862373727961180",
  user: "123456789012345678",
  secondUser: "223456789012345678",
} as const;

export function testEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "fatal",
    DISCORD_BOT_TOKEN: "unit-test-token-that-is-never-sent-to-discord-000000000000000",
    DISCORD_CLIENT_ID: ids.client,
    DISCORD_GUILD_ID: ids.guild,
    DISCORD_OWNER_ID: ids.owner,
    MONAD_RPC_URL: "https://monad-rpc.example.test",
    ROBINHOOD_RPC_URL: "https://robinhood-rpc.example.test",
    WEBSITE_URL: "https://dyoor.xyz",
    X_URL: "",
    MARKETPLACE_URL: "",
    VERIFICATION_BASE_URL: "https://verify.dyoor.test/verify",
    OFFICIAL_DOMAINS: "dyoor.xyz,verify.dyoor.test",
    HOLDER_RECHECK_INTERVAL_HOURS: 6,
    HOLDER_GRACE_PERIOD_HOURS: 24,
    HOLDER_SYNC_CONCURRENCY: 4,
    RPC_TIMEOUT_MS: 10_000,
    DATABASE_PATH: ":memory:",
    HTTP_HOST: "127.0.0.1",
    HTTP_PORT: 3100,
    SESSION_HMAC_SECRET: "unit-test-only-session-secret-with-more-than-32-characters",
    OPENSEA_API_KEY: "unit-test-opensea-key",
    OPENSEA_API_BASE_URL: "https://api.opensea.test",
    SALES_CHANNEL_ID: "1475119645743648789",
    SALES_POLL_INTERVAL_SECONDS: 120,
    ...overrides,
  };
}

export function testDatabase(): DatabaseConnection {
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  return database;
}

export function entitlementReads(
  overrides: Partial<Record<HolderRoleKey, EntitlementRead>> = {},
): Record<HolderRoleKey, EntitlementRead> {
  return {
    season1: { key: "season1", status: "NOT_QUALIFIED", balance: 0n },
    ascended: { key: "ascended", status: "NOT_QUALIFIED", balance: 0n },
    season2: { key: "season2", status: "NOT_QUALIFIED", balance: 0n },
    hoodyoor: { key: "hoodyoor", status: "NOT_QUALIFIED", balance: 0n },
    ...overrides,
  };
}

function baseRoles() {
  return [
    {
      id: ids.guild,
      name: "@everyone",
      permissions: (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages).toString(),
      position: 0,
      managed: false,
      color: 0,
      hoist: false,
      mentionable: false,
    },
    {
      id: ids.botRole,
      name: "DYOOR Verification",
      permissions: requiredBotPermissions(dyoorDiscordConfig).toString(),
      position: 50,
      managed: true,
      color: 0,
      hoist: false,
      mentionable: false,
      tags: { bot_id: ids.client },
    },
    ...dyoorDiscordConfig.staffRoles.map((role, index) => ({
      id: role.existingId,
      name: role.name,
      permissions: (role.key === "founder" || role.key === "admin"
        ? PermissionFlagsBits.Administrator
        : PermissionFlagsBits.ManageMessages
      ).toString(),
      position: 60 + index,
      managed: false,
      color: 0,
      hoist: true,
      mentionable: false,
    })),
  ];
}

export function blankGuildSnapshot(overrides: Partial<GuildSnapshot> = {}): GuildSnapshot {
  const snapshot = {
    capturedAt: "2026-08-10T12:00:00.000Z",
    bot: { id: ids.client, username: "DYOOR Verification", bot: true },
    guild: {
      id: ids.guild,
      name: dyoorDiscordConfig.expected.guildName,
      owner_id: ids.owner,
      features: [GuildFeature.Community],
      mfa_level: 1,
      verification_level: 2,
      explicit_content_filter: 2,
      rules_channel_id: null,
      public_updates_channel_id: null,
      safety_alerts_channel_id: null,
      description: null,
    },
    botMember: { user: { id: ids.client }, roles: [ids.botRole] },
    roles: baseRoles(),
    channels: [],
    scheduledEvents: [],
    guildCommands: [],
    autoModerationRules: [],
    application: {
      id: ids.client,
      name: "DYOOR Verification",
      bot_public: false,
      bot_require_code_grant: false,
      flags: 1 << 15,
      interactions_endpoint_url: null,
      redirect_uris: [],
    },
    onboarding: { enabled: true },
    integrations: [],
    webhooks: [],
    inspectionErrors: [],
  } as unknown as GuildSnapshot;
  return { ...snapshot, ...overrides };
}

export function fullyDeployedSnapshot(): GuildSnapshot {
  const base = blankGuildSnapshot();
  const managedRoles = dyoorDiscordConfig.roles.map((role, index) => ({
    id: "existingId" in role ? role.existingId : `role-${role.key}`,
    name: role.name,
    permissions: role.permissions.toString(),
    position: index + 1,
    managed: false,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
  }));
  const roles = [...base.roles, ...managedRoles];
  const roleIds = new Map<RoleKey, string>(
    managedRoles.map((role, index) => [dyoorDiscordConfig.roles[index]!.key, role.id]),
  );
  const staffRoleIds = new Map<StaffRoleKey, string>(
    dyoorDiscordConfig.staffRoles.map((role) => [role.key, role.existingId]),
  );
  const permissionContext = {
    everyoneId: ids.guild,
    botRoleId: ids.botRole,
    roleIds,
    staffRoleIds,
  };
  const channels: Array<Record<string, unknown>> = [];
  dyoorDiscordConfig.categories.forEach((category, categoryIndex) => {
    const normalized = category as { key: string; existingId?: string };
    const categoryId = normalized.existingId ?? `category-${normalized.key}`;
    channels.push({
      id: categoryId,
      type: ChannelType.GuildCategory,
      name: category.name,
      position: categoryIndex,
      parent_id: null,
      permission_overwrites: [],
    });
    category.channels.forEach((channel, channelIndex) => {
      const channelId = "existingId" in channel ? channel.existingId : `channel-${channel.key}`;
      channels.push({
        id: channelId,
        type: channel.type === "text" ? ChannelType.GuildText : ChannelType.GuildVoice,
        name: channel.name,
        position: channelIndex,
        parent_id: categoryId,
        permission_overwrites: buildOverwrites(channel.access, permissionContext),
        ...(channel.type === "text"
          ? {
              topic: "topic" in channel ? channel.topic : null,
              rate_limit_per_user: "slowmodeSeconds" in channel ? channel.slowmodeSeconds : 0,
            }
          : {}),
      });
    });
  });
  return {
    ...base,
    roles: roles as GuildSnapshot["roles"],
    channels: channels as unknown as GuildSnapshot["channels"],
  };
}
