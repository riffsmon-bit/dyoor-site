export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial_security_and_holder_schema",
    sql: `
      CREATE TABLE discord_users (
        discord_user_id TEXT PRIMARY KEY,
        onboarding_state TEXT NOT NULL DEFAULT 'NEW'
          CHECK (onboarding_state IN ('NEW','SCREENING_COMPLETE','VISITOR','HOLDER','FLAGGED')),
        holder_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
          CHECK (holder_status IN ('UNVERIFIED','ACTIVE','GRACE_PERIOD','INACTIVE','MANUAL_OVERRIDE')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE verified_wallets (
        wallet_address TEXT PRIMARY KEY COLLATE NOCASE,
        discord_user_id TEXT NOT NULL REFERENCES discord_users(discord_user_id) ON DELETE CASCADE,
        is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
        verified_at TEXT NOT NULL,
        last_ownership_check TEXT,
        last_confirmed_balance TEXT,
        ownership_state TEXT NOT NULL DEFAULT 'UNKNOWN'
          CHECK (ownership_state IN ('UNKNOWN','HOLDER','CONFIRMED_ZERO','RPC_FAILURE','GRACE_PERIOD')),
        zero_balance_since TEXT,
        UNIQUE(discord_user_id, wallet_address)
      );

      CREATE INDEX verified_wallets_discord_user_idx
        ON verified_wallets(discord_user_id);

      CREATE TABLE verification_sessions (
        session_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        discord_user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        wallet_address TEXT COLLATE NOCASE,
        nonce TEXT,
        siwe_message TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        status TEXT NOT NULL DEFAULT 'CREATED'
          CHECK (status IN ('CREATED','PREPARED','VERIFIED','REJECTED','EXPIRED','CANCELLED'))
      );

      CREATE INDEX verification_sessions_expiry_idx
        ON verification_sessions(expires_at, status);

      CREATE TABLE warnings (
        warning_id TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        moderator_user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
      );

      CREATE TABLE tickets (
        ticket_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL UNIQUE,
        creator_user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        claimed_by_user_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('OPEN','CLAIMED','CLOSED')),
        created_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE TABLE managed_messages (
        message_key TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE manual_overrides (
        override_id TEXT PRIMARY KEY,
        target_user_id TEXT NOT NULL,
        acting_admin_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE audit_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        discord_user_id TEXT,
        wallet_address_abbreviated TEXT,
        actor_user_id TEXT,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX audit_events_type_time_idx ON audit_events(event_type, created_at);

      CREATE TABLE server_state (
        state_key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "verification_attempt_limits",
    sql: `
      ALTER TABLE verification_sessions
        ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 3,
    name: "managed_message_content_hash",
    sql: `
      ALTER TABLE managed_messages ADD COLUMN content_hash TEXT;
    `,
  },
  {
    version: 4,
    name: "dyoor_multi_collection_entitlements_and_sales",
    sql: `
      CREATE TABLE wallet_entitlements (
        wallet_address TEXT NOT NULL COLLATE NOCASE
          REFERENCES verified_wallets(wallet_address) ON DELETE CASCADE,
        entitlement_key TEXT NOT NULL
          CHECK (entitlement_key IN ('season1','ascended','season2','hoodyoor')),
        chain_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'UNKNOWN'
          CHECK (status IN ('UNKNOWN','QUALIFIED','ZERO_PENDING','ZERO_CONFIRMED','RPC_ERROR')),
        last_checked_at TEXT,
        last_confirmed_balance TEXT,
        last_error TEXT,
        zero_since TEXT,
        successful_zero_checks INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(wallet_address, entitlement_key)
      );

      CREATE INDEX wallet_entitlements_status_idx
        ON wallet_entitlements(entitlement_key, status, last_checked_at);

      CREATE TABLE role_overrides (
        discord_user_id TEXT NOT NULL
          REFERENCES discord_users(discord_user_id) ON DELETE CASCADE,
        entitlement_key TEXT NOT NULL
          CHECK (entitlement_key IN ('season1','ascended','season2','hoodyoor')),
        decision TEXT NOT NULL CHECK (decision IN ('GRANT','DENY')),
        acting_admin_user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(discord_user_id, entitlement_key)
      );

      CREATE TABLE role_sync_state (
        discord_user_id TEXT PRIMARY KEY
          REFERENCES discord_users(discord_user_id) ON DELETE CASCADE,
        dyoorified INTEGER NOT NULL DEFAULT 1 CHECK (dyoorified IN (0,1)),
        season1_holder INTEGER NOT NULL DEFAULT 0 CHECK (season1_holder IN (0,1)),
        ascended INTEGER NOT NULL DEFAULT 0 CHECK (ascended IN (0,1)),
        season2_holder INTEGER NOT NULL DEFAULT 0 CHECK (season2_holder IN (0,1)),
        hoodyoor_holder INTEGER NOT NULL DEFAULT 0 CHECK (hoodyoor_holder IN (0,1)),
        last_synced_at TEXT,
        last_sync_error TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sales_events (
        event_id TEXT PRIMARY KEY,
        chain_id INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL COLLATE NOCASE,
        log_index INTEGER NOT NULL,
        contract_address TEXT NOT NULL COLLATE NOCASE,
        token_id TEXT NOT NULL,
        collection_key TEXT NOT NULL CHECK (collection_key IN ('season1','season2')),
        discord_message_id TEXT,
        detail_json TEXT NOT NULL DEFAULT '{}',
        detected_at TEXT NOT NULL,
        posted_at TEXT,
        UNIQUE(chain_id, transaction_hash, log_index, contract_address)
      );

      CREATE INDEX sales_events_detected_idx ON sales_events(detected_at);
    `,
  },
];
