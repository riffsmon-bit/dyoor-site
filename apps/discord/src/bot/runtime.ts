import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ButtonInteraction,
  type GuildMember,
} from "discord.js";
import { once } from "node:events";
import type { FastifyInstance } from "fastify";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";
import { inspectContractRegistry, readWalletEntitlements } from "../blockchain/contract.js";
import { getEnv } from "../config/env.js";
import { openMigratedDatabase, type DatabaseConnection } from "../database/database.js";
import { AppRepository } from "../database/repositories.js";
import { DiscordRoleSyncAdapter } from "../holders/discord-role-adapter.js";
import { HolderRevalidator } from "../holders/revalidator.js";
import { createLogger } from "../logging/logger.js";
import { ChannelControlService } from "../moderation/channel-controls.js";
import { EntranceService, JoinMonitor } from "../onboarding/entrance.js";
import { TicketService } from "../tickets/service.js";
import { SalesRepository } from "../sales/repository.js";
import { OpenSeaSalesService } from "../sales/service.js";
import { VerificationRepository } from "../verification/repository.js";
import { VerificationService } from "../verification/service.js";
import { buildVerificationServer } from "../web/server.js";
import { handleCommand, handleCommandError, type CommandContext } from "./command-handler.js";
import { componentIds } from "./panels.js";

function configuredLinks(env: ReturnType<typeof getEnv>) {
  const links = [
    env.WEBSITE_URL && `Website: ${env.WEBSITE_URL}`,
    env.X_URL && `X: ${env.X_URL}`,
    env.MARKETPLACE_URL && `OpenSea: ${env.MARKETPLACE_URL}`,
  ].filter((value): value is string => Boolean(value));
  return [...links, "", "Contract addresses are pinned in #official-links."].join("\n");
}

function buttonStaff(member: GuildMember, ownerId: string) {
  const staffIds = new Set<string>(dyoorDiscordConfig.staffRoles.map((role) => role.existingId));
  return member.id === ownerId || member.roles.cache.some((role) => staffIds.has(role.id));
}

