import { REST, Routes } from "discord.js";
import type {
  RESTGetAPICurrentUserResult,
  RESTGetAPIGuildChannelsResult,
  RESTGetAPIGuildMemberResult,
  RESTGetAPIGuildResult,
  RESTGetAPIGuildRolesResult,
  RESTGetAPIGuildScheduledEventsResult,
  RESTGetAPIApplicationGuildCommandsResult,
  RESTGetAPIAutoModerationRulesResult,
} from "discord-api-types/v10";
import type { AppEnv } from "../config/env.js";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";

export interface InspectionError {
  resource: string;
  message: string;
  severity: "WARN" | "FAIL";
}

export interface GuildSnapshot {
  capturedAt: string;
  bot: RESTGetAPICurrentUserResult;
  guild: RESTGetAPIGuildResult;
  botMember: RESTGetAPIGuildMemberResult;
  roles: RESTGetAPIGuildRolesResult;
  channels: RESTGetAPIGuildChannelsResult;
  scheduledEvents: RESTGetAPIGuildScheduledEventsResult;
  guildCommands: RESTGetAPIApplicationGuildCommandsResult;
  autoModerationRules: RESTGetAPIAutoModerationRulesResult;
  application: {
    id: string;
    name: string;
    bot_public?: boolean;
    bot_require_code_grant?: boolean;
    flags?: number;
    interactions_endpoint_url?: string | null;
    redirect_uris?: string[];
    install_params?: unknown;
  };
  onboarding: Record<string, unknown> | null;
  integrations: unknown[] | null;
  webhooks: unknown[] | null;
  inspectionErrors: InspectionError[];
}

export function createDiscordRest(env: AppEnv): REST {
  return new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
}

export async function inspectTargetGuild(env: AppEnv): Promise<GuildSnapshot> {
  const rest = createDiscordRest(env);
  const inspectionErrors: InspectionError[] = [];
  const optional = async <T>(
    resource: string,
    severity: InspectionError["severity"],
    request: () => Promise<T>,
    fallback: T,
  ) => {
    try {
      return await request();
    } catch (error) {
      inspectionErrors.push({
        resource,
        severity,
        message: error instanceof Error ? error.message : "Discord API inspection failed",
      });
      return fallback;
    }
  };
  const [bot, guild, botMember, roles, channels, scheduledEvents, guildCommands, application] =
    await Promise.all([
      rest.get(Routes.user("@me")) as Promise<RESTGetAPICurrentUserResult>,
      rest.get(Routes.guild(env.DISCORD_GUILD_ID)) as Promise<RESTGetAPIGuildResult>,
      rest.get(
        Routes.guildMember(env.DISCORD_GUILD_ID, env.DISCORD_CLIENT_ID),
      ) as Promise<RESTGetAPIGuildMemberResult>,
      rest.get(Routes.guildRoles(env.DISCORD_GUILD_ID)) as Promise<RESTGetAPIGuildRolesResult>,
      rest.get(
        Routes.guildChannels(env.DISCORD_GUILD_ID),
      ) as Promise<RESTGetAPIGuildChannelsResult>,
      rest.get(
        Routes.guildScheduledEvents(env.DISCORD_GUILD_ID),
      ) as Promise<RESTGetAPIGuildScheduledEventsResult>,
      rest.get(
        Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
      ) as Promise<RESTGetAPIApplicationGuildCommandsResult>,
      rest.get("/oauth2/applications/@me") as Promise<GuildSnapshot["application"]>,
    ]);

  const [autoModerationRules, onboarding, integrations, webhooks] = await Promise.all([
    optional(
      "AutoMod",
      "FAIL",
      () =>
        rest.get(
          Routes.guildAutoModerationRules(env.DISCORD_GUILD_ID),
        ) as Promise<RESTGetAPIAutoModerationRulesResult>,
      [] as RESTGetAPIAutoModerationRulesResult,
    ),
    optional(
      "Onboarding",
      "WARN",
      () =>
        rest.get(`/guilds/${env.DISCORD_GUILD_ID}/onboarding`) as Promise<Record<string, unknown>>,
      null,
    ),
    optional(
      "Integrations",
      "WARN",
      () => rest.get(`/guilds/${env.DISCORD_GUILD_ID}/integrations`) as Promise<unknown[]>,
      null,
    ),
    optional(
      "Webhooks",
      "WARN",
      () => rest.get(`/guilds/${env.DISCORD_GUILD_ID}/webhooks`) as Promise<unknown[]>,
      null,
    ),
  ]);

  if (!bot.bot) throw new Error("Discord credential is not an official bot token");
  if (bot.id !== env.DISCORD_CLIENT_ID)
    throw new Error("Bot identity does not match DISCORD_CLIENT_ID");
  if (guild.id !== env.DISCORD_GUILD_ID)
    throw new Error("Discord returned a different guild than configured");
  if (guild.name !== dyoorDiscordConfig.expected.guildName)
    throw new Error(
      `Target guild name is ${guild.name}, expected ${dyoorDiscordConfig.expected.guildName}`,
    );
  if (guild.owner_id !== env.DISCORD_OWNER_ID)
    throw new Error("Configured owner does not own the target guild");

  return {
    capturedAt: new Date().toISOString(),
    bot,
    guild,
    botMember,
    roles,
    channels,
    scheduledEvents,
    guildCommands,
    autoModerationRules,
    application,
    onboarding,
    integrations,
    webhooks,
    inspectionErrors,
  };
}

export function findBotManagedRole(snapshot: GuildSnapshot) {
  const matches = snapshot.roles.filter((role) => role.tags?.bot_id === snapshot.bot.id);
  if (matches.length !== 1) throw new Error("Could not uniquely identify the bot-managed role");
  const role = matches[0];
  if (!role) throw new Error("Could not identify the bot-managed role");
  return role;
}
