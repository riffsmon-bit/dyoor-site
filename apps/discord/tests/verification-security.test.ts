import { recoverMessageAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EntitlementRead } from "../src/blockchain/contract.js";
import type { AppEnv } from "../src/config/env.js";
import type { DatabaseConnection } from "../src/database/database.js";
import type { HolderRoleKey } from "../src/discord/model.js";
import { VerificationRepository } from "../src/verification/repository.js";
import { VerificationService } from "../src/verification/service.js";
import { entitlementReads, ids, testDatabase, testEnv } from "./helpers.js";

const alice = privateKeyToAccount(
  "0x1000000000000000000000000000000000000000000000000000000000000001",
);
const bob = privateKeyToAccount(
  "0x2000000000000000000000000000000000000000000000000000000000000002",
);
const mallory = privateKeyToAccount(
  "0x3000000000000000000000000000000000000000000000000000000000000003",
);

const openDatabases: DatabaseConnection[] = [];
afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

type Reads = Record<HolderRoleKey, EntitlementRead>;

function context(
  read: (env: AppEnv, wallet: Address) => Promise<Reads> = async () =>
    entitlementReads({ season1: { key: "season1", status: "QUALIFIED", balance: 1n } }),
) {
  let now = new Date("2026-08-10T12:00:00.000Z");
  const database = testDatabase();
  openDatabases.push(database);
  const repository = new VerificationRepository(database, () => now);
  const verifySignature = async (address: Address, message: string, signature: Hex) => {
    const recovered = await recoverMessageAddress({ message, signature });
    return recovered.toLowerCase() === address.toLowerCase();
  };
  const service = new VerificationService(testEnv(), repository, () => now, read, verifySignature);
  return {
    database,
    repository,
    service,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

async function prepare(service: VerificationService, userId: string, account: PrivateKeyAccount) {
  const session = service.createDiscordSession(userId, ids.guild);
  const prepared = service.prepare(session.token, account.address, 143);
  const signature = await account.signMessage({ message: prepared.message });
  return { ...session, ...prepared, signature };
}

describe("secure DYØØR wallet verification", () => {
  it("binds a single-use Discord session to canonical SIWE on Monad", async () => {
    const { database, repository, service } = context();
    const prepared = await prepare(service, ids.user, alice);
    expect(prepared.url).toContain("/verify?session=");
    expect(prepared.message).toContain("Sign in to DYØØR");
    expect(prepared.message).toContain("Chain ID: 143");
    expect(prepared.message).toContain(`urn:dyoor:discord-user:${ids.user}`);
    expect(prepared.message).toContain(`urn:dyoor:discord-guild:${ids.guild}`);

    const result = await service.complete(prepared.token, prepared.signature);
    expect(result.evaluation.season1Holder).toBe(true);
    expect(repository.getUserWallets(ids.user)).toHaveLength(1);
    const columns = database.prepare("PRAGMA table_info(verification_sessions)").all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).not.toContain("signature");
  });

  it("rejects replay, expiry, wrong-chain preparation, and a signature from another wallet", async () => {
    const read = vi.fn(async () => entitlementReads());
    const { repository, service, setNow } = context(read);
    const first = await prepare(service, ids.user, alice);
    await service.complete(first.token, first.signature);
    await expect(service.complete(first.token, first.signature)).rejects.toThrow("already used");

    const expired = service.createDiscordSession(ids.user, ids.guild);
    setNow("2026-08-10T12:11:00.000Z");
    expect(() => service.prepare(expired.token, alice.address, 143)).toThrow("invalid or expired");

    const wrongChain = service.createDiscordSession(ids.user, ids.guild);
    expect(() => service.prepare(wrongChain.token, alice.address, 1)).toThrow("Monad Mainnet");

    setNow("2026-08-10T12:12:00.000Z");
    const invalidSession = service.createDiscordSession(ids.user, ids.guild);
    const invalidPrepared = service.prepare(invalidSession.token, alice.address, 143);
    const badSignature = await mallory.signMessage({ message: invalidPrepared.message });
    await expect(service.complete(invalidSession.token, badSignature)).rejects.toThrow(
      "could not be verified",
    );
    expect(repository.getByToken(invalidSession.token)?.failedAttempts).toBe(1);
  });

  it("supports multiple wallets and independently aggregates overlapping roles", async () => {
    const read = async (_env: AppEnv, wallet: Address) =>
      wallet.toLowerCase() === alice.address.toLowerCase()
        ? entitlementReads({
            season1: { key: "season1", status: "QUALIFIED", balance: 2n },
            ascended: { key: "ascended", status: "QUALIFIED", balance: 1n },
          })
        : entitlementReads({
            season2: { key: "season2", status: "QUALIFIED", balance: 3n },
            hoodyoor: { key: "hoodyoor", status: "QUALIFIED", balance: 1n },
          });
    const { repository, service } = context(read);
    const first = await prepare(service, ids.user, alice);
    await service.complete(first.token, first.signature);
    const second = await prepare(service, ids.user, bob);
    const result = await service.complete(second.token, second.signature);
    expect(repository.getUserWallets(ids.user)).toHaveLength(2);
    expect(result.evaluation).toMatchObject({
      season1Holder: true,
      ascended: true,
      season2Holder: true,
      hoodYoorHolder: true,
    });
  });

  it("links verified non-holders while granting no holder role", async () => {
    const { repository, service } = context(async () => entitlementReads());
    const prepared = await prepare(service, ids.user, alice);
    const result = await service.complete(prepared.token, prepared.signature);
    expect(result.evaluation).toMatchObject({
      dyoorified: true,
      season1Holder: false,
      ascended: false,
      season2Holder: false,
      hoodYoorHolder: false,
    });
    expect(repository.getUserWallets(ids.user)).toHaveLength(1);
  });

  it("never reveals who owns a wallet already linked to another Discord account", async () => {
    const { service } = context();
    const first = await prepare(service, ids.user, alice);
    await service.complete(first.token, first.signature);
    const second = await prepare(service, ids.secondUser, alice);
    await expect(service.complete(second.token, second.signature)).rejects.toThrow(
      "already associated with another Discord account",
    );
  });

  it("records module RPC failures without converting them to confirmed zero", async () => {
    const errors = Object.fromEntries(
      (["season1", "ascended", "season2", "hoodyoor"] as const).map((key) => [
        key,
        { key, status: "RPC_ERROR", error: "provider timeout" },
      ]),
    ) as Reads;
    const { repository, service } = context(async () => errors);
    const prepared = await prepare(service, ids.user, alice);
    const result = await service.complete(prepared.token, prepared.signature);
    expect(result.evaluation.rpcUncertain).toEqual(["season1", "ascended", "season2", "hoodyoor"]);
    expect(
      repository.getWalletEntitlements(ids.user).every((item) => item.status === "RPC_ERROR"),
    ).toBe(true);
  });
});
