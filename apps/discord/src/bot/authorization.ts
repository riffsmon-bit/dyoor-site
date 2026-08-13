import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import type { AppEnv } from "../config/env.js";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";

export class AuthorizationError extends Error {}

type AccessLevel = "moderator" | "admin" | "owner";

const rolesForLevel: Record<Exclude<AccessLevel, "owner">, readonly string[]> = {
  moderator: dyoorDiscordConfig.staffRoles.map((role) => role.existingId),
  admin: dyoorDiscordConfig.staffRoles
    .filter((role) => role.key === "founder" || role.key === "admin")
    .map((role) => role.existingId),
};

export function authorizedMember(
  interaction: ChatInputCommandInteraction,
  env: AppEnv,
  level: AccessLevel,
): GuildMember {
  if (!interaction.inCachedGuild())
    throw new AuthorizationError("This command only works in the DYØØR server.");
  const member = interaction.member;
  if (member.id === env.DISCORD_OWNER_ID) return member;
  if (level === "owner")
    throw new AuthorizationError("This command is restricted to the configured server owner.");
  if (!member.roles.cache.some((role) => rolesForLevel[level].includes(role.id))) {
    throw new AuthorizationError(`This command requires ${level} authorization.`);
  }
  return member;
}

export async function manageableTarget(actor: GuildMember, target: GuildMember) {
  const bot = await actor.guild.members.fetchMe();
  if (target.id === actor.guild.ownerId)
    throw new AuthorizationError("The server owner cannot be modified by the bot.");
  if (target.id === bot.id) throw new AuthorizationError("The bot cannot target itself.");
  if (bot.roles.highest.position <= target.roles.highest.position) {
    throw new AuthorizationError("The bot role is not high enough to manage that member.");
  }
  if (
    actor.id !== actor.guild.ownerId &&
    actor.roles.highest.position <= target.roles.highest.position
  ) {
    throw new AuthorizationError("You cannot moderate a member with an equal or higher role.");
  }
}
