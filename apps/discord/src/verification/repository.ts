import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../database/database.js";
import { transitionOnboarding, type OnboardingState } from "../onboarding/state.js";
import type { EntitlementRead } from "../blockchain/contract.js";
import type { HolderRoleKey } from "../discord/model.js";

export type VerificationSessionStatus =
  "CREATED" | "PREPARED" | "VERIFIED" | "REJECTED" | "EXPIRED" | "CANCELLED";

export interface VerificationSession {
  sessionId: string;
  discordUserId: string;
  guildId: string;
  walletAddress: string | null;
  nonce: string | null;
  siweMessage: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  status: VerificationSessionStatus;
  failedAttempts: number;
}

interface SessionRow {
  session_id: string;
  discord_user_id: string;
  guild_id: string;
  wallet_address: string | null;
  nonce: string | null;
  siwe_message: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  status: VerificationSessionStatus;
  failed_attempts: number;
}

export interface CreatedVerificationSession {
  sessionId: string;
  token: string;
  expiresAt: string;
}

export interface WalletRecord {
  walletAddress: string;
  discordUserId: string;
  lastOwnershipCheck: string | null;
  lastConfirmedBalance: string | null;
  ownershipState: "UNKNOWN" | "HOLDER" | "CONFIRMED_ZERO" | "RPC_FAILURE" | "GRACE_PERIOD";
  zeroBalanceSince: string | null;
}

export interface WalletEntitlementRecord {
  walletAddress: string;
  entitlementKey: HolderRoleKey;
  chainId: number;
  status: "UNKNOWN" | "QUALIFIED" | "ZERO_PENDING" | "ZERO_CONFIRMED" | "RPC_ERROR";
  lastCheckedAt: string | null;
  lastConfirmedBalance: string | null;
  lastError: string | null;
  zeroSince: string | null;
  successfulZeroChecks: number;
}

export interface RoleEvaluation {
  dyoorified: true;
  season1Holder: boolean;
  ascended: boolean;
  season2Holder: boolean;
  hoodYoorHolder: boolean;
  rpcUncertain: HolderRoleKey[];
}

const entitlementKeys = ["season1", "ascended", "season2", "hoodyoor"] as const;

const evaluationField: Record<
  HolderRoleKey,
  keyof Omit<RoleEvaluation, "dyoorified" | "rpcUncertain">
> = {
  season1: "season1Holder",
  ascended: "ascended",
  season2: "season2Holder",
  hoodyoor: "hoodYoorHolder",
};

interface WalletRow {
  wallet_address: string;
  discord_user_id: string;
  last_ownership_check: string | null;
  last_confirmed_balance: string | null;
  ownership_state: WalletRecord["ownershipState"];
  zero_balance_since: string | null;
}

