import { afterEach, describe, expect, it } from "vitest";
import type { EntitlementRead } from "../src/blockchain/contract.js";
import type { DatabaseConnection } from "../src/database/database.js";
import type { HolderRoleKey } from "../src/discord/model.js";
import { VerificationRepository } from "../src/verification/repository.js";
import { entitlementReads, ids, testDatabase } from "./helpers.js";

const wallet = "0x1111111111111111111111111111111111111111";
const chainIds: Record<HolderRoleKey, number> = {
  season1: 143,
  ascended: 143,
  season2: 143,
  hoodyoor: 4663,
};
const grace = 24 * 60 * 60 * 1000;
const openDatabases: DatabaseConnection[] = [];

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

function setup() {
  let now = new Date("2026-08-10T12:00:00.000Z");
  const database = testDatabase();
  openDatabases.push(database);
  const repository = new VerificationRepository(database, () => now);
  const session = repository.createSession(ids.user, ids.guild);
  repository.prepareSession(session.token, wallet, "nonce", "canonical message");
  repository.linkWalletAndComplete(
    session.token,
    wallet,
    entitlementReads({
      season1: { key: "season1", status: "QUALIFIED", balance: 1n },
      season2: { key: "season2", status: "QUALIFIED", balance: 2n },
    }),
    chainIds,
    grace,
  );
  return {
    database,
    repository,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

function record(repository: VerificationRepository, key: HolderRoleKey, read: EntitlementRead) {
  return repository.recordEntitlementRead(wallet, key, chainIds[key], read, grace);
}

describe("centralized multi-role evaluator", () => {
  it("applies a 24-hour, two-successful-check grace period per role", () => {
    const { repository, setNow } = setup();
    record(repository, "season2", { key: "season2", status: "NOT_QUALIFIED", balance: 0n });
    expect(repository.evaluateUserRoles(ids.user).season2Holder).toBe(true);
    expect(
      repository.getWalletEntitlements(ids.user).find((item) => item.entitlementKey === "season2")
        ?.status,
    ).toBe("ZERO_PENDING");

    setNow("2026-08-11T13:00:00.000Z");
    record(repository, "season2", { key: "season2", status: "NOT_QUALIFIED", balance: 0n });
    const evaluation = repository.evaluateUserRoles(ids.user);
    expect(evaluation.season2Holder).toBe(false);
    expect(evaluation.season1Holder).toBe(true);
  });

  it("preserves the relevant role during an RPC outage", () => {
    const { repository } = setup();
    record(repository, "season1", { key: "season1", status: "RPC_ERROR", error: "timeout" });
    const evaluation = repository.evaluateUserRoles(ids.user);
    expect(evaluation.season1Holder).toBe(true);
    expect(evaluation.rpcUncertain).toContain("season1");
  });

  it("removes only the independently confirmed lost entitlement", () => {
    const { repository, setNow } = setup();
    record(repository, "season1", { key: "season1", status: "NOT_QUALIFIED", balance: 0n });
    setNow("2026-08-11T13:00:00.000Z");
    record(repository, "season1", { key: "season1", status: "NOT_QUALIFIED", balance: 0n });
    expect(repository.evaluateUserRoles(ids.user)).toMatchObject({
      season1Holder: false,
      season2Holder: true,
    });
  });

  it("supports audited role-specific grant, deny, and clear overrides", () => {
    const { database, repository } = setup();
    let evaluation = repository.setRoleOverride(
      ids.user,
      "hoodyoor",
      "GRANT",
      ids.owner,
      "support recovery",
    );
    expect(evaluation.hoodYoorHolder).toBe(true);
    evaluation = repository.setRoleOverride(ids.user, "season1", "DENY", ids.owner, "fraud review");
    expect(evaluation.season1Holder).toBe(false);
    evaluation = repository.clearRoleOverride(ids.user, "season1", ids.owner, "review complete");
    expect(evaluation.season1Holder).toBe(true);
    const events = database
      .prepare("SELECT event_type FROM audit_events WHERE event_type LIKE 'HOLDER_OVERRIDE%'")
      .all() as Array<{ event_type: string }>;
    expect(events.map((event) => event.event_type)).toContain("HOLDER_OVERRIDE_CLEARED");
  });

  it("migrates the multi-collection schema once", () => {
    const { database } = setup();
    const versions = database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
  });
});
