import path from "node:path";
import { printReadOnlyBanner, hasFlag } from "./lib/cli";
import {
  loadChainSnapshot,
  S2_CONTRACT,
  S2_DEPLOYMENT_BLOCK,
  verifyOwners,
  ZERO_ADDRESS,
} from "./lib/chain";
import {
  classifyTokenEvidence,
  indexTransferEvidence,
  registryRecord,
  type PublicDroidRegistryRecord,
} from "./lib/classification";
import { writeJson } from "./lib/json";
import { loadAllMetadata, METADATA_MAX_SUPPLY } from "./lib/metadata";
import { GAME_DATA_ROOT, PRIVATE_DATA_ROOT } from "./lib/paths";

printReadOnlyBanner("Classify surviving, burned, unminted, and unavailable droids");

const metadataResult = await loadAllMetadata();
if (metadataResult.failures.length) {
  throw new Error(`Classification requires complete metadata; ${metadataResult.failures.length} record(s) failed.`);
}
const metadataById = new Map(metadataResult.records.map((record) => [record.tokenId, record]));
const { snapshot, contract } = await loadChainSnapshot();
const evidence = indexTransferEvidence(snapshot.logs);
const survivingCandidates = [...evidence.minted].filter((tokenId) => (
  evidence.latest.get(tokenId)?.to !== ZERO_ADDRESS
));
const expectedOwners = new Map(
  survivingCandidates.flatMap((tokenId) => {
    const owner = evidence.latest.get(tokenId)?.to;
    return owner ? [[tokenId, owner] as const] : [];
  }),
);
const ownerVerification = await verifyOwners(contract, survivingCandidates, expectedOwners);

const registry: PublicDroidRegistryRecord[] = [];
for (let tokenId = 1; tokenId <= METADATA_MAX_SUPPLY; tokenId += 1) {
  const metadata = metadataById.get(tokenId);
  const latestTransfer = evidence.latest.get(tokenId);
  const status = classifyTokenEvidence({
    tokenId,
    metadataAvailable: Boolean(metadata),
    minted: evidence.minted.has(tokenId),
    latestTransfer,
    verifiedOwner: ownerVerification.owners.get(tokenId),
    ownerReadFailed: ownerVerification.failures.has(tokenId),
  });
  registry.push(registryRecord(tokenId, status, snapshot.blockNumber, metadata));
}

const counts = Object.fromEntries(
  ["surviving_minted", "burned", "unminted", "invalid_or_unavailable"].map((status) => [
    status,
    registry.filter((record) => record.blockchainStatus === status).length,
  ]),
);
const warnings: string[] = [];
if (evidence.minted.size !== snapshot.totalMinted) {
  warnings.push(`Mint event count ${evidence.minted.size} differs from totalMinted ${snapshot.totalMinted}.`);
}
if (counts.surviving_minted !== snapshot.totalSupply) {
  warnings.push(`Verified survivor count ${counts.surviving_minted} differs from totalSupply ${snapshot.totalSupply}.`);
}
if (counts.burned !== snapshot.totalMinted - snapshot.totalSupply) {
  warnings.push(`Burn count ${counts.burned} differs from contract-derived burns ${snapshot.totalMinted - snapshot.totalSupply}.`);
}
if (ownerVerification.mismatches.length) {
  warnings.push(`${ownerVerification.mismatches.length} latest-transfer owner(s) differ from ownerOf.`);
}
if (ownerVerification.failures.size) {
  warnings.push(`${ownerVerification.failures.size} ownerOf read(s) failed.`);
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  chainId: 143,
  contract: S2_CONTRACT,
  deploymentBlock: S2_DEPLOYMENT_BLOCK,
  chainScanBlock: snapshot.blockNumber,
  rpcHost: snapshot.rpcHost,
  contractCounts: {
    totalMinted: snapshot.totalMinted,
    totalSupply: snapshot.totalSupply,
    burned: snapshot.totalMinted - snapshot.totalSupply,
    maxSupply: snapshot.maxSupply,
  },
  classifiedCounts: counts,
  transferLogs: snapshot.logs.length,
  uniqueMintEvents: evidence.minted.size,
  ownerReads: survivingCandidates.length,
  ownerReadFailures: ownerVerification.failures.size,
  ownerMismatches: ownerVerification.mismatches.map(({ tokenId }) => ({ tokenId })),
  warnings,
  privacy: "Owner addresses are intentionally omitted from committed output.",
};

await Promise.all([
  writeJson(path.join(GAME_DATA_ROOT, "droid-registry.json"), {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    chainScanBlock: snapshot.blockNumber,
    records: registry,
  }),
  writeJson(path.join(GAME_DATA_ROOT, "droid-classification-report.json"), report),
]);

if (hasFlag("--write-private-owners")) {
  await writeJson(path.join(PRIVATE_DATA_ROOT, `owners-${snapshot.blockNumber}.json`), {
    warning: "Private local cache. Never commit or serve this file.",
    blockNumber: snapshot.blockNumber,
    owners: Object.fromEntries([...ownerVerification.owners].map(([tokenId, owner]) => [String(tokenId), owner])),
  });
}

console.log(JSON.stringify(report, null, 2));
if (warnings.length) process.exitCode = 1;