export class WalletAlreadyLinkedError extends Error {
  constructor() {
    super("This wallet is already associated with another Discord account.");
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function abbreviateWallet(wallet: string) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function mapSession(row: SessionRow): VerificationSession {
  return {
    sessionId: row.session_id,
    discordUserId: row.discord_user_id,
    guildId: row.guild_id,
    walletAddress: row.wallet_address,
    nonce: row.nonce,
    siweMessage: row.siwe_message,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    status: row.status,
    failedAttempts: row.failed_attempts,
  };
}

function mapWallet(row: WalletRow): WalletRecord {
  return {
    walletAddress: row.wallet_address,
    discordUserId: row.discord_user_id,
    lastOwnershipCheck: row.last_ownership_check,
    lastConfirmedBalance: row.last_confirmed_balance,
    ownershipState: row.ownership_state,
    zeroBalanceSince: row.zero_balance_since,
  };
}

export class VerificationRepository {
  constructor(
    private readonly database: DatabaseConnection,
    private readonly now: () => Date = () => new Date(),
  ) {}

  ensureUser(discordUserId: string) {
    const now = this.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO discord_users(discord_user_id, created_at, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(discord_user_id) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(discordUserId, now, now);
  }

  setOnboardingState(discordUserId: string, next: OnboardingState) {
    this.ensureUser(discordUserId);
    const row = this.database
      .prepare("SELECT onboarding_state FROM discord_users WHERE discord_user_id = ?")
      .get(discordUserId) as { onboarding_state: OnboardingState };
    const state = transitionOnboarding(row.onboarding_state, next);
    this.database
      .prepare(
        "UPDATE discord_users SET onboarding_state = ?, updated_at = ? WHERE discord_user_id = ?",
      )
      .run(state, this.now().toISOString(), discordUserId);
    return state;
  }

  getOnboardingState(discordUserId: string): OnboardingState {
    this.ensureUser(discordUserId);
    const row = this.database
      .prepare("SELECT onboarding_state FROM discord_users WHERE discord_user_id = ?")
      .get(discordUserId) as { onboarding_state: OnboardingState };
    return row.onboarding_state;
  }

  createSession(discordUserId: string, guildId: string, ttlMs = 10 * 60 * 1000) {
    this.ensureUser(discordUserId);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + ttlMs);
    const token = randomBytes(32).toString("base64url");
    const sessionId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO verification_sessions(
          session_id, token_hash, discord_user_id, guild_id, created_at, expires_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'CREATED')`,
      )
      .run(
        sessionId,
        hashToken(token),
        discordUserId,
        guildId,
        createdAt.toISOString(),
        expiresAt.toISOString(),
      );
    return {
      sessionId,
      token,
      expiresAt: expiresAt.toISOString(),
    } satisfies CreatedVerificationSession;
  }

  getByToken(token: string): VerificationSession | null {
    const row = this.database
      .prepare("SELECT * FROM verification_sessions WHERE token_hash = ?")
      .get(hashToken(token)) as SessionRow | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= this.now().getTime() && !row.consumed_at) {
      this.database
        .prepare("UPDATE verification_sessions SET status = 'EXPIRED' WHERE session_id = ?")
        .run(row.session_id);
      row.status = "EXPIRED";
    }
    return mapSession(row);
  }

  prepareSession(token: string, walletAddress: string, nonce: string, siweMessage: string) {
    const session = this.getByToken(token);
    if (!session || session.status === "EXPIRED")
      throw new Error("Verification link is invalid or expired.");
    if (session.status === "PREPARED") {
      if (session.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error("This verification session is already bound to another wallet.");
      }
      return session;
    }
    if (session.status !== "CREATED" || session.consumedAt) {
      throw new Error("Verification session has already been used.");
    }
    this.database
      .prepare(
        `UPDATE verification_sessions
         SET wallet_address = ?, nonce = ?, siwe_message = ?, status = 'PREPARED'
         WHERE session_id = ? AND status = 'CREATED' AND consumed_at IS NULL`,
      )
      .run(walletAddress, nonce, siweMessage, session.sessionId);
    const prepared = this.getByToken(token);
    if (!prepared) throw new Error("Verification session could not be prepared.");
    return prepared;
  }

  recordFailedSignature(token: string) {
    const session = this.getByToken(token);
    if (!session || session.status !== "PREPARED") return;
    const attempts = session.failedAttempts + 1;
    const rejected = attempts >= 5;
    this.database
      .prepare(
        `UPDATE verification_sessions
         SET failed_attempts = ?, status = ?, consumed_at = ?
         WHERE session_id = ? AND status = 'PREPARED'`,
      )
      .run(
        attempts,
        rejected ? "REJECTED" : "PREPARED",
        rejected ? this.now().toISOString() : null,
        session.sessionId,
      );
    this.recordAudit("VERIFICATION_FAILED", session.discordUserId, session.walletAddress, {
      reason: "invalid_signature",
      failedAttempts: attempts,
      sessionRejected: rejected,
    });
  }

  rejectNoOwnership(token: string) {
    const session = this.getByToken(token);
    const now = this.now().toISOString();
    const update = this.database
      .prepare(
        `UPDATE verification_sessions
         SET status = 'REJECTED', consumed_at = ?
         WHERE token_hash = ? AND status = 'PREPARED'`,
      )
      .run(now, hashToken(token));
    if (session && update.changes === 1) {
      this.recordAudit("VERIFICATION_FAILED", session.discordUserId, session.walletAddress, {
        reason: "confirmed_zero_balance",
      });
    }
  }

  recordSessionAudit(token: string, eventType: string, detail: Record<string, unknown>) {
    const session = this.getByToken(token);
    if (!session) return;
    this.recordAudit(eventType, session.discordUserId, session.walletAddress, detail);
  }

  cancelSession(token: string) {
    this.database
      .prepare(
        `UPDATE verification_sessions
         SET status = 'CANCELLED', consumed_at = ?
         WHERE token_hash = ? AND status IN ('CREATED','PREPARED') AND consumed_at IS NULL`,
      )
      .run(this.now().toISOString(), hashToken(token));
  }

  linkWalletAndComplete(
    token: string,
    walletAddress: string,
    reads: Partial<Record<HolderRoleKey, EntitlementRead>> = {},
    chainIds: Partial<Record<HolderRoleKey, number>> = {},
    gracePeriodMs = 24 * 60 * 60 * 1000,
  ) {
    const complete = this.database.transaction(() => {
      const session = this.getByToken(token);
      if (!session || session.status !== "PREPARED" || session.consumedAt) {
        throw new Error("Verification session is invalid, expired, or already used.");
      }
      const existing = this.database
        .prepare(
          "SELECT discord_user_id FROM verified_wallets WHERE wallet_address = ? COLLATE NOCASE",
        )
        .get(walletAddress) as { discord_user_id: string } | undefined;
      if (existing && existing.discord_user_id !== session.discordUserId) {
        throw new WalletAlreadyLinkedError();
      }
      const now = this.now().toISOString();
      this.ensureUser(session.discordUserId);
      const walletCount = this.database
        .prepare("SELECT COUNT(*) AS count FROM verified_wallets WHERE discord_user_id = ?")
        .get(session.discordUserId) as { count: number };
      this.database
        .prepare(
          `INSERT INTO verified_wallets(
            wallet_address, discord_user_id, is_primary, verified_at,
            last_ownership_check, last_confirmed_balance, ownership_state, zero_balance_since
          ) VALUES (?, ?, ?, ?, NULL, NULL, 'UNKNOWN', NULL)
          ON CONFLICT(wallet_address) DO UPDATE SET
            discord_user_id = excluded.discord_user_id`,
        )
        .run(walletAddress, session.discordUserId, walletCount.count === 0 ? 1 : 0, now);
      for (const key of entitlementKeys) {
        const read = reads[key];
        if (read)
          this.storeEntitlementRead(walletAddress, key, chainIds[key] ?? 0, read, gracePeriodMs);
      }
      const evaluation = this.evaluateUserRoles(session.discordUserId);
      const anyHolder =
        evaluation.season1Holder ||
        evaluation.ascended ||
        evaluation.season2Holder ||
        evaluation.hoodYoorHolder;
      this.database
        .prepare(
          `UPDATE discord_users SET onboarding_state = ?, holder_status = ?, updated_at = ?
           WHERE discord_user_id = ?`,
        )
        .run(
          anyHolder ? "HOLDER" : "VISITOR",
          anyHolder ? "ACTIVE" : "UNVERIFIED",
          now,
          session.discordUserId,
        );
      const update = this.database
        .prepare(
          `UPDATE verification_sessions
           SET status = 'VERIFIED', consumed_at = ?
           WHERE session_id = ? AND status = 'PREPARED' AND consumed_at IS NULL`,
        )
        .run(now, session.sessionId);
      if (update.changes !== 1) throw new Error("Verification session replay was rejected.");
      this.database
        .prepare(
          `INSERT INTO audit_events(
            event_id, event_type, discord_user_id, wallet_address_abbreviated, detail_json, created_at
          ) VALUES (?, 'WALLET_LINKED', ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          session.discordUserId,
          abbreviateWallet(walletAddress),
          JSON.stringify({ entitlements: evaluation }),
          now,
        );
      this.recordAudit("SYNC_SUCCESS", session.discordUserId, walletAddress, { evaluation });
      return { discordUserId: session.discordUserId, walletAddress, evaluation };
    });
    return complete();
  }

