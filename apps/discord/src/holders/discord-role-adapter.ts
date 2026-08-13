import type { Guild, GuildMember, Role } from "discord.js";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";
import type { AppEnv } from "../config/env.js";
import type { HolderRoleKey, RoleKey } from "../discord/model.js";
import type { RoleEvaluation, VerificationRepository } from "../verification/repository.js";

const evaluationValue: Record<HolderRoleKey, keyof RoleEvaluation> = {
  season1: "season1Holder",
  ascended: "ascended",
  season2: "season2Holder",
  hoodyoor: "hoodYoorHolder",
};

const eventPrefix: Record<HolderRoleKey, string> = {
  season1: "S1",
  ascended: "ASCENDED",
  season2: "S2",
  hoodyoor: "HOODYOOR",
};

function configuredRole(guild: Guild, key: RoleKey): Role {
  const desired = dyoorDiscordConfig.roles.find((role) => role.key === key);
  if (!desired) throw new Error(`Unknown configured role ${key}`);
  const existingId = "existingId" in desired ? desired.existingId : undefined;
  const aliases = "aliases" in desired ? desired.aliases : undefined;
  const byId = existingId ? guild.roles.cache.get(existingId) : undefined;
  if (byId) return byId;
  const names = new Set<string>([desired.name, ...(aliases ?? [])]);
  const matches = guild.roles.cache.filter((role) => !role.managed && names.has(role.name));
  if (matches.size !== 1) throw new Error(`Expected exactly one Discord role for ${desired.name}`);
  const role = matches.first();
  if (!role) throw new Error(`Discord role ${desired.name} is missing`);
  return role;
}

export class DiscordRoleSyncAdapter {
  constructor(
    private readonly env: AppEnv,
    private readonly repository: VerificationRepository,
  ) {}

  async syncMember(member: GuildMember, evaluation: RoleEvaluation) {
    if (member.guild.id !== this.env.DISCORD_GUILD_ID) throw new Error("Wrong Discord guild");
    await member.guild.roles.fetch();
    const bot = await member.guild.members.fetchMe();
    const dyoorified = configuredRole(member.guild, "dyoorified");
    const targets = new Map<HolderRoleKey, Role>(
      (["season1", "ascended", "season2", "hoodyoor"] as const).map((key) => [
        key,
        configuredRole(member.guild, key),
      ]),
    );
    for (const role of [dyoorified, ...targets.values()]) {
      if (bot.roles.highest.position <= role.position) {
        throw new Error(`Bot role hierarchy cannot manage ${role.name}`);
      }
    }

    const added: string[] = [];
    const removed: string[] = [];
    if (!member.roles.cache.has(dyoorified.id)) {
      await member.roles.add(dyoorified, "DYØØR wallet verification fallback access");
      added.push(dyoorified.name);
      this.repository.recordAudit("DYOORIFIED", member.id, null, { source: "wallet_sync" });
    }
    for (const [key, role] of targets) {
      const qualified = Boolean(evaluation[evaluationValue[key]]);
      const hasRole = member.roles.cache.has(role.id);
      if (qualified && !hasRole) {
        await member.roles.add(role, `Verified ${key} entitlement`);
        added.push(role.name);
        this.repository.recordAudit(`${eventPrefix[key]}_GRANTED`, member.id, null, {});
      } else if (!qualified && hasRole && !evaluation.rpcUncertain.includes(key)) {
        await member.roles.remove(role, `Confirmed ${key} entitlement no longer qualifies`);
        removed.push(role.name);
        this.repository.recordAudit(`${eventPrefix[key]}_REMOVED`, member.id, null, {});
      }
    }
    this.repository.recordRoleSync(member.id, evaluation);
    return { added, removed, ownerSkipped: false };
  }

  async syncUser(guild: Guild, discordUserId: string, evaluation: RoleEvaluation) {
    const member = await guild.members.fetch(discordUserId);
    return this.syncMember(member, evaluation);
  }
}

export async function grantDyoorified(member: GuildMember) {
  const role = configuredRole(member.guild, "dyoorified");
  const bot = await member.guild.members.fetchMe();
  if (bot.roles.highest.position <= role.position) throw new Error("Bot cannot assign DYOORyfied");
  await member.roles.add(role, "Completed DYØØR entrance verification");
}

export async function removeBotManagedCommunityRoles(member: GuildMember, reason: string) {
  if (member.id === member.guild.ownerId) return;
  const roles = dyoorDiscordConfig.roles
    .map((role) => {
      const existingId = "existingId" in role ? role.existingId : undefined;
      if (existingId && member.guild.roles.cache.has(existingId)) {
        return member.guild.roles.cache.get(existingId);
      }
      const aliases = "aliases" in role ? role.aliases : undefined;
      const names = new Set<string>([role.name, ...(aliases ?? [])]);
      return member.guild.roles.cache.find((candidate) => names.has(candidate.name));
    })
    .filter((role): role is Role => Boolean(role));
  if (roles.length) await member.roles.remove(roles, reason);
}
