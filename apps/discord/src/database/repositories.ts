import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "./database.js";

export class AppRepository {
  constructor(
    private readonly database: DatabaseConnection,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getManagedMessage(key: string) {
    return this.database
      .prepare(
        `SELECT message_key, guild_id, channel_id, message_id, content_hash, updated_at
         FROM managed_messages WHERE message_key = ?`,
      )
      .get(key) as
      | {
          message_key: string;
          guild_id: string;
          channel_id: string;
          message_id: string;
          content_hash: string | null;
          updated_at: string;
        }
      | undefined;
  }

  saveManagedMessage(
    key: string,
    guildId: string,
    channelId: string,
    messageId: string,
    contentHash: string,
  ) {
    this.database
      .prepare(
        `INSERT INTO managed_messages(
          message_key, guild_id, channel_id, message_id, content_hash, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_key) DO UPDATE SET
           guild_id = excluded.guild_id,
           channel_id = excluded.channel_id,
           message_id = excluded.message_id,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`,
      )
      .run(key, guildId, channelId, messageId, contentHash, this.now().toISOString());
  }

  listManagedMessages() {
    return this.database
      .prepare(
        `SELECT message_key, guild_id, channel_id, message_id, content_hash, updated_at
         FROM managed_messages ORDER BY message_key`,
      )
      .all();
  }

  addWarning(discordUserId: string, moderatorUserId: string, reason: string) {
    const warningId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO warnings(
          warning_id, discord_user_id, moderator_user_id, reason, created_at, active
        ) VALUES (?, ?, ?, ?, ?, 1)`,
      )
      .run(warningId, discordUserId, moderatorUserId, reason, this.now().toISOString());
    return warningId;
  }

  listWarnings(discordUserId: string) {
    return this.database
      .prepare(
        `SELECT warning_id, moderator_user_id, reason, created_at
         FROM warnings WHERE discord_user_id = ? AND active = 1 ORDER BY created_at DESC`,
      )
      .all(discordUserId) as Array<{
      warning_id: string;
      moderator_user_id: string;
      reason: string;
      created_at: string;
    }>;
  }

  createTicket(guildId: string, channelId: string, creatorUserId: string, category: string) {
    const ticketId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO tickets(
          ticket_id, guild_id, channel_id, creator_user_id, category, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'OPEN', ?)`,
      )
      .run(ticketId, guildId, channelId, creatorUserId, category, this.now().toISOString());
    return ticketId;
  }

  getOpenTicketForUser(guildId: string, creatorUserId: string) {
    return this.database
      .prepare(
        `SELECT ticket_id, channel_id, category, status FROM tickets
         WHERE guild_id = ? AND creator_user_id = ? AND status IN ('OPEN','CLAIMED')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(guildId, creatorUserId) as
      | { ticket_id: string; channel_id: string; category: string; status: "OPEN" | "CLAIMED" }
      | undefined;
  }

  getTicketByChannel(channelId: string) {
    return this.database.prepare("SELECT * FROM tickets WHERE channel_id = ?").get(channelId) as
      | {
          ticket_id: string;
          guild_id: string;
          channel_id: string;
          creator_user_id: string;
          category: string;
          claimed_by_user_id: string | null;
          status: "OPEN" | "CLAIMED" | "CLOSED";
          created_at: string;
          closed_at: string | null;
        }
      | undefined;
  }

  claimTicket(channelId: string, staffUserId: string) {
    return this.database
      .prepare(
        `UPDATE tickets SET claimed_by_user_id = ?, status = 'CLAIMED'
         WHERE channel_id = ? AND status = 'OPEN'`,
      )
      .run(staffUserId, channelId).changes;
  }

  closeTicket(channelId: string) {
    return this.database
      .prepare(
        `UPDATE tickets SET status = 'CLOSED', closed_at = ?
         WHERE channel_id = ? AND status != 'CLOSED'`,
      )
      .run(this.now().toISOString(), channelId).changes;
  }

  getServerState<T>(key: string): T | null {
    const row = this.database
      .prepare("SELECT value_json FROM server_state WHERE state_key = ?")
      .get(key) as { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as T) : null;
  }

  setServerState(key: string, value: unknown) {
    this.database
      .prepare(
        `INSERT INTO server_state(state_key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), this.now().toISOString());
  }

  holderStats() {
    const users = this.database.prepare("SELECT COUNT(*) AS count FROM discord_users").get() as {
      count: number;
    };
    const wallets = this.database
      .prepare("SELECT COUNT(*) AS count FROM verified_wallets")
      .get() as { count: number };
    const holders = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM discord_users WHERE holder_status IN ('ACTIVE','MANUAL_OVERRIDE')",
      )
      .get() as { count: number };
    const recent = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM verification_sessions
         WHERE status = 'VERIFIED' AND consumed_at >= datetime('now', '-24 hours')`,
      )
      .get() as { count: number };
    return {
      discordRecords: users.count,
      verifiedWallets: wallets.count,
      currentVerifiedHolders: holders.count,
      successfulVerificationsLast24Hours: recent.count,
    };
  }
}