  getUserWallets(discordUserId: string) {
    return this.database
      .prepare(
        `SELECT wallet_address, is_primary, verified_at, last_ownership_check,
                last_confirmed_balance, ownership_state, zero_balance_since
         FROM verified_wallets WHERE discord_user_id = ? ORDER BY is_primary DESC, verified_at`,
      )
      .all(discordUserId) as Array<{
      wallet_address: string;
      is_primary: 0 | 1;
      verified_at: string;
      last_ownership_check: string | null;
      last_confirmed_balance: string | null;
      ownership_state: string;
      zero_balance_since: string | null;
    }>;
  }

  getWalletEntitlements(discordUserId: string): WalletEntitlementRecord[] {
    const rows = this.database
      .prepare(
        `SELECT e.wallet_address, e.entitlement_key, e.chain_id, e.status,
                e.last_checked_at, e.last_confirmed_balance, e.last_error,
                e.zero_since, e.successful_zero_checks
         FROM wallet_entitlements e
         JOIN verified_wallets w ON w.wallet_address = e.wallet_address
         WHERE w.discord_user_id = ?
         ORDER BY e.wallet_address, e.entitlement_key`,
      )
      .all(discordUserId) as Array<{
      wallet_address: string;
      entitlement_key: HolderRoleKey;
      chain_id: number;
      status: WalletEntitlementRecord["status"];
      last_checked_at: string | null;
      last_confirmed_balance: string | null;
      last_error: string | null;
      zero_since: string | null;
      successful_zero_checks: number;
    }>;
    return rows.map((row) => ({
      walletAddress: row.wallet_address,
      entitlementKey: row.entitlement_key,
      chainId: row.chain_id,
      status: row.status,
      lastCheckedAt: row.last_checked_at,
      lastConfirmedBalance: row.last_confirmed_balance,
      lastError: row.last_error,
      zeroSince: row.zero_since,
      successfulZeroChecks: row.successful_zero_checks,
    }));
  }

