import { describe, expect, it } from "vitest";
import {
  classifyTokenEvidence,
  indexTransferEvidence,
  registryRecord,
} from "../scripts/lib/classification";
import { ZERO_ADDRESS, type CompactTransferLog } from "../scripts/lib/chain";
import { normalizeMetadataRecord } from "../scripts/lib/metadata";
import { metadataFixture } from "./fixtures";

function transfer(tokenId: number, from: string, to: string, sequence: number): CompactTransferLog {
  return {
    blockNumber: 100 + sequence,
    transactionIndex: 0,
    logIndex: 0,
    transactionHash: `0x${String(sequence).padStart(64, "0")}`,
    from,
    to,
    tokenId,
    sequence,
  };
}

const owner = "0x1111111111111111111111111111111111111111";

describe("token classification", () => {
  it("separates surviving, burned, and unminted evidence", () => {
    const evidence = indexTransferEvidence([
      transfer(1, ZERO_ADDRESS, owner, 0),
      transfer(2, ZERO_ADDRESS, owner, 1),
      transfer(2, owner, ZERO_ADDRESS, 2),
    ]);
    expect(classifyTokenEvidence({
      tokenId: 1,
      metadataAvailable: true,
      minted: evidence.minted.has(1),
      latestTransfer: evidence.latest.get(1),
      verifiedOwner: owner,
    })).toBe("surviving_minted");
    expect(classifyTokenEvidence({
      tokenId: 2,
      metadataAvailable: true,
      minted: evidence.minted.has(2),
      latestTransfer: evidence.latest.get(2),
    })).toBe("burned");
    expect(classifyTokenEvidence({
      tokenId: 3,
      metadataAvailable: true,
      minted: false,
    })).toBe("unminted");
  });

  it("never presents a burned token as playable", () => {
    const metadata = normalizeMetadataRecord(2, metadataFixture(2));
    const record = registryRecord(2, "burned", 123, metadata);
    expect(record.gameRole).toBe("burned_echo");
    expect(record.recruitable).toBe(false);
    expect(record.owner).toBeNull();
  });

  it("fails closed when ownerOf is unavailable", () => {
    expect(classifyTokenEvidence({
      tokenId: 1,
      metadataAvailable: true,
      minted: true,
      ownerReadFailed: true,
    })).toBe("invalid_or_unavailable");
  });
});
