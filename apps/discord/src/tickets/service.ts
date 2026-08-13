import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type GuildMember,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import type { AppEnv } from "../config/env.js";
import type { AppRepository } from "../database/repositories.js";
import { AuthorizationError } from "../bot/authorization.js";
import { componentIds } from "../bot/panels.js";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";

const ticketCategories = {
  general: "General Support",
  holder: "Holder Verification",
  season1: "Season 1",
  ascension: "Ascension",
  season2: "Season 2",
  hoodyoor: "HoodYØØR",
  energy: "Energy",
  traitlab: "Trait Lab",
  report: "Report a User",
  partnership: "Partnership",
} as const;

export class TicketService {
  constructor(
    private readonly env: AppEnv,
    private readonly repository: AppRepository,
  ) {}

  async prompt(interaction: ButtonInteraction) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(componentIds.ticketCategory)
      .setPlaceholder("Choose a private ticket type")
      .addOptions(Object.entries(ticketCategories).map(([value, label]) => ({ label, value })));
    await interaction.reply({
      content: "Choose the kind of private room you need.",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
  }

  async create(interaction: StringSelectMenuInteraction) {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.env.DISCORD_GUILD_ID) {
      throw new Error("Tickets are not configured for this server.");
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const existing = this.repository.getOpenTicketForUser(interaction.guildId, interaction.user.id);
    if (existing) {
      await interaction.editReply({
        content: `You already have an open private ticket: <#${existing.channel_id}>`,
      });
      return;
    }
    const categoryKey = interaction.values[0] as keyof typeof ticketCategories | undefined;
    if (!categoryKey || !(categoryKey in ticketCategories))
      throw new Error("Select a valid ticket type.");
    const parent = interaction.guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        ["open tickets", "open-tickets"].includes(channel.name.toLowerCase()),
    );
    if (!parent) throw new Error("The existing Open Tickets category is not ready.");
    const staffRoleIds = new Set<string>(
      dyoorDiscordConfig.staffRoles.map((role) => role.existingId),
    );
    const staffRoles = interaction.guild.roles.cache.filter((role) => staffRoleIds.has(role.id));
    const bot = await interaction.guild.members.fetchMe();
    const suffix = randomBytes(2).toString("hex");
    const channel = await interaction.guild.channels.create({
      name: `ticket-${categoryKey}-${interaction.user.id.slice(-4)}-${suffix}`,
      type: ChannelType.GuildText,
      parent: parent.id,
      topic: `${ticketCategories[categoryKey]} ticket for Discord user ${interaction.user.id}`,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: bot.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
          ],
        },
        ...staffRoles.map((role) => ({
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        })),
      ],
      reason: `Private ${ticketCategories[categoryKey]} ticket`,
    });
    this.repository.createTicket(
      interaction.guildId,
      channel.id,
      interaction.user.id,
      ticketCategories[categoryKey],
    );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(componentIds.claimTicket)
        .setLabel("Claim")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentIds.closeTicket)
        .setLabel("Close")
        .setStyle(ButtonStyle.Danger),
    );
    await channel.send({
      content: `<@${interaction.user.id}> Welcome to your private **${ticketCategories[categoryKey]}** ticket.\n\n**WALLET SUPPORT SAFETY**\nNever send a seed phrase, recovery phrase, private key, wallet signature, approval, transfer, or authentication secret. DYØØR staff do not need any of these to help you.`,
      components: [row],
    });
    await interaction.editReply({
      content: `Your private ticket is ready: <#${channel.id}>`,
    });
    await this.log(
      interaction.guild,
      `TICKET_OPENED · <#${channel.id}> · ${ticketCategories[categoryKey]} · <@${interaction.user.id}>`,
    );
  }

  async claim(interaction: ButtonInteraction, staff: GuildMember) {
    if (!interaction.channelId) throw new Error("Ticket channel is missing.");
    const changed = this.repository.claimTicket(interaction.channelId, staff.id);
    await interaction.reply({
      content: changed
        ? `Ticket claimed by <@${staff.id}>.`
        : "This ticket is already claimed or closed.",
      flags: MessageFlags.Ephemeral,
    });
  }

  async close(interaction: ButtonInteraction, actor: GuildMember, isStaff: boolean) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ticket = this.repository.getTicketByChannel(interaction.channelId);
    if (!ticket) throw new Error("This channel is not a managed ticket.");
    if (!isStaff && ticket.creator_user_id !== actor.id) {
      throw new AuthorizationError(
        "Only the ticket creator or authorized staff may close this ticket.",
      );
    }
    if (this.repository.closeTicket(interaction.channelId) === 0) {
      await interaction.editReply({
        content: "This ticket is already closed.",
      });
      return;
    }
    const channel = interaction.channel;
    if (channel?.type !== ChannelType.GuildText) throw new Error("Ticket channel is unavailable.");
    await channel.permissionOverwrites.edit(
      ticket.creator_user_id,
      { SendMessages: false },
      { reason: "Ticket closed without deleting channel" },
    );
    if (!channel.name.startsWith("closed-"))
      await channel.setName(
        `closed-${channel.name}`.slice(0, 100),
        "Ticket closed; retained for review",
      );
    await interaction.editReply({
      content: "Ticket closed and preserved. No channel or messages were deleted.",
    });
    await this.log(actor.guild, `TICKET_CLOSED · <#${channel.id}> · by <@${actor.id}>`);
  }

  private async log(guild: NonNullable<ButtonInteraction["guild"]>, message: string) {
    const channel = guild.channels.cache.find(
      (candidate): candidate is TextChannel =>
        candidate.type === ChannelType.GuildText && candidate.name === "ticket-log",
    );
    if (channel) await channel.send(message);
  }
}
