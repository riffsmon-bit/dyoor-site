import { ChannelType } from "discord.js";
import { getAddress, type Address, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import type { DatabaseConnection } from "../src/database/database.js";
import { AppRepository } from "../src/database/repositories.js";
import { SalesRepository, type ValidatedSale } from "../src/sales/repository.js";
import { OpenSeaSalesService } from "../src/sales/service.js";
import { testDatabase, testEnv } from "./helpers.js";

const openDatabases: DatabaseConnection[] = [];
afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

const seller = getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const buyer = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const txHash: Hex = `0x${"12".repeat(32)}`;
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
const addressTopic = (address: Address): Hex =>
  `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
const tokenTopic = (tokenId: bigint): Hex => `0x${tokenId.toString(16).padStart(64, "0")}`;

describe("validated, deduplicated sales", () => {
  it("deduplicates by chain, transaction, log index, and contract", () => {
    const database = testDatabase();
    openDatabases.push(database);
    const repository = new SalesRepository(database);
    const sale: ValidatedSale = {
      chainId: 143,
      transactionHash: txHash,
      logIndex: 7,
      contractAddress: getAddress(dyoorDiscordConfig.salesCollections[1].address),
      tokenId: "42",
      collectionKey: "season2",
      detail: {},
    };
    const first = repository.register(sale);
    expect(first.status).toBe("NEW");
    repository.markPosted(first.eventId, "discord-message-1");
    expect(repository.register(sale)).toMatchObject({
      eventId: first.eventId,
      status: "POSTED",
      discordMessageId: "discord-message-1",
    });
  });

  it("posts a Season 2 sale only after matching the receipt Transfer log", async () => {
    const database = testDatabase();
    openDatabases.push(database);
    const env = testEnv();
    const appRepository = new AppRepository(database);
    const salesRepository = new SalesRepository(database);
    const season2 = dyoorDiscordConfig.salesCollections.find((item) => item.key === "season2")!;
    const request = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/contract/")) {
        return new Response(
          JSON.stringify({
            collection: url.toLowerCase().includes(season2.address.toLowerCase())
              ? "dyoor-season-2"
              : "dyoor-season-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const events = url.includes("dyoor-season-2")
        ? [
            {
              event_type: "sale",
              event_timestamp: "2026-08-10T12:00:00.000Z",
              transaction: txHash,
              order_hash: `0x${"34".repeat(32)}`,
              seller,
              buyer,
              payment: { quantity: "1250000000000000000", decimals: 18, symbol: "MON" },
              nft: {
                identifier: "42",
                contract: season2.address,
                name: "D.Y.O.O.R #42",
                display_image_url: "https://i.seadn.io/example.png",
                opensea_url: "https://opensea.io/assets/monad/example/42",
              },
            },
          ]
        : [];
      return new Response(JSON.stringify({ asset_events: events }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const receiptReader = vi.fn(async () => ({
      status: "success" as const,
      logs: [
        {
          address: getAddress(season2.address),
          topics: [
            transferTopic,
            addressTopic(seller),
            addressTopic(buyer),
            tokenTopic(42n),
          ] as const,
          logIndex: 7,
        },
      ],
    }));
    const send = vi.fn(async () => ({ id: "discord-sale-message" }));
    const guild = {
      channels: {
        cache: new Map([[env.SALES_CHANNEL_ID, { type: ChannelType.GuildText, send }]]),
      },
    } as never;
    const service = new OpenSeaSalesService(
      env,
      appRepository,
      salesRepository,
      request,
      receiptReader,
    );

    const first = await service.runOnce(guild);
    expect(first).toMatchObject({ validated: 1, posted: 1, duplicates: 0, rejected: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(send.mock.calls[0])).toContain("SEASON 2 SALE");
    expect(JSON.stringify(send.mock.calls[0])).toContain(txHash);

    const second = await service.runOnce(guild);
    expect(second.duplicates).toBe(1);
    expect(second.posted).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
