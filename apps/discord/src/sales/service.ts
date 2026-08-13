import { ChannelType, EmbedBuilder, type Guild, type TextChannel } from "discord.js";
import { getAddress, formatUnits, type Address, type Hash } from "viem";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";
import { createChainClient } from "../blockchain/contract.js";
import type { AppEnv } from "../config/env.js";
import type { AppRepository } from "../database/repositories.js";
import type { SalesCollectionDefinition } from "../discord/model.js";
import type { SalesRepository, ValidatedSale } from "./repository.js";

const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

interface OpenSeaSaleEvent {
  event_type?: string;
  event_timestamp?: number | string;
  transaction?: string | { hash?: string };
  order_hash?: string;
  seller?: string;
  buyer?: string;
  payment?: { quantity?: string; decimals?: number; symbol?: string };
  nft?: {
    identifier?: string;
    contract?: string;
    name?: string;
    display_image_url?: string;
    image_url?: string;
    opensea_url?: string;
  };
}

export interface SalesRunSummary {
  collectionsChecked: number;
  eventsInspected: number;
  validated: number;
  posted: number;
  duplicates: number;
  rejected: number;
  errors: string[];
}

interface ReceiptLike {
  status: "success" | "reverted";
  logs: Array<{
    address: Address;
    topics: readonly [`0x${string}`, ...`0x${string}`[]] | readonly `0x${string}`[];
    logIndex: number | null;
  }>;
}

function transactionHash(event: OpenSeaSaleEvent) {
  return typeof event.transaction === "string" ? event.transaction : event.transaction?.hash;
}

