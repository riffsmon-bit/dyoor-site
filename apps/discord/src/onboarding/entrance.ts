import { ChannelType, MessageFlags, type ButtonInteraction, type GuildMember } from "discord.js";
import type { AppEnv } from "../config/env.js";
import type { VerificationRepository } from "../verification/repository.js";
import {
  grantDyoorified,
  removeBotManagedCommunityRoles,
} from "../holders/discord-role-adapter.js";

export class InteractionRateLimiter {
  private readonly lastAttempt = new Map<string, number>();

  allow(key: string, intervalMs: number, now = Date.now()) {
    const previous = this.lastAttempt.get(key) ?? 0;
    if (now - previous < intervalMs) return false;
    this.lastAttempt.set(key, now);
    return true;
  }
}

export class EntranceService {
  constructor(
    private readonly env: AppEnv,
    private readonly repository: VerificationRepository,
    private readonly limiter = new InteractionRateLimiter(),
    private readonly minimumAccountAgeMs = 24 * 60 * 60 * 1000,
  ) {}

  async enter(interaction: ButtonInteraction) {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.env.DISCORD_GUILD_ID) {
      throw new Error("This entrance is not configured for the current server.");
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = interaction.member;
    if (!this.limiter.allow(`entrance:${member.id}`, 30_000)) {
      await interaction.editReply({
        content: "Please wait a moment before trying the entrance check again.",
      });
      return;
    }
    if (member.pending) {
      await interaction.editReply({
        content: "Accept the Discord server rules first, then return and complete verification.",
      });
      return;
    }
    if (interaction.user.bot) throw new Error("Bot accounts cannot complete member verification.");

    const accountAge = Date.now() - interaction.user.createdTimestamp;
    if (accountAge < this.minimumAccountAgeMs) {
      await removeBotManagedCommunityRoles(
        member,
        "New-account verification review; no automatic ban",
      );
      const current = this.repository.getOnboardingState(member.id);
      if (current !== "FLAGGED") this.repository.setOnboardingState(member.id, "FLAGGED");
      await this.log(
        member,
        "FLAGGED",
        "Account is under 24 hours old; moderator review requested.",
      );
      await interaction.editReply({
        content:
          "Your account is very new, so the entrance is paused for a quick moderator review. You have not been banned.",
      });
      return;
    }

    let state = this.repository.getOnboardingState(member.id);
    if (state === "NEW")
      state = this.repository.setOnboardingState(member.id, "SCREENING_COMPLETE");
    if (state === "SCREENING_COMPLETE")
      state = this.repository.setOnboardingState(member.id, "VISITOR");
    if (state === "FLAGGED") {
      await interaction.editReply({
        content: "Your entrance is awaiting moderator review.",
      });
      return;
    }
    await grantDyoorified(member);
    this.repository.recordAudit("DYOORIFIED", member.id, null, { source: "basic_verification" });
    await this.log(member, state, "Basic checks completed; DYOORyfied role synchronized.");
    await interaction.editReply({
      content: "SYSTEM ACCESS GRANTED. You are now DYOORyfied and #waiting-room is available.",
    });
  }

  private async log(member: GuildMember, state: string, detail: string) {
    const channel = member.guild.channels.cache.find(
      (candidate) =>
        candidate.type === ChannelType.GuildText && candidate.name === "verification-log",
    );
    if (channel?.type === ChannelType.GuildText) {
      await channel.send(`ENTRANCE_${state} · <@${member.id}> · ${detail}`);
    }
  }
}

export class JoinMonitor {
  private readonly joins = new Map<string, number[]>();

  constructor(
    private readonly windowMs = 60_000,
    private readonly alertThreshold = 20,
  ) {}

  async record(member: GuildMember) {
    const now = Date.now();
    const recent = (this.joins.get(member.guild.id) ?? []).filter(
      (time) => now - time <= this.windowMs,
    );
    recent.push(now);
    this.joins.set(member.guild.id, recent);
    const joinLog = member.guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildText && channel.name === "join-log",
    );
    if (joinLog?.type === ChannelType.GuildText) {
      await joinLog.send(
        `MEMBER_JOIN · <@${member.id}> · account created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
      );
    }
    if (recent.length >= this.alertThreshold) {
      const alerts = member.guild.channels.cache.find(
        (channel) => channel.type === ChannelType.GuildText && channel.name === "security-alerts",
      );
      if (alerts?.type === ChannelType.GuildText) {
        await alerts.send(
          `JOIN_VELOCITY_ALERT · ${recent.length} joins in the last minute. No automatic bans were issued; moderators should review and enable raid mode if warranted.`,
        );
      }
    }
  }
}
