import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Routes,
  type APIMessage,
  type REST,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord.js";
import { createHash } from "node:crypto";
import type { AppEnv } from "../config/env.js";
import type { AppRepository } from "../database/repositories.js";
import type { GuildSnapshot } from "../discord/inspect.js";
import type { ProjectConfig } from "../discord/model.js";

export const componentIds = {
  completeBasicVerification: "entrance:complete",
  verifyWallet: "wallet:verify",
  projectInfo: "project:info",
  officialLinks: "project:links",
  openTicket: "ticket:open",
  ticketCategory: "ticket:category",
  claimTicket: "ticket:claim",
  closeTicket: "ticket:close",
} as const;

interface ManagedPanel {
  key: string;
  channelName: string;
  body: RESTPostAPIChannelMessageJSONBody;
}

const dyoorGreen = 0x00c805;
const securityRed = 0xd24d57;

function channelName(config: ProjectConfig, key: string) {
  const channel = config.categories
    .flatMap((category) => category.channels)
    .find((candidate) => candidate.key === key);
  if (!channel) throw new Error(`Managed panel channel ${key} is not configured`);
  return channel.name;
}

function officialLinksDescription(config: ProjectConfig, env: AppEnv) {
  const links = [
    env.WEBSITE_URL && `[Website](${env.WEBSITE_URL})`,
    env.X_URL && `[X](${env.X_URL})`,
    env.MARKETPLACE_URL && `[OpenSea](${env.MARKETPLACE_URL})`,
  ].filter((value): value is string => Boolean(value));
  const contracts = config.contracts.map((contract) => {
    const chain = config.chains.find((candidate) => candidate.key === contract.chainKey);
    return `**${contract.label}:** [\`${contract.address}\`](${chain?.explorer}/address/${contract.address})`;
  });
  return [...links, "", ...contracts].join("\n");
}

export function managedPanels(config: ProjectConfig, env: AppEnv): ManagedPanel[] {
  const basicVerification = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentIds.completeBasicVerification)
      .setLabel("Complete Verification")
      .setStyle(ButtonStyle.Success),
  );
  const walletVerification = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentIds.verifyWallet)
      .setLabel("Verify Wallet")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(componentIds.projectInfo)
      .setLabel("Contract Registry")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentIds.officialLinks)
      .setLabel("Official Links")
      .setStyle(ButtonStyle.Secondary),
  );
  const ticketButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentIds.openTicket)
      .setLabel("Open a Private Ticket")
      .setStyle(ButtonStyle.Primary),
  );

  return [
    {
      key: "welcome-panel",
      channelName: channelName(config, "welcome"),
      body: {
        embeds: [
          new EmbedBuilder()
            .setColor(dyoorGreen)
            .setTitle(config.copy.welcome.title)
            .setDescription(config.copy.welcome.body)
            .setFooter({ text: "D.Y.O.O.R — Directive: Yield Opportunity Optimization Robots" })
            .toJSON(),
        ],
      },
    },
    {
      key: "rules-panel",
      channelName: channelName(config, "rules"),
      body: {
        embeds: [
          new EmbedBuilder()
            .setColor(dyoorGreen)
            .setTitle(config.copy.rules.title)
            .setDescription(
              config.copy.rules.rules
                .map((rule, index) => `**${index + 1}.** ${rule}`)
                .join("\n\n"),
            )
            .setFooter({
              text: "This basic check is one safety layer; it is not proof of wallet ownership.",
            })
            .toJSON(),
        ],
        components: [basicVerification.toJSON()],
      },
    },
    {
      key: "waiting-room-panel",
      channelName: channelName(config, "waiting-room"),
      body: {
        embeds: [
          new EmbedBuilder()
            .setColor(dyoorGreen)
            .setTitle(config.copy.waitingRoom.title)
            .setDescription(config.copy.waitingRoom.body)
            .addFields({
              name: "Gas-free role sync",
              value:
                "Link one or more wallets. Each wallet signs a short-lived identity message; the bot independently checks Season 1, Ascension, Season 2, and HoodYØØR.",
            })
            .toJSON(),
        ],
        components: [walletVerification.toJSON()],
      },
    },
    {
      key: "ticket-panel",
      channelName: channelName(config, "open-a-ticket"),
      body: {
        embeds: [
          new EmbedBuilder()
            .setColor(dyoorGreen)
            .setTitle("DYØØR SUPPORT UPLINK")
            .setDescription(
              "Open a private ticket for support, holder verification, either season, Ascension, HoodYØØR, Energy, Trait Lab, reports, or partnerships. Only you, authorized staff, and the bot can view it.",
            )
            .toJSON(),
        ],
        components: [ticketButton.toJSON()],
      },
    },
    {
      key: "security-panel",
      channelName: channelName(config, "official-links"),
      body: {
        embeds: [
          new EmbedBuilder()
            .setColor(securityRed)
            .setTitle(config.copy.security.title)
            .setDescription(config.copy.security.body)
            .toJSON(),
          new EmbedBuilder()
            .setColor(dyoorGreen)
            .setTitle("OFFICIAL LINKS + CONTRACTS")
            .setDescription(officialLinksDescription(config, env))
            .toJSON(),
        ],
      },
    },
  ];
}

