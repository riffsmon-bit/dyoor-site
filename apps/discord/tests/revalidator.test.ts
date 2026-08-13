import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConnection } from "../src/database/database.js";
import { HolderRevalidator } from "../src/holders/revalidator.js";
import { VerificationRepository } from "../src/verification/repository.js";
import { entitlementReads, ids, testDatabase } from "./helpers.js";

const wallet = "0x1111111111111111111111111111111111111111";
const openDatabases: DatabaseConnection[] = [];
afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

function setup() {
  const database = testDatabase();
  openDatabases.push(database);
  const repository = new VerificationRepository(database);
  const session = repository.createSession(ids.user, ids.guild);
  repository.prepareSession(session.token, wallet, "nonce", "message");
  repository.linkWalletAndComplete(
    session.token,
    wallet,
    entitlementReads({ season2: { key: "season2", status: "QUALIFIED", balance: 1n } }),
    { season1: 143, ascended: 143, season2: 143, hoodyoor: 4663 },
  );
  const syncRoles = vi.fn(async () => undefined);
  return { repository, syncRoles };
}

describe("periodic holder revalidation", () => {
  it("checks every module and synchronizes one combined evaluation", async () => {
    const { repository, syncRoles } = setup();
    const revalidator = new HolderRevalidator(
      repository,
      { syncRoles },
      async () =>
        entitlementReads({
          season1: { key: "season1", status: "QUALIFIED", balance: 1n },
          season2: { key: "season2", status: "QUALIFIED", balance: 2n },
        }),
      6 * 60 * 60 * 1000,
      24 * 60 * 60 * 1000,
      2,
    );
    const summary = await revalidator.runOnce(true);
    expect(summary).toMatchObject({
      walletsChecked: 1,
      moduleChecks: 4,
      usersSynced: 1,
      qualifiedReads: 2,
      rpcFailures: 0,
    });
    expect(syncRoles).toHaveBeenCalledWith(
      ids.user,
      expect.objectContaining({ season1Holder: true, season2Holder: true }),
    );
  });

  it("treats provider failure as uncertainty and never as a role-removal signal", async () => {
    const { repository, syncRoles } = setup();
    const revalidator = new HolderRevalidator(
      repository,
      { syncRoles },
      async () =>
        entitlementReads({
          season2: { key: "season2", status: "RPC_ERROR", error: "provider unavailable" },
        }),
      1,
      24 * 60 * 60 * 1000,
    );
    const summary = await revalidator.runOnce(true);
    expect(summary.rpcFailures).toBe(1);
    expect(repository.evaluateUserRoles(ids.user).season2Holder).toBe(true);
    expect(repository.evaluateUserRoles(ids.user).rpcUncertain).toContain("season2");
    expect(syncRoles).toHaveBeenCalledWith(
      ids.user,
      expect.objectContaining({ season2Holder: true }),
    );
  });
});