  private storeEntitlementRead(
    walletAddress: string,
    key: HolderRoleKey,
    chainId: number,
    read: EntitlementRead,
    gracePeriodMs: number,
  ): WalletEntitlementRecord {
    const existing = this.database
      .prepare(
        `SELECT wallet_address, entitlement_key, chain_id, status, last_checked_at,
                last_confirmed_balance, last_error, zero_since, successful_zero_checks
         FROM wallet_entitlements
         WHERE wallet_address = ? COLLATE NOCASE AND entitlement_key = ?`,
      )
      .get(walletAddress, key) as
      | {
          wallet_address: string;
          entitlement_key: HolderRoleKey;
          chain_id: number;
          status: WalletEntitlementRecord["status"];
          last_checked_at: string | null;
          last_confirmed_balance: string | null;
          last_error: string | null;
          zero_since: string | null;
          successful_zero_checks: number;
        }
      | undefined;
    const nowDate = this.now();
    const now = nowDate.toISOString();
    let status: WalletEntitlementRecord["status"];
    let balance = existing?.last_confirmed_balance ?? null;
    let lastError: string | null = null;
    let zeroSince = existing?.zero_since ?? null;
    let zeroChecks = existing?.successful_zero_checks ?? 0;

    if (read.status === "QUALIFIED") {
      status = "QUALIFIED";
      balance = read.balance.toString();
      zeroSince = null;
      zeroChecks = 0;
    } else if (read.status === "RPC_ERROR") {
      status = "RPC_ERROR";
      lastError = read.error.slice(0, 240);
    } else {
      const wasQualified = BigInt(existing?.last_confirmed_balance ?? "0") > 0n;
      if (!wasQualified) {
        status = "ZERO_CONFIRMED";
        balance = "0";
        zeroSince = existing?.zero_since ?? now;
        zeroChecks = Math.max(1, zeroChecks + 1);
      } else {
        const since = existing?.zero_since ? new Date(existing.zero_since) : nowDate;
        zeroSince = since.toISOString();
        zeroChecks += 1;
        const elapsed = nowDate.getTime() - since.getTime() >= gracePeriodMs;
        status = elapsed && zeroChecks >= 2 ? "ZERO_CONFIRMED" : "ZERO_PENDING";
        if (status === "ZERO_CONFIRMED") balance = "0";
      }
    }

    this.database
      .prepare(
        `INSERT INTO wallet_entitlements(
          wallet_address, entitlement_key, chain_id, status, last_checked_at,
          last_confirmed_balance, last_error, zero_since, successful_zero_checks, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(wallet_address, entitlement_key) DO UPDATE SET
          chain_id = excluded.chain_id,
          status = excluded.status,
          last_checked_at = excluded.last_checked_at,
          last_confirmed_balance = excluded.last_confirmed_balance,
          last_error = excluded.last_error,
          zero_since = excluded.zero_since,
          successful_zero_checks = excluded.successful_zero_checks,
          updated_at = excluded.updated_at`,
      )
      .run(
        walletAddress,
        key,
        chainId,
        status,
        now,
        balance,
        lastError,
        zeroSince,
        zeroChecks,
        now,
      );
    if (read.status === "RPC_ERROR") {
      this.recordAudit("RPC_ERROR", null, walletAddress, { key, message: lastError });
    }
    return {
      walletAddress,
      entitlementKey: key,
      chainId,
      status,
      lastCheckedAt: now,
      lastConfirmedBalance: balance,
      lastError,
      zeroSince,
      successfulZeroChecks: zeroChecks,
    };
  }

