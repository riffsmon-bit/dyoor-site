import { createHash } from "node:crypto";
import type { DatabaseConnection } from "../database/database.js";
import type { SalesCollectionDefinition } from "../discord/model.js";

export interface ValidatedSale {
  chainId: number;
  transactionHash: `0x${string}`;
  logIndex: number;
  contractAddress: `0x${string}`;
  tokenId: string;
  collectionKey: SalesCollectionDefinition["key"];
  detail: Record<string, unknown>;
}

export type SaleRegistration = {
  eventId: string;
  status: "NEW" | "PENDING" | "POSTED";
  discordMessageId: string | null;
};

function eventIdFor(sale: ValidatedSale) {
  return createHash("sha256")
    .update(
      `${sale.chainId}:${sale.transactionHash.toLowerCase()}:${sale.logIndex}:${sale.contractAddress.toLowerCase()}`,
    )
    .digest("hex");
}

export class SalesRepository {
  constructor(
    private readonly database: DatabaseConnection,
    private readonly now: () => Date = () => new Date(),
  ) {}

  register(sale: ValidatedSale): SaleRegistration {
    const existing = this.database
      .prepare(
        `SELECT event_id, discord_message_id, posted_at FROM sales_events
         WHERE chain_id = ? AND transaction_hash = ? COLLATE NOCASE
           AND log_index = ? AND contract_address = ? COLLATE NOCASE`,
      )
      .get(sale.chainId, sale.transactionHash, sale.logIndex, sale.contractAddress) as
      { event_id: string; discord_message_id: string | null; posted_at: string | null } | undefined;
    if (existing) {
      return {
        eventId: existing.event_id,
        status: existing.posted_at ? "POSTED" : "PENDING",
        discordMessageId: existing.discord_message_id,
      };
    }
    const eventId = eventIdFor(sale);
    this.database
      .prepare(
        `INSERT INTO sales_events(
          event_id, chain_id, transaction_hash, log_index, contract_address,
          token_id, collection_key, detail_json, detected_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        sale.chainId,
        sale.transactionHash,
        sale.logIndex,
        sale.contractAddress,
        sale.tokenId,
        sale.collectionKey,
        JSON.stringify(sale.detail),
        this.now().toISOString(),
      );
    return { eventId, status: "NEW", discordMessageId: null };
  }

  markPosted(eventId: string, discordMessageId: string) {
    const update = this.database
      .prepare(
        `UPDATE sales_events SET discord_message_id = ?, posted_at = ?
         WHERE event_id = ? AND posted_at IS NULL`,
      )
      .run(discordMessageId, this.now().toISOString(), eventId);
    return update.changes === 1;
  }

  countPosted() {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM sales_events WHERE posted_at IS NOT NULL")
      .get() as { count: number };
    return row.count;
  }
}
