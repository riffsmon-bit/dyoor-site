import { ChannelType, PermissionFlagsBits, type Guild, type TextChannel } from "discord.js";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";
import type { AppRepository } from "../database/repositories.js";

type PermissionState = "allow" | "deny" | "inherit";

interface LockState {
  channelId: string;
  slowmodeSeconds: number;
  roles: Array<{ roleId: string; sendMessages: PermissionState }>;
  lockedAt: string;
}

function sendState(channel: TextChannel, roleId: string): PermissionState {
  const overwrite = channel.permissionOverwrites.cache.get(roleId);
  if (overwrite?.allow.has(PermissionFlagsBits.SendMessages)) return "allow";
  if (overwrite?.deny.has(PermissionFlagsBits.SendMessages)) return "deny";
  return "inherit";
}

function lockRoleIds(guild: Guild) {
  const names = new Set<string>(
    dyoorDiscordConfig.roles.flatMap((role) => [
      role.name,
      ...("aliases" in role ? role.aliases : []),
    ]),
  );
  return [
    guild.roles.everyone.id,
    ...guild.roles.cache.filter((role) => names.has(role.name)).map((role) => role.id),
  ];
}

export class ChannelControlService {
  constructor(private readonly repository: AppRepository) {}

  async lock(channel: TextChannel, slowmodeSeconds?: number) {
    const key = `channel-lock:${channel.id}`;
    if (this.repository.getServerState<LockState>(key)) return false;
    const roles = lockRoleIds(channel.guild).map((roleId) => ({
      roleId,
      sendMessages: sendState(channel, roleId),
    }));
    this.repository.setServerState(key, {
      channelId: channel.id,
      slowmodeSeconds: channel.rateLimitPerUser,
      roles,
      lockedAt: new Date().toISOString(),
    } satisfies LockState);
    for (const role of roles) {
      await channel.permissionOverwrites.edit(
        role.roleId,
        { SendMessages: false },
        { reason: "DYØØR reversible channel lock" },
      );
    }
    if (slowmodeSeconds !== undefined) {
      await channel.setRateLimitPerUser(slowmodeSeconds, "DYØØR reversible channel lock");
    }
    return true;
  }

  async unlock(channel: TextChannel) {
    const key = `channel-lock:${channel.id}`;
    const state = this.repository.getServerState<LockState>(key);
    if (!state) return false;
    for (const role of state.roles) {
      const value =
        role.sendMessages === "allow" ? true : role.sendMessages === "deny" ? false : null;
      await channel.permissionOverwrites.edit(
        role.roleId,
        { SendMessages: value },
        { reason: "Restore pre-lock DYØØR permissions" },
      );
    }
    await channel.setRateLimitPerUser(state.slowmodeSeconds, "Restore pre-lock DYØØR slowmode");
    this.repository.setServerState(key, null);
    return true;
  }

  async setRaidMode(guild: Guild, enabled: boolean) {
    const channel = guild.channels.cache.find(
      (candidate): candidate is TextChannel =>
        candidate.type === ChannelType.GuildText && candidate.name === "waiting-room",
    );
    if (!channel) throw new Error("#waiting-room does not exist.");
    if (enabled) {
      await this.lock(channel, 30);
      this.repository.setServerState(`raid-mode:${guild.id}`, {
        enabled: true,
        enabledAt: new Date().toISOString(),
      });
    } else {
      await this.unlock(channel);
      this.repository.setServerState(`raid-mode:${guild.id}`, {
        enabled: false,
        disabledAt: new Date().toISOString(),
      });
    }
  }

  raidModeStatus(guildId: string) {
    return (
      this.repository.getServerState<{ enabled: boolean }>(`raid-mode:${guildId}`)?.enabled ?? false
    );
  }
}

export function requireTextChannel(channel: unknown): TextChannel {
  if (
    !channel ||
    typeof channel !== "object" ||
    !("type" in channel) ||
    channel.type !== ChannelType.GuildText
  ) {
    throw new Error("Select a standard server text channel.");
  }
  return channel as TextChannel;
}