  recordEntitlementRead(
    walletAddress: string,
    key: HolderRoleKey,
    chainId: number,
    read: EntitlementRead,
    gracePeriodMs: number,
  ) {
    const linked = this.database
      .prepare(
        "SELECT discord_user_id FROM verified_wallets WHERE wallet_address = ? COLLATE NOCASE",
      )
      .get(walletAddress) as { discord_user_id: string } | undefined;
    if (!linked) throw new Error("Wallet is not linked to a Discord user.");
    const result = this.storeEntitlementRead(walletAddress, key, chainId, read, gracePeriodMs);
    this.updateAggregateHolderState(linked.discord_user_id);
    return { discordUserId: linked.discord_user_id, entitlement: result };
  }

  evaluateUserRoles(discordUserId: string): RoleEvaluation {
    const evaluation: RoleEvaluation = {
      dyoorified: true,
      season1Holder: false,
      ascended: false,
      season2Holder: false,
      hoodYoorHolder: false,
      rpcUncertain: [],
    };
    const records = this.getWalletEntitlements(discordUserId);
    const overrides = this.database
      .prepare(`SELECT entitlement_key, decision FROM role_overrides WHERE discord_user_id = ?`)
      .all(discordUserId) as Array<{ entitlement_key: HolderRoleKey; decision: "GRANT" | "DENY" }>;
    for (const key of entitlementKeys) {
      const override = overrides.find((candidate) => candidate.entitlement_key === key);
      const relevant = records.filter((record) => record.entitlementKey === key);
      const uncertain = !override && relevant.some((record) => record.status === "RPC_ERROR");
      const qualified = relevant.some(
        (record) =>
          record.status === "QUALIFIED" ||
          record.status === "ZERO_PENDING" ||
          (record.status === "RPC_ERROR" && BigInt(record.lastConfirmedBalance ?? "0") > 0n),
      );
      evaluation[evaluationField[key]] =
        override?.decision === "GRANT" ? true : override?.decision === "DENY" ? false : qualified;
      if (uncertain) evaluation.rpcUncertain.push(key);
    }
    return evaluation;
  }