export interface ManagedMessagePlanItem {
  operation: "CREATE" | "UPDATE";
  key: string;
  channelName: string;
}

function panelContentHash(panel: ManagedPanel) {
  return createHash("sha256").update(JSON.stringify(panel.body)).digest("hex");
}

export function managedMessagePlan(
  repository: AppRepository,
  config: ProjectConfig,
  env: AppEnv,
): ManagedMessagePlanItem[] {
  const actions: ManagedMessagePlanItem[] = [];
  for (const panel of managedPanels(config, env)) {
    const saved = repository.getManagedMessage(panel.key);
    const contentHash = panelContentHash(panel);
    if (!saved) {
      actions.push({ operation: "CREATE", key: panel.key, channelName: panel.channelName });
    } else if (saved.content_hash !== contentHash) {
      actions.push({ operation: "UPDATE", key: panel.key, channelName: panel.channelName });
    }
  }
  return actions;
}

export async function publishManagedPanels(
  rest: REST,
  snapshot: GuildSnapshot,
  repository: AppRepository,
  config: ProjectConfig,
  env: AppEnv,
) {
  let created = 0;
  let updated = 0;
  for (const panel of managedPanels(config, env)) {
    const contentHash = panelContentHash(panel);
    const desiredChannel = config.categories
      .flatMap((category) => category.channels)
      .find((candidate) => candidate.name === panel.channelName);
    const channel = snapshot.channels.find(
      (candidate) =>
        Number(candidate.type) === 0 &&
        (candidate.id === desiredChannel?.existingId || candidate.name === panel.channelName),
    );
    if (!channel) throw new Error(`Cannot publish ${panel.key}; #${panel.channelName} is missing`);
    const saved = repository.getManagedMessage(panel.key);
    if (saved && saved.channel_id === channel.id && saved.content_hash === contentHash) continue;
    if (saved && saved.channel_id === channel.id) {
      try {
        await rest.patch(Routes.channelMessage(channel.id, saved.message_id), {
          body: panel.body,
          reason: "Update DYØØR bot-managed panel",
        });
        repository.saveManagedMessage(
          panel.key,
          snapshot.guild.id,
          channel.id,
          saved.message_id,
          contentHash,
        );
        updated += 1;
        continue;
      } catch (error) {
        if ((error as { code?: number }).code !== 10008) throw error;
      }
    }
    const message = (await rest.post(Routes.channelMessages(channel.id), {
      body: panel.body,
      reason: "Create DYØØR bot-managed panel",
    })) as APIMessage;
    repository.saveManagedMessage(
      panel.key,
      snapshot.guild.id,
      channel.id,
      message.id,
      contentHash,
    );
    created += 1;
  }
  return { created, updated, deletes: 0 as const };
}
