import {
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { getAddress } from "viem";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";
import { inspectContractRegistry, readWalletEntitlements } from "../blockchain/contract.js";
import type { AppEnv } from "../config/env.js";
import type { AppRepository } from "../database/repositories.js";
import { auditDiscord, formatAudit } from "../discord/audit.js";
import { inspectTargetGuild } from "../discord/inspect.js";
import type { HolderRoleKey } from "../discord/model.js";
import { buildDiscordPlan, formatDiscordPlan } from "../discord/plan.js";
import { snapshotStorageRoot, writeDiscordSnapshot } from "../discord/snapshot.js";
import type { DiscordRoleSyncAdapter } from "../holders/discord-role-adapter.js";
import type { HolderRevalidator } from "../holders/revalidator.js";
import type { ChannelControlService } from "../moderation/channel-controls.js";
import { requireTextChannel } from "../moderation/channel-controls.js";
import type { VerificationRepository } from "../verification/repository.js";
import type { VerificationService } from "../verification/service.js";
import { AuthorizationError, authorizedMember, manageableTarget } from "./authorization.js";

export interface CommandContext {
  env: AppEnv;
  appRepository: AppRepository;
  verificationRepository: VerificationRepository;
  verificationService: VerificationService;
  holderRoles: DiscordRoleSyncAdapter;
  revalidator: HolderRevalidator;
  channelControls: ChannelControlService;
}

const holderKeys = ["season1", "ascended", "season2", "hoodyoor"] as const;
const roleLabel: Record<HolderRoleKey, string> = {
  season1: "Season 1",
  ascended: "Ascended",
  season2: "Season 2",
  hoodyoor: "HoodYØØR",
};

const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const truncate = (value: string, maximum = 1900) =>
  value.length <= maximum ? value : `${value.slice(0, maximum - 16)}\n…truncated`;

async function privateReply(interaction: ChatInputCommandInteraction, content: string) {
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
  else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function targetMember(interaction: ChatInputCommandInteraction, actor: GuildMember) {
  const user = interaction.options.getUser("user", true);
  const member = await actor.guild.members.fetch(user.id);
  await manageableTarget(actor, member);
  return member;
}

async function modLog(member: GuildMember, message: string) {
  const channel = member.guild.channels.cache.find(
    (candidate): candidate is TextChannel =>
      candidate.type === ChannelType.GuildText && candidate.name === "moderation-log",
  );
  if (channel) await channel.send(message);
}

function chainIdFor(key: HolderRoleKey) {
  const contract = dyoorDiscordConfig.contracts.find((candidate) => candidate.key === key);
  const chain = dyoorDiscordConfig.chains.find((candidate) => candidate.key === contract?.chainKey);
  if (!contract || !chain) throw new Error(`Contract registry is incomplete for ${key}`);
  return chain.id;
}

async function refreshUser(context: CommandContext, guild: Guild, discordUserId: string) {
  const wallets = context.verificationRepository.getUserWallets(discordUserId);
  let moduleChecks = 0;
  let rpcFailures = 0;
  for (const wallet of wallets) {
    const reads = await readWalletEntitlements(context.env, getAddress(wallet.wallet_address));
    for (const key of holderKeys) {
      const read = reads[key];
      context.verificationRepository.recordEntitlementRead(
        wallet.wallet_address,
        key,
        chainIdFor(key),
        read,
        context.env.HOLDER_GRACE_PERIOD_HOURS * 60 * 60 * 1000,
      );
      moduleChecks += 1;
      if (read.status === "RPC_ERROR") rpcFailures += 1;
    }
  }
  const evaluation = context.verificationRepository.evaluateUserRoles(discordUserId);
  await context.holderRoles.syncUser(guild, discordUserId, evaluation);
  return { wallets: wallets.length, moduleChecks, rpcFailures, evaluation };
}

function profileText(profile: NonNullable<ReturnType<VerificationRepository["getUserProfile"]>>) {
  const latestCheck = profile.entitlements
    .map((item) => item.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  return [
    "**DYØØR IDENTITY**",
    `Wallets: **${profile.wallets.length} verified**`,
    `Season 1: **${profile.evaluation.season1Holder ? "Holder" : "No"}**`,
    `Ascended: **${profile.evaluation.ascended ? "Yes" : "No"}**`,
    `Season 2: **${profile.evaluation.season2Holder ? "Holder" : "No"}**`,
    `HoodYØØR: **${profile.evaluation.hoodYoorHolder ? "Holder" : "No"}**`,
    `RPC uncertainty: **${profile.evaluation.rpcUncertain.length ? profile.evaluation.rpcUncertain.map((key) => roleLabel[key]).join(", ") : "None"}**`,
    `Last on-chain check: ${latestCheck ?? "not checked"}`,
    "",
    ...(profile.wallets.length
      ? profile.wallets.map((wallet) => shorten(wallet.wallet_address))
      : ["No wallets linked."]),
  ].join("\n");
}

function verificationLink(context: CommandContext, interaction: ChatInputCommandInteraction) {
  return context.verificationService.createDiscordSession(
    interaction.user.id,
    interaction.guildId ?? "",
  );
}

function requireDyoorified(interaction: ChatInputCommandInteraction, env: AppEnv) {
  if (!interaction.inCachedGuild()) throw new Error("This command only works in DYØØR.");
  if (interaction.user.id === env.DISCORD_OWNER_ID) return;
  const desired = dyoorDiscordConfig.roles.find((role) => role.key === "dyoorified");
  const roleId = desired && "existingId" in desired ? desired.existingId : undefined;
  if (!roleId || !interaction.member.roles.cache.has(roleId)) {
    throw new Error("Complete basic DYØØR verification before linking a wallet.");
  }
}

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
) {
  const { env, appRepository, verificationRepository } = context;
  switch (interaction.commandName) {
    case "help":
      await privateReply(
        interaction,
        "**DYØØR**\nComplete basic verification to enter #waiting-room. Use `/verify` to link a wallet with a gas-free signature, `/holder-status` to see every independent entitlement, and `/role-sync` to refresh roles. Staff never need a seed phrase, private key, approval, transfer, or payment.",
      );
      return;
    case "serverstatus": {
      const contracts = await inspectContractRegistry(env);
      await privateReply(
        interaction,
        [
          "Bot: online",
          `Guild: ${dyoorDiscordConfig.expected.guildName}`,
          `Contracts: ${contracts.filter((item) => item.ok).length}/${contracts.length} reachable`,
          `Wallet verification: ${env.VERIFICATION_BASE_URL ? "configured" : "disabled"}`,
          `Sales source: ${env.OPENSEA_API_KEY ? "configured" : "disabled"}`,
        ].join("\n"),
      );
      return;
    }
    case "userinfo": {
      if (!interaction.inCachedGuild()) throw new Error("This command only works in DYØØR.");
      const user = interaction.options.getUser("user") ?? interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      await privateReply(
        interaction,
        `User: <@${user.id}>\nDiscord ID: ${user.id}\nAccount created: <t:${Math.floor(user.createdTimestamp / 1000)}:F>\nJoined DYØØR: ${member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "not currently a member"}`,
      );
      return;
    }
    case "verify":
    case "reverify": {
      requireDyoorified(interaction, env);
      const session = verificationLink(context, interaction);
      await privateReply(
        interaction,
        `Your private, single-use wallet link expires in 10 minutes:\n${session.url}\n\nIt requests one gas-free authentication signature. It never requests a transaction or approval. Run this again to link another wallet.`,
      );
      return;
    }
    case "verify-status": {
      const state = verificationRepository.getOnboardingState(interaction.user.id);
      await privateReply(interaction, `DYØØR basic verification: **${state}**`);
      return;
    }
    case "holder-status": {
      const profile = verificationRepository.getUserProfile(interaction.user.id);
      await privateReply(
        interaction,
        profile
          ? profileText(profile)
          : "**DYØØR IDENTITY**\nWallets: **0 verified**\nUse `/verify` to begin.",
      );
      return;
    }
    case "role-sync": {
      requireDyoorified(interaction, env);
      if (!interaction.inCachedGuild()) throw new Error("This command only works in DYØØR.");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await refreshUser(context, interaction.guild, interaction.user.id);
      await privateReply(
        interaction,
        `Roles synchronized from ${result.wallets} wallet(s) across ${result.moduleChecks} module checks. RPC failures: ${result.rpcFailures}.`,
      );
      return;
    }
    case "warn": {
      const actor = authorizedMember(interaction, env, "moderator");
      const target = await targetMember(interaction, actor);
      const reason = interaction.options.getString("reason", true);
      const id = appRepository.addWarning(target.id, actor.id, reason);
      await modLog(actor, `WARNING_CREATED · <@${target.id}> · by <@${actor.id}> · ${reason}`);
      await privateReply(interaction, `Warning recorded (${id.slice(0, 8)}).`);
      return;
    }
    case "warnings": {
      authorizedMember(interaction, env, "moderator");
      const user = interaction.options.getUser("user", true);
      const warnings = appRepository.listWarnings(user.id);
      await privateReply(
        interaction,
        warnings.length
          ? warnings.map((warning) => `• ${warning.created_at}: ${warning.reason}`).join("\n")
          : "No active warnings.",
      );
      return;
    }
    case "timeout": {
      const actor = authorizedMember(interaction, env, "moderator");
      const target = await targetMember(interaction, actor);
      const minutes = interaction.options.getInteger("minutes", true);
      const reason = interaction.options.getString("reason", true);
      await target.timeout(minutes * 60_000, reason);
      await modLog(
        actor,
        `MEMBER_TIMEOUT · <@${target.id}> · ${minutes}m · by <@${actor.id}> · ${reason}`,
      );
      await privateReply(interaction, `Timed out <@${target.id}> for ${minutes} minutes.`);
      return;
    }
    case "untimeout": {
      const actor = authorizedMember(interaction, env, "moderator");
      const target = await targetMember(interaction, actor);
      await target.timeout(null, `Removed by ${actor.id}`);
      await modLog(actor, `MEMBER_UNTIMEOUT · <@${target.id}> · by <@${actor.id}>`);
      await privateReply(interaction, `Timeout removed for <@${target.id}>.`);
      return;
    }
    case "kick": {
      const actor = authorizedMember(interaction, env, "moderator");
      const target = await targetMember(interaction, actor);
      const reason = interaction.options.getString("reason", true);
      await modLog(actor, `MEMBER_KICK · <@${target.id}> · by <@${actor.id}> · ${reason}`);
      await target.kick(reason);
      await privateReply(interaction, `Kicked ${target.user.username}.`);
      return;
    }
    case "ban": {
      const actor = authorizedMember(interaction, env, "admin");
      const target = await targetMember(interaction, actor);
      const reason = interaction.options.getString("reason", true);
      const deleteDays = interaction.options.getInteger("delete_days") ?? 0;
      await modLog(actor, `MEMBER_BAN · <@${target.id}> · by <@${actor.id}> · ${reason}`);
      await target.ban({ reason, deleteMessageSeconds: deleteDays * 86_400 });
      await privateReply(interaction, `Banned ${target.user.username}.`);
      return;
    }
    case "unban": {
      const actor = authorizedMember(interaction, env, "admin");
      const userId = interaction.options.getString("user_id", true);
      if (!/^\d{17,20}$/.test(userId)) throw new Error("Provide a valid Discord User ID.");
      const reason = interaction.options.getString("reason", true);
      await actor.guild.bans.remove(userId, reason);
      await modLog(actor, `MEMBER_UNBAN · ${userId} · by <@${actor.id}> · ${reason}`);
      await privateReply(interaction, `Unbanned Discord user ${userId}.`);
      return;
    }
    case "slowmode": {
      authorizedMember(interaction, env, "moderator");
      const channel = requireTextChannel(interaction.options.getChannel("channel", true));
      const seconds = interaction.options.getInteger("seconds", true);
      await channel.setRateLimitPerUser(seconds, `Changed by ${interaction.user.id}`);
      await privateReply(interaction, `Slowmode for <#${channel.id}> set to ${seconds} seconds.`);
      return;
    }
    case "lock":
    case "unlock": {
      authorizedMember(interaction, env, "moderator");
      const channel = requireTextChannel(interaction.options.getChannel("channel", true));
      const changed =
        interaction.commandName === "lock"
          ? await context.channelControls.lock(channel)
          : await context.channelControls.unlock(channel);
      await privateReply(
        interaction,
        changed
          ? `<#${channel.id}> ${interaction.commandName === "lock" ? "locked" : "restored"}.`
          : "No state change was needed.",
      );
      return;
    }
    case "purge": {
      authorizedMember(interaction, env, "moderator");
      const channel = requireTextChannel(interaction.channel);
      const count = interaction.options.getInteger("count", true);
      const deleted = await channel.bulkDelete(count, true);
      await privateReply(interaction, `Deleted ${deleted.size} recent messages.`);
      return;
    }
    case "raidmode": {
      const actor = authorizedMember(interaction, env, "admin");
      const action = interaction.options.getString("action", true);
      if (action !== "status")
        await context.channelControls.setRaidMode(actor.guild, action === "enable");
      const enabled = context.channelControls.raidModeStatus(actor.guild.id);
      await privateReply(
        interaction,
        `Raid mode: **${enabled ? "enabled" : "disabled"}**. No members were mass-banned.`,
      );
      return;
    }
    case "permission-audit":
    case "server-audit": {
      authorizedMember(interaction, env, "moderator");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const audit = auditDiscord(await inspectTargetGuild(env), dyoorDiscordConfig);
      await privateReply(interaction, `\`\`\`\n${truncate(formatAudit(audit), 1800)}\n\`\`\``);
      return;
    }
    case "sync-user": {
      const actor = authorizedMember(interaction, env, "admin");
      const user = interaction.options.getUser("user", true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await refreshUser(context, actor.guild, user.id);
      await privateReply(
        interaction,
        `Synced <@${user.id}>: ${result.wallets} wallet(s), ${result.moduleChecks} module checks, ${result.rpcFailures} RPC failure(s).`,
      );
      return;
    }
    case "sync-all": {
      authorizedMember(interaction, env, "admin");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const summary = await context.revalidator.runOnce(true);
      await privateReply(
        interaction,
        `\`\`\`json\n${truncate(JSON.stringify(summary, null, 2), 1800)}\n\`\`\``,
      );
      return;
    }
    case "holder": {
      const actor = authorizedMember(interaction, env, "admin");
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "stats") {
        const stats = appRepository.holderStats();
        await privateReply(
          interaction,
          Object.entries(stats)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n"),
        );
      } else if (subcommand === "lookup") {
        const user = interaction.options.getUser("user", true);
        const profile = verificationRepository.getUserProfile(user.id);
        await privateReply(
          interaction,
          profile ? truncate(profileText(profile)) : "No verification record exists.",
        );
      } else if (subcommand === "refresh") {
        const user = interaction.options.getUser("user", true);
        const result = await refreshUser(context, actor.guild, user.id);
        await privateReply(
          interaction,
          `Checked ${result.wallets} wallet(s); module checks: ${result.moduleChecks}; RPC failures: ${result.rpcFailures}.`,
        );
      } else if (subcommand === "unlink") {
        const wallet = getAddress(interaction.options.getString("wallet", true));
        const reason = interaction.options.getString("reason", true);
        const userId = verificationRepository.unlinkWallet(wallet, actor.id, reason);
        if (userId) {
          const evaluation = verificationRepository.evaluateUserRoles(userId);
          await context.holderRoles.syncUser(actor.guild, userId, evaluation);
        }
        await privateReply(
          interaction,
          userId
            ? "Wallet unlinked and roles synchronized; action logged."
            : "No linked wallet matched that address.",
        );
      } else if (subcommand === "override") {
        const user = interaction.options.getUser("user", true);
        const key = interaction.options.getString("role", true) as HolderRoleKey;
        if (!holderKeys.includes(key)) throw new Error("Invalid holder entitlement.");
        const action = interaction.options.getString("action", true);
        const reason = interaction.options.getString("reason", true);
        const evaluation =
          action === "clear"
            ? verificationRepository.clearRoleOverride(user.id, key, actor.id, reason)
            : verificationRepository.setRoleOverride(
                user.id,
                key,
                action === "grant" ? "GRANT" : "DENY",
                actor.id,
                reason,
              );
        await context.holderRoles.syncUser(actor.guild, user.id, evaluation);
        await privateReply(
          interaction,
          `${roleLabel[key]} override ${action} completed and logged.`,
        );
      }
      return;
    }
    case "dyoor": {
      const owner = authorizedMember(interaction, env, "owner");
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "backup") {
        const path = await writeDiscordSnapshot(
          await inspectTargetGuild(env),
          snapshotStorageRoot(),
          appRepository.listManagedMessages(),
        );
        await privateReply(interaction, `Configuration snapshot created: ${path}`);
      } else if (subcommand === "audit") {
        const audit = auditDiscord(await inspectTargetGuild(env), dyoorDiscordConfig);
        await privateReply(interaction, `\`\`\`\n${truncate(formatAudit(audit), 1800)}\n\`\`\``);
      } else if (subcommand === "health") {
        const results = await inspectContractRegistry(env);
        await privateReply(
          interaction,
          results
            .map(
              (item) =>
                `${item.ok ? "✓" : "✗"} ${item.label}: ${item.ok ? `${item.inspection?.network} ${item.inspection?.ownershipMethod}` : item.error}`,
            )
            .join("\n"),
        );
      } else if (subcommand === "deploy-status") {
        const plan = buildDiscordPlan(await inspectTargetGuild(env), dyoorDiscordConfig);
        await privateReply(
          interaction,
          `\`\`\`\n${truncate(formatDiscordPlan(plan), 1800)}\n\`\`\``,
        );
      } else if (subcommand === "maintenance") {
        const action = interaction.options.getString("action", true);
        if (action !== "status")
          appRepository.setServerState("maintenance", {
            enabled: action === "enable",
            actor: owner.id,
          });
        const enabled =
          appRepository.getServerState<{ enabled: boolean }>("maintenance")?.enabled ?? false;
        await privateReply(interaction, `Maintenance mode: ${enabled ? "enabled" : "disabled"}`);
      } else {
        await privateReply(
          interaction,
          `Guild: ${owner.guild.name}\nBot role: ${owner.guild.members.me?.roles.highest.name ?? "unknown"}\nLive structural deployment is terminal-only and confirmation-gated.`,
        );
      }
      return;
    }
    default:
      throw new Error("Unknown command.");
  }
}

export async function handleCommandError(interaction: ChatInputCommandInteraction, error: unknown) {
  const message =
    error instanceof AuthorizationError
      ? error.message
      : error instanceof Error &&
          [
            "missing",
            "invalid",
            "not configured",
            "not ready",
            "not exist",
            "already",
            "disabled",
          ].some((fragment) => error.message.toLowerCase().includes(fragment))
        ? error.message
        : "The command could not be completed. No privileged state was changed.";
  await privateReply(interaction, message);
}
