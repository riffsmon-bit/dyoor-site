import { createHash } from "node:crypto";
import type { CompactTransferLog } from "./chain";
import { ZERO_ADDRESS } from "./chain";
import type { NormalizedMetadata } from "./metadata";

export type BlockchainStatus =
  | "surviving_minted"
  | "burned"
  | "unminted"
  | "invalid_or_unavailable";

export type GameRole =
  | "player_character"
  | "burned_echo"
  | "npc_candidate"
  | "unavailable"
  | "companion"
  | "mini_boss"
  | "dungeon_boss"
  | "regional_boss"
  | "faction_leader"
  | "quest_npc"
  | "secret_encounter"
  | "main_antagonist";

export type PublicDroidRegistryRecord = {
  tokenId: number;
  blockchainStatus: BlockchainStatus;
  owner: null;
  gameRole: GameRole;
  rarityScore: number;
  region: string | null;
  recruitable: boolean;
  spriteStatus: "placeholder" | "missing" | "ready";
  traitHash: string | null;
  metadataAvailable: boolean;
  chainScanBlock: number;
};

export function indexTransferEvidence(logs: CompactTransferLog[]) {
  const minted = new Set<number>();
  const latest = new Map<number, CompactTransferLog>();
  for (const log of logs) {
    if (log.from === ZERO_ADDRESS) minted.add(log.tokenId);
    latest.set(log.tokenId, log);
  }
  return { minted, latest };
}

export function classifyTokenEvidence(input: {
  tokenId: number;
  metadataAvailable: boolean;
  minted: boolean;
  latestTransfer?: CompactTransferLog;
  verifiedOwner?: string;
  ownerReadFailed?: boolean;
}): BlockchainStatus {
  if (!input.metadataAvailable) return "invalid_or_unavailable";
  if (!input.minted) return "unminted";
  if (input.latestTransfer?.to === ZERO_ADDRESS) return "burned";
  if (input.ownerReadFailed || !input.verifiedOwner) return "invalid_or_unavailable";
  return "surviving_minted";
}

export function metadataTraitHash(metadata: NormalizedMetadata | undefined) {
  if (!metadata) return null;
  return createHash("sha256").update(metadata.sourceHashInput).digest("hex");
}

export function registryRecord(
  tokenId: number,
  status: BlockchainStatus,
  blockNumber: number,
  metadata: NormalizedMetadata | undefined,
): PublicDroidRegistryRecord {
  const role = {
    surviving_minted: "player_character",
    burned: "burned_echo",
    unminted: "npc_candidate",
    invalid_or_unavailable: "unavailable",
  } as const;
  return {
    tokenId,
    blockchainStatus: status,
    owner: null,
    gameRole: role[status],
    rarityScore: 0,
    region: null,
    recruitable: false,
    spriteStatus: metadata ? "placeholder" : "missing",
    traitHash: metadataTraitHash(metadata),
    metadataAvailable: Boolean(metadata),
    chainScanBlock: blockNumber,
  };
}