async function safeButtonError(interaction: ButtonInteraction, error: unknown) {
  const known =
    error instanceof Error &&
    ["configured", "missing", "expired", "already", "requires", "disabled", "wait"].some(
      (fragment) => error.message.toLowerCase().includes(fragment),
    );
  const content =
    known && error instanceof Error
      ? error.message
      : "That action could not be completed. No privileged access was granted.";
  try {
    if (interaction.replied || interaction.deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch {
    // Discord invalidates unacknowledged interactions after a short deadline. The
    // action is already logged by the caller; a failed fallback response must not
    // become an unhandled rejection that restarts the bot.
  }
}

export interface RuntimeHandle {
  client: Client;
  web: FastifyInstance;
  database: DatabaseConnection;
}

export async function loginDiscordClient(client: Client, token: string) {
  if (client.isReady()) return;
  const ready = once(client, Events.ClientReady);
  await client.login(token);
  await ready;
}

export async function startRuntime(): Promise<RuntimeHandle> {
  const env = getEnv();
  const logger = createLogger();
  const database = openMigratedDatabase(env.DATABASE_PATH);
  const appRepository = new AppRepository(database);
  const salesRepository = new SalesRepository(database);
  const verificationRepository = new VerificationRepository(database);
  const verificationService = new VerificationService(env, verificationRepository);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
    ],
    allowedMentions: { parse: [], repliedUser: false },
  });

  await loginDiscordClient(client, env.DISCORD_BOT_TOKEN);
  const guild = await client.guilds.fetch({ guild: env.DISCORD_GUILD_ID, force: true });
  if (
    client.user?.id !== dyoorDiscordConfig.expected.applicationId ||
    guild.name !== dyoorDiscordConfig.expected.guildName ||
    guild.ownerId !== env.DISCORD_OWNER_ID
  ) {
    await client.destroy();
    database.close();
    throw new Error("Runtime bot/guild identity validation failed");
  }

  const holderRoles = new DiscordRoleSyncAdapter(env, verificationRepository);
  const channelControls = new ChannelControlService(appRepository);
  const entrance = new EntranceService(env, verificationRepository);
  const joins = new JoinMonitor();
  const tickets = new TicketService(env, appRepository);
  const sales = new OpenSeaSalesService(env, appRepository, salesRepository);
  const revalidator = new HolderRevalidator(
    verificationRepository,
    {
      syncRoles: async (discordUserId, evaluation) => {
        await holderRoles.syncUser(guild, discordUserId, evaluation);
      },
    },
    (wallet) => readWalletEntitlements(env, wallet),
    env.HOLDER_RECHECK_INTERVAL_HOURS * 60 * 60 * 1000,
    env.HOLDER_GRACE_PERIOD_HOURS * 60 * 60 * 1000,
    env.HOLDER_SYNC_CONCURRENCY,
  );
  const commandContext: CommandContext = {
    env,
    appRepository,
    verificationRepository,
    verificationService,
    holderRoles,
    revalidator,
    channelControls,
  };

  client.on(Events.GuildMemberAdd, (member) => {
    if (member.guild.id !== env.DISCORD_GUILD_ID) return;
    void joins
      .record(member)
      .catch((error: unknown) =>
        logger.warn(
          { err: error instanceof Error ? error.message : "unknown" },
          "join monitor failed",
        ),
      );
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.guildId !== env.DISCORD_GUILD_ID) return;
    if (interaction.isChatInputCommand()) {
      void handleCommand(interaction, commandContext).catch((error: unknown) =>
        handleCommandError(interaction, error).catch(() => undefined),
      );
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === componentIds.ticketCategory) {
      void tickets.create(interaction).catch(async (error: unknown) => {
        const content = error instanceof Error ? error.message : "Ticket creation failed.";
        try {
          if (interaction.replied || interaction.deferred) await interaction.editReply({ content });
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch {
          logger.warn({ err: content }, "ticket interaction response expired");
        }
      });
      return;
    }
    if (!interaction.isButton()) return;
    void (async () => {
      if (interaction.customId === componentIds.completeBasicVerification) {
        await entrance.enter(interaction);
      } else if (interaction.customId === componentIds.verifyWallet) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!interaction.inCachedGuild()) throw new Error("Wallet verification requires DYØØR.");
        const maintenance = appRepository.getServerState<{ enabled: boolean }>(
          "maintenance",
        )?.enabled;
        if (maintenance) throw new Error("Wallet verification is temporarily in maintenance mode.");
        const verifiedRole = dyoorDiscordConfig.roles.find((role) => role.key === "dyoorified");
        const verifiedRoleId =
          verifiedRole && "existingId" in verifiedRole ? verifiedRole.existingId : undefined;
        if (
          interaction.member.id !== env.DISCORD_OWNER_ID &&
          (!verifiedRoleId || !interaction.member.roles.cache.has(verifiedRoleId))
        ) {
          throw new Error("Complete basic DYØØR verification first.");
        }
        const session = verificationService.createDiscordSession(
          interaction.user.id,
          interaction.guildId,
        );
        await interaction.editReply({
          content: `Your private, single-use wallet link expires in 10 minutes:\n${session.url}\n\nIt requests only a gas-free authentication signature—never an approval, transfer, or payment.`,
        });
      } else if (interaction.customId === componentIds.projectInfo) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const contracts = await inspectContractRegistry(env);
        await interaction.editReply(
          contracts
            .map((item) =>
              item.ok
                ? `✓ **${item.label}** · ${item.inspection?.network} (${item.inspection?.chainId}) · \`${item.inspection?.address}\` · ${item.inspection?.ownershipMethod}`
                : `✗ **${item.label}** · temporarily unavailable`,
            )
            .join("\n"),
        );
      } else if (interaction.customId === componentIds.officialLinks) {
        await interaction.reply({ content: configuredLinks(env), flags: MessageFlags.Ephemeral });
      } else if (interaction.customId === componentIds.openTicket) {
        await tickets.prompt(interaction);
      } else if (interaction.customId === componentIds.claimTicket) {
        if (
          !interaction.inCachedGuild() ||
          !buttonStaff(interaction.member, env.DISCORD_OWNER_ID)
        ) {
          throw new Error("Only authorized staff may claim tickets.");
        }
        await tickets.claim(interaction, interaction.member);
      } else if (interaction.customId === componentIds.closeTicket) {
        if (!interaction.inCachedGuild()) throw new Error("Ticket server context is missing.");
        await tickets.close(
          interaction,
          interaction.member,
          buttonStaff(interaction.member, env.DISCORD_OWNER_ID),
        );
      }
    })().catch((error: unknown) => {
      logger.warn(
        { err: error instanceof Error ? error.message : "unknown", customId: interaction.customId },
        "button interaction failed",
      );
      void safeButtonError(interaction, error);
    });
  });

  logger.info({ botId: client.user.id, guildId: guild.id }, "DYØØR bot connected");

  const web = await buildVerificationServer({
    env,
    repository: verificationRepository,
    service: verificationService,
    onVerified: async (result) => {
      const sync = await holderRoles.syncUser(guild, result.discordUserId, result.evaluation);
      const verificationLog = guild.channels.cache.find(
        (channel) => channel.type === ChannelType.GuildText && channel.name === "verification-log",
      );
      if (verificationLog?.type === ChannelType.GuildText) {
        const abbreviated = `${result.walletAddress.slice(0, 6)}…${result.walletAddress.slice(-4)}`;
        await verificationLog.send(
          `WALLET_LINKED · <@${result.discordUserId}> · ${abbreviated} · roles +${sync.added.length}/-${sync.removed.length}`,
        );
      }
    },
  });
  await web.listen({ host: env.HTTP_HOST, port: env.HTTP_PORT });
  logger.info(
    { host: env.HTTP_HOST, port: env.HTTP_PORT },
    "wallet verification service listening",
  );

  const timer = setInterval(
    () => {
      void revalidator.runOnce().then(
        (summary) => logger.info(summary, "holder revalidation completed"),
        (error: unknown) =>
          logger.error(
            { err: error instanceof Error ? error.message : "unknown" },
            "holder revalidation failed",
          ),
      );
    },
    15 * 60 * 1000,
  );
  timer.unref();

  const salesTimer = env.OPENSEA_API_KEY
    ? setInterval(() => {
        void sales.runOnce(guild).then(
          (summary) => logger.info(summary, "sales synchronization completed"),
          (error: unknown) =>
            logger.error(
              { err: error instanceof Error ? error.message : "unknown" },
              "sales synchronization failed",
            ),
        );
      }, env.SALES_POLL_INTERVAL_SECONDS * 1000)
    : null;
  salesTimer?.unref();

  const shutdown = async () => {
    clearInterval(timer);
    if (salesTimer) clearInterval(salesTimer);
    await web.close();
    await client.destroy();
    database.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  return { client, web, database };
}