  private updateAggregateHolderState(discordUserId: string) {
    const evaluation = this.evaluateUserRoles(discordUserId);
    const any =
      evaluation.season1Holder ||
      evaluation.ascended ||
      evaluation.season2Holder ||
      evaluation.hoodYoorHolder;
    const now = this.now().toISOString();
    this.database
      .prepare(
        `UPDATE discord_users SET onboarding_state = ?, holder_status = ?, updated_at = ?
         WHERE discord_user_id = ?`,
      )
      .run(any ? "HOLDER" : "VISITOR", any ? "ACTIVE" : "INACTIVE", now, discordUserId);
    return evaluation;
  }

  listWalletAddressesDue(cutoff: Date): Array<{ walletAddress: string; discordUserId: string }> {
    return this.database
      .prepare(
        `SELECT w.wallet_address, w.discord_user_id
         FROM verified_wallets w
         LEFT JOIN wallet_entitlements e ON e.wallet_address = w.wallet_address
         GROUP BY w.wallet_address, w.discord_user_id
         HAVING MIN(e.last_checked_at) IS NULL OR MIN(e.last_checked_at) <= ?
         ORDER BY COALESCE(MIN(e.last_checked_at), '')`,
      )
      .all(cutoff.toISOString())
      .map((row) => {
        const value = row as { wallet_address: string; discord_user_id: string };
        return { walletAddress: value.wallet_address, discordUserId: value.discord_user_id };
      });
  }

  setRoleOverride(
    targetUserId: string,
    key: HolderRoleKey,
    decision: "GRANT" | "DENY",
    actingAdminUserId: string,
    reason: string,
  ) {
    this.ensureUser(targetUserId);
    const now = this.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO role_overrides(
          discord_user_id, entitlement_key, decision, acting_admin_user_id,
          reason, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(discord_user_id, entitlement_key) DO UPDATE SET
          decision = excluded.decision,
          acting_admin_user_id = excluded.acting_admin_user_id,
          reason = excluded.reason,
          updated_at = excluded.updated_at`,
      )
      .run(targetUserId, key, decision, actingAdminUserId, reason, now, now);
    this.recordAudit("HOLDER_OVERRIDE", targetUserId, null, {
      key,
      decision,
      actingAdminUserId,
      reason,
    });
    return this.updateAggregateHolderState(targetUserId);
  }

  clearRoleOverride(
    targetUserId: string,
    key: HolderRoleKey,
    actingAdminUserId: string,
    reason: string,
  ) {
    this.database
      .prepare("DELETE FROM role_overrides WHERE discord_user_id = ? AND entitlement_key = ?")
      .run(targetUserId, key);
    this.recordAudit("HOLDER_OVERRIDE_CLEARED", targetUserId, null, {
      key,
      actingAdminUserId,
      reason,
    });
    return this.updateAggregateHolderState(targetUserId);
  }

  recordRoleSync(discordUserId: string, evaluation: RoleEvaluation, error: string | null = null) {
    this.ensureUser(discordUserId);
    const now = this.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO role_sync_state(
          discord_user_id, dyoorified, season1_holder, ascended,
          season2_holder, hoodyoor_holder, last_synced_at, last_sync_error, updated_at
         ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(discord_user_id) DO UPDATE SET
          dyoorified = 1,
          season1_holder = excluded.season1_holder,
          ascended = excluded.ascended,
          season2_holder = excluded.season2_holder,
          hoodyoor_holder = excluded.hoodyoor_holder,
          last_synced_at = excluded.last_synced_at,
          last_sync_error = excluded.last_sync_error,
          updated_at = excluded.updated_at`,
      )
      .run(
        discordUserId,
        Number(evaluation.season1Holder),
        Number(evaluation.ascended),
        Number(evaluation.season2Holder),
        Number(evaluation.hoodYoorHolder),
        error ? null : now,
        error,
        now,
      );
    this.recordAudit(error ? "SYNC_FAILURE" : "SYNC_SUCCESS", discordUserId, null, {
      evaluation,
      ...(error ? { error: error.slice(0, 240) } : {}),
    });
  }