function safeAddress(value: unknown): Address | null {
  if (typeof value !== "string") return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

function addressFromTopic(topic: string | undefined): Address | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return safeAddress(`0x${topic.slice(-40)}`);
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeOpenSeaUrl(value: unknown) {
  const valueUrl = safeHttpsUrl(value);
  if (!valueUrl) return "";
  const url = new URL(valueUrl);
  return url.hostname === "opensea.io" || url.hostname.endsWith(".opensea.io") ? valueUrl : "";
}

function saleTimestamp(value: OpenSeaSaleEvent["event_timestamp"]) {
  if (typeof value === "number") {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function displayPayment(event: OpenSeaSaleEvent) {
  const quantity = /^\d+$/.test(String(event.payment?.quantity ?? ""))
    ? BigInt(String(event.payment?.quantity))
    : 0n;
  const decimals = Number.isInteger(event.payment?.decimals)
    ? Math.min(36, Math.max(0, Number(event.payment?.decimals)))
    : 18;
  const symbol = String(event.payment?.symbol || "MON")
    .replace(/[^a-zA-Z0-9.$_-]/g, "")
    .slice(0, 12);
  return { amount: formatUnits(quantity, decimals), symbol: symbol || "MON" };
}

export class OpenSeaSalesService {
  private running = false;

  constructor(
    private readonly env: AppEnv,
    private readonly appRepository: AppRepository,
    private readonly salesRepository: SalesRepository,
    private readonly request: typeof fetch = fetch,
    private readonly receiptReader: (hash: Hash) => Promise<ReceiptLike> = (hash) =>
      createChainClient(env, "monad").getTransactionReceipt({ hash }),
  ) {}

  private headers() {
    if (!this.env.OPENSEA_API_KEY) throw new Error("OPENSEA_API_KEY is not configured");
    return { accept: "application/json", "x-api-key": this.env.OPENSEA_API_KEY };
  }

  private async resolveSlug(collection: SalesCollectionDefinition, force = false) {
    const cacheKey = `sales:opensea-slug:${collection.key}`;
    const cached = this.appRepository.getServerState<{ slug: string }>(cacheKey)?.slug;
    if (!force && cached && /^[a-z0-9-]{2,120}$/.test(cached)) return cached;
    const response = await this.request(
      `${this.env.OPENSEA_API_BASE_URL}/api/v2/chain/monad/contract/${collection.address}`,
      { headers: this.headers(), signal: AbortSignal.timeout(this.env.RPC_TIMEOUT_MS) },
    );
    if (!response.ok) throw new Error(`OpenSea collection lookup returned HTTP ${response.status}`);
    const data = (await response.json().catch(() => ({}))) as {
      collection?: string | { slug?: string };
    };
    const slug =
      typeof data.collection === "string" ? data.collection : String(data.collection?.slug ?? "");
    if (!/^[a-z0-9-]{2,120}$/.test(slug))
      throw new Error("OpenSea returned an invalid collection slug");
    this.appRepository.setServerState(cacheKey, { slug, checkedAt: new Date().toISOString() });
    return slug;
  }

  async checkSources() {
    const results = [] as Array<{
      key: SalesCollectionDefinition["key"];
      ok: boolean;
      detail: string;
    }>;
    for (const collection of dyoorDiscordConfig.salesCollections) {
      try {
        const slug = await this.resolveSlug(collection, true);
        results.push({ key: collection.key, ok: true, detail: slug });
      } catch (error) {
        results.push({
          key: collection.key,
          ok: false,
          detail: error instanceof Error ? error.message : "OpenSea source unavailable",
        });
      }
    }
    return results;
  }

  private async fetchEvents(collection: SalesCollectionDefinition) {
    const slug = await this.resolveSlug(collection);
    const response = await this.request(
      `${this.env.OPENSEA_API_BASE_URL}/api/v2/events/collection/${encodeURIComponent(slug)}?event_type=sale&limit=50`,
      { headers: this.headers(), signal: AbortSignal.timeout(this.env.RPC_TIMEOUT_MS) },
    );
    if (!response.ok) throw new Error(`OpenSea sales lookup returned HTTP ${response.status}`);
    const data = (await response.json().catch(() => ({}))) as { asset_events?: OpenSeaSaleEvent[] };
    return (Array.isArray(data.asset_events) ? data.asset_events : [])
      .filter((event) => event.event_type === "sale")
      .sort(
        (left, right) => saleTimestamp(left.event_timestamp) - saleTimestamp(right.event_timestamp),
      );
  }

  private async validate(
    collection: SalesCollectionDefinition,
    event: OpenSeaSaleEvent,
  ): Promise<ValidatedSale | null> {
    const contract = safeAddress(event.nft?.contract);
    const configured = getAddress(collection.address);
    const seller = safeAddress(event.seller);
    const buyer = safeAddress(event.buyer);
    const hash = transactionHash(event);
    const tokenId = String(event.nft?.identifier ?? "").trim();
    if (
      !contract ||
      contract !== configured ||
      !seller ||
      !buyer ||
      !hash ||
      !/^0x[0-9a-fA-F]{64}$/.test(hash) ||
      !/^\d+$/.test(tokenId)
    ) {
      return null;
    }
    const receipt = await this.receiptReader(hash as Hash);
    if (receipt.status !== "success") return null;
    const transfer = receipt.logs.find((log) => {
      if (
        getAddress(log.address) !== configured ||
        log.topics[0]?.toLowerCase() !== transferTopic
      ) {
        return false;
      }
      const from = addressFromTopic(log.topics[1]);
      const to = addressFromTopic(log.topics[2]);
      const idTopic = log.topics[3];
      if (!from || !to || !idTopic) return false;
      return from === seller && to === buyer && BigInt(idTopic) === BigInt(tokenId);
    });
    if (!transfer || transfer.logIndex === null) return null;
    const payment = displayPayment(event);
    return {
      chainId: 143,
      transactionHash: hash as Hash,
      logIndex: transfer.logIndex,
      contractAddress: configured,
      tokenId,
      collectionKey: collection.key,
      detail: {
        label: collection.label,
        buyer,
        seller,
        amount: payment.amount,
        symbol: payment.symbol,
        marketplace: "OpenSea",
        eventTimestamp: new Date(saleTimestamp(event.event_timestamp)).toISOString(),
        imageUrl: safeHttpsUrl(event.nft?.display_image_url || event.nft?.image_url),
        openSeaUrl: safeOpenSeaUrl(event.nft?.opensea_url),
      },
    };
  }

  private salesChannel(guild: Guild): TextChannel {
    const channel = guild.channels.cache.get(this.env.SALES_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error("Configured sales channel is unavailable");
    }
    return channel;
  }

  private async post(guild: Guild, collection: SalesCollectionDefinition, sale: ValidatedSale) {
    const detail = sale.detail as {
      buyer: string;
      seller: string;
      amount: string;
      symbol: string;
      marketplace: string;
      imageUrl: string;
      openSeaUrl: string;
    };
    const explorer = dyoorDiscordConfig.chains.find(
      (chain) => chain.key === collection.chainKey,
    )?.explorer;
    const embed = new EmbedBuilder()
      .setColor(collection.key === "season2" ? 0x25e3a6 : 0xa84400)
      .setTitle(`${collection.label} SALE · #${sale.tokenId}`)
      .setDescription(`**${detail.amount} ${detail.symbol}** on ${detail.marketplace}`)
      .addFields(
        { name: "Buyer", value: `\`${detail.buyer}\``, inline: false },
        { name: "Seller", value: `\`${detail.seller}\``, inline: false },
        {
          name: "Verified transaction",
          value: `[View on MonadScan](${explorer}/tx/${sale.transactionHash})${detail.openSeaUrl ? ` · [OpenSea](${detail.openSeaUrl})` : ""}`,
        },
      )
      .setTimestamp();
    if (detail.imageUrl) embed.setThumbnail(detail.imageUrl);
    return this.salesChannel(guild).send({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  async runOnce(guild: Guild): Promise<SalesRunSummary> {
    if (this.running) throw new Error("Sales sync is already running");
    this.running = true;
    const summary: SalesRunSummary = {
      collectionsChecked: 0,
      eventsInspected: 0,
      validated: 0,
      posted: 0,
      duplicates: 0,
      rejected: 0,
      errors: [],
    };
    try {
      for (const collection of dyoorDiscordConfig.salesCollections) {
        try {
          const events = await this.fetchEvents(collection);
          summary.collectionsChecked += 1;
          summary.eventsInspected += events.length;
          for (const event of events) {
            const sale = await this.validate(collection, event);
            if (!sale) {
              summary.rejected += 1;
              continue;
            }
            summary.validated += 1;
            const registration = this.salesRepository.register(sale);
            if (registration.status === "POSTED") {
              summary.duplicates += 1;
              continue;
            }
            const message = await this.post(guild, collection, sale);
            this.salesRepository.markPosted(registration.eventId, message.id);
            summary.posted += 1;
          }
        } catch (error) {
          summary.errors.push(
            `${collection.label}: ${error instanceof Error ? error.message : "sales source failure"}`,
          );
        }
      }
      return summary;
    } finally {
      this.running = false;
    }
  }
}