  getUserProfile(discordUserId: string) {
    const user = this.database
      .prepare(
        `SELECT discord_user_id, onboarding_state, holder_status, created_at, updated_at
         FROM discord_users WHERE discord_user_id = ?`,
      )
      .get(discordUserId) as
      | {
          discord_user_id: string;
          onboarding_state: OnboardingState;
          holder_status: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    return user
      ? {
          ...user,
          wallets: this.getUserWallets(discordUserId),
          entitlements: this.getWalletEntitlements(discordUserId),
          evaluation: this.evaluateUserRoles(discordUserId),
        }
      : null;
  }

  setManualHolderOverride(
    targetUserId: string,
    holder: boolean,
    actingAdminUserId: string,
    reason: string,
  ) {
    const apply = this.database.transaction(() => {
      this.ensureUser(targetUserId);
      const now = this.now().toISOString();
      this.database
        .prepare(
          `UPDATE discord_users SET onboarding_state = ?, holder_status = ?, updated_at = ?
           WHERE discord_user_id = ?`,
        )
        .run(
          holder ? "HOLDER" : "VISITOR",
          holder ? "MANUAL_OVERRIDE" : "INACTIVE",
          now,
          targetUserId,
        );
      this.database
        .prepare(
          `INSERT INTO manual_overrides(
            override_id, target_user_id, acting_admin_user_id, action, reason, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          targetUserId,
          actingAdminUserId,
          holder ? "HOLDER_GRANTED" : "HOLDER_REVOKED",
          reason,
          now,
        );
      this.recordAudit(holder ? "HOLDER_ROLE_GRANTED" : "HOLDER_ROLE_REMOVED", targetUserId, null, {
        actingAdminUserId,
        manualOverride: true,
        reason,
      });
    });
    apply();
  }

  listWalletsDue(cutoff: Date): WalletRecord[] {
    return (
      this.database
        .prepare(
          `SELECT wallet_address, discord_user_id, last_ownership_check,
                  last_confirmed_balance, ownership_state, zero_balance_since
           FROM verified_wallets
           WHERE last_ownership_check IS NULL OR last_ownership_check <= ?
           ORDER BY COALESCE(last_ownership_check, '')`,
        )
        .all(cutoff.toISOString()) as WalletRow[]
    ).map(mapWallet);
  }

  recordSuccessfulOwnershipCheck(walletAddress: string, balance: bigint, gracePeriodMs: number) {
    const update = this.database.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT wallet_address, discord_user_id, last_ownership_check,
                  last_confirmed_balance, ownership_state, zero_balance_since
           FROM verified_wallets WHERE wallet_address = ? COLLATE NOCASE`,
        )
        .get(walletAddress) as WalletRow | undefined;
      if (!row) throw new Error("Wallet is not linked to a Discord user.");
      const nowDate = this.now();
      const now = nowDate.toISOString();

      if (balance > 0n) {
        this.database
          .prepare(
            `UPDATE verified_wallets SET
              last_ownership_check = ?, last_confirmed_balance = ?,
              ownership_state = 'HOLDER', zero_balance_since = NULL
             WHERE wallet_address = ? COLLATE NOCASE`,
          )
          .run(now, balance.toString(), walletAddress);
        this.database
          .prepare(
            `UPDATE discord_users SET onboarding_state = 'HOLDER', holder_status = 'ACTIVE', updated_at = ?
             WHERE discord_user_id = ?`,
          )
          .run(now, row.discord_user_id);
        this.recordAudit("HOLDER_RECHECKED", row.discord_user_id, walletAddress, {
          balance: balance.toString(),
        });
        return {
          discordUserId: row.discord_user_id,
          removeHolderRole: false,
          state: "HOLDER" as const,
        };
      }

      const zeroSince = row.zero_balance_since ? new Date(row.zero_balance_since) : nowDate;
      const graceElapsed = row.zero_balance_since
        ? nowDate.getTime() - zeroSince.getTime() >= gracePeriodMs
        : false;
      this.database
        .prepare(
          `UPDATE verified_wallets SET
            last_ownership_check = ?, last_confirmed_balance = '0', ownership_state = ?,
            zero_balance_since = COALESCE(zero_balance_since, ?)
           WHERE wallet_address = ? COLLATE NOCASE`,
        )
        .run(now, graceElapsed ? "CONFIRMED_ZERO" : "GRACE_PERIOD", now, walletAddress);

      const anotherHoldingWallet = this.database
        .prepare(
          `SELECT 1 FROM verified_wallets
           WHERE discord_user_id = ? AND wallet_address != ? COLLATE NOCASE
             AND (
               ownership_state = 'HOLDER'
               OR (ownership_state IN ('RPC_FAILURE','GRACE_PERIOD') AND CAST(COALESCE(last_confirmed_balance,'0') AS INTEGER) > 0)
             )
           LIMIT 1`,
        )
        .get(row.discord_user_id, walletAddress);
      const removeHolderRole = graceElapsed && !anotherHoldingWallet;
      this.database
        .prepare(
          `UPDATE discord_users SET onboarding_state = ?, holder_status = ?, updated_at = ?
           WHERE discord_user_id = ?`,
        )
        .run(
          removeHolderRole ? "VISITOR" : "HOLDER",
          removeHolderRole ? "INACTIVE" : "GRACE_PERIOD",
          now,
          row.discord_user_id,
        );
      this.recordAudit(
        removeHolderRole ? "HOLDER_ROLE_REMOVED" : "HOLDER_RECHECKED",
        row.discord_user_id,
        walletAddress,
        { balance: "0", graceElapsed },
      );
      return {
        discordUserId: row.discord_user_id,
        removeHolderRole,
        state: removeHolderRole ? ("INACTIVE" as const) : ("GRACE_PERIOD" as const),
      };
    });
    return update();
  }

  recordRpcFailure(walletAddress: string, message = "provider unavailable") {
    const row = this.database
      .prepare(
        "SELECT discord_user_id FROM verified_wallets WHERE wallet_address = ? COLLATE NOCASE",
      )
      .get(walletAddress) as { discord_user_id: string } | undefined;
    if (!row) return;
    this.database
      .prepare(
        `UPDATE verified_wallets SET ownership_state = 'RPC_FAILURE'
         WHERE wallet_address = ? COLLATE NOCASE`,
      )
      .run(walletAddress);
    this.recordAudit("RPC_ERROR", row.discord_user_id, walletAddress, { message });
  }

  unlinkWallet(walletAddress: string, actingAdminUserId: string, reason: string | null) {
    const unlink = this.database.transaction(() => {
      const row = this.database
        .prepare(
          "SELECT discord_user_id FROM verified_wallets WHERE wallet_address = ? COLLATE NOCASE",
        )
        .get(walletAddress) as { discord_user_id: string } | undefined;
      if (!row) return null;
      this.database
        .prepare("DELETE FROM verified_wallets WHERE wallet_address = ? COLLATE NOCASE")
        .run(walletAddress);
      const now = this.now().toISOString();
      this.database
        .prepare(
          `INSERT INTO manual_overrides(
            override_id, target_user_id, acting_admin_user_id, action, reason, created_at
          ) VALUES (?, ?, ?, 'WALLET_UNLINKED', ?, ?)`,
        )
        .run(randomUUID(), row.discord_user_id, actingAdminUserId, reason, now);
      this.recordAudit("WALLET_UNLINKED", row.discord_user_id, walletAddress, {
        actingAdminUserId,
        reason,
      });
      this.updateAggregateHolderState(row.discord_user_id);
      return row.discord_user_id;
    });
    return unlink();
  }

  recordAudit(
    eventType: string,
    discordUserId: string | null,
    walletAddress: string | null,
    detail: Record<string, unknown>,
  ) {
    this.database
      .prepare(
        `INSERT INTO audit_events(
          event_id, event_type, discord_user_id, wallet_address_abbreviated, detail_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        eventType,
        discordUserId,
        walletAddress ? abbreviateWallet(walletAddress) : null,
        JSON.stringify(detail),
        this.now().toISOString(),
      );
  }
}
