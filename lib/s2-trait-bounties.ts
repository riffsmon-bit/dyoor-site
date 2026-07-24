import crypto from "node:crypto";
import { ethers } from "ethers";
import traitCatalogJson from "@/data/dyoor-s2-trait-catalog.json";
import {
  energyBankContract,
  optionalContractAddress,
} from "@/lib/contracts/addresses";
import {
  S2_TRAIT_LAB_TRAITS,
  type S2TraitLabAction,
} from "@/lib/s2-trait-lab-config";
import {
  TRAIT_BOUNTY_ACTION_REROLL,
  TRAIT_BOUNTY_ACTION_REROLL_ALL,
  TRAIT_BOUNTY_ACTION_UNLOCK,
  traitBountyActions,
  traitBountyRevealsFromCompletion,
} from "@/lib/s2-trait-bounty-rules";
import { traitLabBountiesEnabled } from "@/lib/s2-trait-lab-leaderboard";
import {
  listTraitLabCompletions,
  type TraitLabCompletionRecord,
} from "@/src/lib/storage/s2TraitLabStore";
import {
  getTraitBountyCompletionProcessing,
  getTraitBountySettlement,
  listTraitBountySettlements,
  saveTraitBountyCompletionProcessing,
  saveTraitBountySettlement,
  type TraitBountySettlementRecord,
} from "@/src/lib/storage/s2TraitBountyStore";

const MONAD_CHAIN_ID = 143;
const DEFAULT_MONAD_RPC_URL = "https://rpc.monad.xyz";
const MAX_BOUNTIES = 100;

const BOUNTY_ABI = [
  "error BountyClosed()",
  "error BountyDoesNotExist()",
  "error BountyEnded()",
  "error BountyNotStarted()",
  "error DuplicateSettlement()",
  "error GlobalClaimLimitReached()",
  "error InvalidAction()",
  "error InvalidBounty()",
  "error InvalidCompletionTime()",
  "error TokenClaimLimitReached()",
  "error TraitDoesNotMatch()",
  "error WalletClaimLimitReached()",
  "error ZeroAddress()",
  "function ENERGY_BANK() view returns (address)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function processors(address) view returns (bool)",
  "function bountyCount() view returns (uint256)",
  "function bountyIdAt(uint256 index) view returns (bytes32)",
  "function getBounty(bytes32 bountyId) view returns ((bool exists,bool active,string label,string traitType,string traitValue,bytes32 traitTypeHash,bytes32 traitValueHash,uint256 rewardRaw,uint32 maxClaims,uint32 totalClaims,uint16 perWalletLimit,uint16 perTokenLimit,uint8 actionMask,uint64 startsAt,uint64 endsAt))",
  "function settlementKeyFor(bytes32 bountyId,bytes32 operationId,uint256 tokenId,string traitType,string traitValue) pure returns (bytes32)",
  "function settled(bytes32 settlementKey) view returns (bool)",
  "function settlementWallet(bytes32 settlementKey) view returns (address)",
  "function settleBounty((bytes32 bountyId,address wallet,bytes32 operationId,uint256 tokenId,uint8 action,uint64 completedAt,string traitType,string traitValue) input) returns (bytes32 settlementKey,bytes32 energyClaim)",
] as const;

const ENERGY_BANK_PREFLIGHT_ABI = [
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
] as const;

type CatalogTrait = {
  name?: string;
  selectable?: boolean;
  mutable?: boolean;
};

type TraitCatalog = {
  traits?: Record<string, CatalogTrait[]>;
};

export type TraitBountyView = {
  id: string;
  label: string;
  traitType: string;
  traitValue: string;
  rewardRaw: string;
  rewardEnergy: string;
  maxClaims: number;
  totalClaims: number;
  remainingClaims: number;
  perWalletLimit: number;
  perTokenLimit: number;
  actionMask: number;
  actions: string[];
  startsAt: string;
  endsAt: string;
  active: boolean;
  status: "draft" | "upcoming" | "active" | "ended" | "complete" | "closed";
};

export type TraitBountySettlementResult = {
  bountyId: string;
  bountyLabel: string;
  traitType: string;
  traitValue: string;
  rewardRaw: string;
  rewardEnergy: string;
  status: "settled" | "deduped" | "pending" | "ineligible";
  txHash?: string;
  blockNumber?: string;
  settlementKey?: string;
  error?: string;
};

let cachedProvider: ethers.JsonRpcProvider | null = null;
let cachedValidatedAddress = "";
let cachedBounties: { expiresAt: number; items: TraitBountyView[] } | null = null;

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function normalizePrivateKey(value: string) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function rpcUrl() {
  const value = readEnv(
    "ALCHEMY_MONAD_RPC_URL",
    "DYOOR_S2_RPC_URL",
    "MONAD_RPC_URL",
    "NEXT_PUBLIC_MONAD_RPC_URL",
  ) || DEFAULT_MONAD_RPC_URL;
  if (/testnet/i.test(value)) {
    throw Object.assign(new Error("Trait bounties require Monad mainnet RPC."), { status: 503 });
  }
  return value;
}

function provider() {
  if (!cachedProvider) cachedProvider = new ethers.JsonRpcProvider(rpcUrl(), MONAD_CHAIN_ID);
  return cachedProvider;
}

export function traitBountiesContractAddress() {
  return optionalContractAddress(
    process.env.DYOOR_TRAIT_BOUNTIES_CONTRACT
      || process.env.NEXT_PUBLIC_DYOOR_TRAIT_BOUNTIES_CONTRACT,
  );
}

export function traitBountyEngineEnabled() {
  return traitLabBountiesEnabled() && Boolean(traitBountiesContractAddress());
}

function contract(signerOrProvider: ethers.ContractRunner = provider()) {
  const address = traitBountiesContractAddress();
  return address ? new ethers.Contract(address, BOUNTY_ABI, signerOrProvider) : null;
}

async function validatedContract(signerOrProvider: ethers.ContractRunner = provider()) {
  const address = traitBountiesContractAddress();
  if (!address) return null;
  const bountyContract = contract(signerOrProvider)!;
  if (cachedValidatedAddress === address.toLowerCase()) return bountyContract;

  let configuredBank = "";
  try {
    configuredBank = ethers.getAddress(await bountyContract.ENERGY_BANK());
  } catch {
    throw Object.assign(new Error("The configured Trait Bounty contract is unavailable."), { status: 503 });
  }
  if (configuredBank !== ethers.getAddress(energyBankContract)) {
    throw Object.assign(
      new Error("The configured Trait Bounty contract does not credit the production Energy Bank."),
      { status: 503 },
    );
  }
  cachedValidatedAddress = address.toLowerCase();
  return bountyContract;
}

function actionMaskFor(action: string) {
  if (action === "reroll") return TRAIT_BOUNTY_ACTION_REROLL;
  if (action === "unlock") return TRAIT_BOUNTY_ACTION_UNLOCK;
  if (action === "rerollAll") return TRAIT_BOUNTY_ACTION_REROLL_ALL;
  return 0;
}

function isoFromUnix(value: unknown) {
  const seconds = Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1_000).toISOString()
    : "";
}

function energyLabel(raw: unknown) {
  try {
    return ethers.formatUnits(BigInt(String(raw || "0")), 18);
  } catch {
    return "0";
  }
}

function bountyStatus(input: {
  active: boolean;
  maxClaims: number;
  totalClaims: number;
  startsAt: string;
  endsAt: string;
}) {
  if (input.totalClaims >= input.maxClaims) return "complete" as const;
  if (!input.active) return input.totalClaims ? "closed" as const : "draft" as const;
  const now = Date.now();
  const startsAt = Date.parse(input.startsAt || "");
  const endsAt = Date.parse(input.endsAt || "");
  if (Number.isFinite(startsAt) && startsAt > now) return "upcoming" as const;
  if (Number.isFinite(endsAt) && endsAt < now) return "ended" as const;
  return "active" as const;
}

function normalizeBounty(id: string, raw: any): TraitBountyView {
  const maxClaims = Number(raw.maxClaims || 0);
  const totalClaims = Number(raw.totalClaims || 0);
  const startsAt = isoFromUnix(raw.startsAt);
  const endsAt = isoFromUnix(raw.endsAt);
  const active = Boolean(raw.active);
  const view = {
    id: String(id).toLowerCase(),
    label: String(raw.label || ""),
    traitType: String(raw.traitType || ""),
    traitValue: String(raw.traitValue || ""),
    rewardRaw: String(raw.rewardRaw || "0"),
    rewardEnergy: energyLabel(raw.rewardRaw),
    maxClaims,
    totalClaims,
    remainingClaims: Math.max(0, maxClaims - totalClaims),
    perWalletLimit: Number(raw.perWalletLimit || 0),
    perTokenLimit: Number(raw.perTokenLimit || 0),
    actionMask: Number(raw.actionMask || 0),
    actions: traitBountyActions(raw.actionMask),
    startsAt,
    endsAt,
    active,
    status: "draft" as TraitBountyView["status"],
  };
  view.status = bountyStatus(view);
  return view;
}

export async function listTraitBounties(options: { fresh?: boolean } = {}) {
  if (!options.fresh && cachedBounties && cachedBounties.expiresAt > Date.now()) {
    return cachedBounties.items;
  }
  const bountyContract = await validatedContract();
  if (!bountyContract) return [];
  const count = Number(await bountyContract.bountyCount());
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_BOUNTIES) {
    throw Object.assign(new Error("Trait Bounty registry count is outside the supported range."), { status: 503 });
  }
  const ids = await Promise.all(
    Array.from({ length: count }, (_, index) => bountyContract.bountyIdAt(index)),
  );
  const rawBounties = await Promise.all(ids.map((id) => bountyContract.getBounty(id)));
  const items = rawBounties.map((raw, index) => normalizeBounty(String(ids[index]), raw));
  cachedBounties = { expiresAt: Date.now() + 10_000, items };
  return items;
}

export function traitBountyCatalog() {
  const catalog = traitCatalogJson as TraitCatalog;
  return Object.fromEntries(
    S2_TRAIT_LAB_TRAITS.map((traitType) => {
      const values = Array.from(new Set(
        (catalog.traits?.[traitType] || [])
          .filter((trait) => trait.selectable !== false && trait.mutable !== false)
          .map((trait) => String(trait.name || "").trim())
          .filter(Boolean),
      )).sort((left, right) => left.localeCompare(right));
      return [traitType, values];
    }),
  );
}

function completionUnix(completedAt: string) {
  const value = Date.parse(completedAt);
  return Number.isFinite(value) && value > 0 ? Math.floor(value / 1_000) : 0;
}

function bountySettlementErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return "Trait bounty settlement pending retry.";
  }
  const value = error as {
    errorName?: unknown;
    shortMessage?: unknown;
    reason?: unknown;
    message?: unknown;
    info?: { error?: { message?: unknown } };
  };
  return [
    value.errorName,
    value.shortMessage,
    value.reason,
    value.message,
    value.info?.error?.message,
  ]
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .join(" · ")
    || "Trait bounty settlement pending retry.";
}

function isPermanentBountyRejection(message: string) {
  return [
    "BountyClosed",
    "BountyDoesNotExist",
    "BountyEnded",
    "BountyNotStarted",
    "GlobalClaimLimitReached",
    "InvalidAction",
    "InvalidBounty",
    "TokenClaimLimitReached",
    "TraitDoesNotMatch",
    "WalletClaimLimitReached",
    "ZeroAddress",
    "does not match completion wallet",
  ].some((name) => message.includes(name));
}

function operatorSigner() {
  const key = normalizePrivateKey(readEnv("DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY"));
  if (!key) {
    throw Object.assign(
      new Error("DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY is not configured."),
      { status: 503 },
    );
  }
  return new ethers.Wallet(key, provider());
}

async function bountyPreflight(bountyContract: ethers.Contract, signerAddress: string) {
  const address = traitBountiesContractAddress();
  const bank = new ethers.Contract(
    energyBankContract,
    ENERGY_BANK_PREFLIGHT_ABI,
    provider(),
  );
  const [processor, paused, creditRole] = await Promise.all([
    bountyContract.processors(signerAddress).then(Boolean),
    bountyContract.paused().then(Boolean),
    bank.CREDIT_ROLE(),
  ]);
  const hasCreditRole = await bank.hasRole(creditRole, address).then(Boolean);
  if (!processor) {
    throw Object.assign(new Error("Trait Bounty operator is not an approved processor."), { status: 503 });
  }
  if (paused) {
    throw Object.assign(new Error("Trait Bounty payouts are paused."), { status: 503 });
  }
  if (!hasCreditRole) {
    throw Object.assign(
      new Error("Trait Bounty contract is missing Energy Bank CREDIT_ROLE."),
      { status: 503 },
    );
  }
}

async function publicBountyPreflight() {
  const address = traitBountiesContractAddress();
  const bountyContract = await validatedContract();
  if (!address || !bountyContract) {
    return {
      ready: false,
      owner: "",
      paused: false,
      energyCreditRole: false,
      processorConfigured: false,
      processor: "",
    };
  }
  const bank = new ethers.Contract(
    energyBankContract,
    ENERGY_BANK_PREFLIGHT_ABI,
    provider(),
  );
  const [owner, paused, creditRole] = await Promise.all([
    bountyContract.owner().then(String),
    bountyContract.paused().then(Boolean),
    bank.CREDIT_ROLE(),
  ]);
  const energyCreditRole = await bank.hasRole(creditRole, address).then(Boolean);
  let processor = "";
  let processorConfigured = false;
  const key = normalizePrivateKey(readEnv("DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY"));
  if (key) {
    try {
      processor = new ethers.Wallet(key).address;
      processorConfigured = await bountyContract.processors(processor).then(Boolean);
    } catch {
      processor = "";
      processorConfigured = false;
    }
  }
  return {
    ready: !paused && energyCreditRole && processorConfigured,
    owner,
    paused,
    energyCreditRole,
    processorConfigured,
    processor,
  };
}

async function saveSettlement(input: {
  completion: TraitLabCompletionRecord;
  bounty: TraitBountyView;
  traitType: string;
  traitValue: string;
  settlementKey: string;
  txHash?: string;
  blockNumber?: string;
  deduped?: boolean;
}) {
  return await saveTraitBountySettlement({
    version: 1,
    settlementKey: input.settlementKey.toLowerCase(),
    bountyId: input.bounty.id,
    bountyLabel: input.bounty.label,
    rollId: input.completion.rollId.toLowerCase(),
    wallet: input.completion.wallet.toLowerCase(),
    tokenId: String(input.completion.tokenId),
    action: input.completion.action,
    traitType: input.traitType,
    traitValue: input.traitValue,
    rewardRaw: input.bounty.rewardRaw,
    rewardEnergy: input.bounty.rewardEnergy,
    completedAt: input.completion.completedAt,
    settledAt: new Date().toISOString(),
    txHash: input.txHash,
    blockNumber: input.blockNumber,
    deduped: input.deduped,
  });
}

export async function settleTraitLabBountiesForCompletion(
  completion: TraitLabCompletionRecord,
  options: { bounties?: TraitBountyView[] } = {},
) {
  const action = actionMaskFor(completion.action as S2TraitLabAction);
  const reveals = traitBountyRevealsFromCompletion(completion);
  if (!traitBountyEngineEnabled() || !action || !reveals.length) {
    return [] as TraitBountySettlementResult[];
  }

  const bounties = options.bounties || await listTraitBounties({ fresh: true });
  const completedAt = completionUnix(completion.completedAt);
  if (!completedAt || !/^0x[a-fA-F0-9]{64}$/.test(completion.rollId)) {
    return [] as TraitBountySettlementResult[];
  }
  const candidates = bounties.flatMap((bounty) => {
    if (!bounty.active || !(bounty.actionMask & action)) return [];
    if (bounty.totalClaims >= bounty.maxClaims) return [];
    const start = Date.parse(bounty.startsAt || "");
    const end = Date.parse(bounty.endsAt || "");
    const completedMs = completedAt * 1_000;
    if (Number.isFinite(start) && completedMs < start) return [];
    if (Number.isFinite(end) && completedMs > end) return [];
    return reveals
      .filter((reveal) => (
        reveal.traitType === bounty.traitType
        && reveal.traitValue === bounty.traitValue
      ))
      .map((reveal) => ({ bounty, ...reveal }));
  });
  if (!candidates.length) return [] as TraitBountySettlementResult[];

  const signer = operatorSigner();
  const signerAddress = await signer.getAddress();
  const readContract = await validatedContract();
  const writeContract = await validatedContract(signer);
  if (!readContract || !writeContract) return [] as TraitBountySettlementResult[];
  await bountyPreflight(readContract, signerAddress);

  const results: TraitBountySettlementResult[] = [];
  for (const candidate of candidates) {
    let settlementKey = "";
    const base = {
      bountyId: candidate.bounty.id,
      bountyLabel: candidate.bounty.label,
      traitType: candidate.traitType,
      traitValue: candidate.traitValue,
      rewardRaw: candidate.bounty.rewardRaw,
      rewardEnergy: candidate.bounty.rewardEnergy,
    };
    try {
      settlementKey = String(await readContract.settlementKeyFor(
        candidate.bounty.id,
        completion.rollId,
        BigInt(completion.tokenId),
        candidate.traitType,
        candidate.traitValue,
      )).toLowerCase();
      const stored = await getTraitBountySettlement(settlementKey);
      if (stored) {
        results.push({ ...base, status: "deduped", settlementKey, txHash: stored.txHash });
        continue;
      }

      const alreadySettled = await readContract.settled(settlementKey).then(Boolean);
      if (alreadySettled) {
        const settlementWallet = String(await readContract.settlementWallet(settlementKey)).toLowerCase();
        if (settlementWallet !== completion.wallet.toLowerCase()) {
          throw new Error("On-chain bounty settlement wallet does not match completion wallet.");
        }
        await saveSettlement({
          completion,
          bounty: candidate.bounty,
          traitType: candidate.traitType,
          traitValue: candidate.traitValue,
          settlementKey,
          deduped: true,
        });
        results.push({ ...base, status: "deduped", settlementKey });
        continue;
      }

      const settlementInput = {
        bountyId: candidate.bounty.id,
        wallet: completion.wallet,
        operationId: completion.rollId,
        tokenId: BigInt(completion.tokenId),
        action,
        completedAt,
        traitType: candidate.traitType,
        traitValue: candidate.traitValue,
      };
      await writeContract.settleBounty.staticCall(settlementInput);
      const tx = await writeContract.settleBounty(
        settlementInput,
        { gasLimit: 280_000n },
      );
      const receipt = await tx.wait();
      if (receipt?.status !== 1) throw new Error("Trait bounty settlement transaction failed.");

      await saveSettlement({
        completion,
        bounty: candidate.bounty,
        traitType: candidate.traitType,
        traitValue: candidate.traitValue,
        settlementKey,
        txHash: tx.hash,
        blockNumber: String(receipt.blockNumber || ""),
      });
      cachedBounties = null;
      results.push({
        ...base,
        status: "settled",
        settlementKey,
        txHash: tx.hash,
        blockNumber: String(receipt.blockNumber || ""),
      });
    } catch (error) {
      const message = bountySettlementErrorMessage(error);
      if (settlementKey) {
        try {
          const alreadySettled = await readContract.settled(settlementKey).then(Boolean);
          if (alreadySettled) {
            const settlementWallet = String(
              await readContract.settlementWallet(settlementKey),
            ).toLowerCase();
            if (settlementWallet === completion.wallet.toLowerCase()) {
              await saveSettlement({
                completion,
                bounty: candidate.bounty,
                traitType: candidate.traitType,
                traitValue: candidate.traitValue,
                settlementKey,
                deduped: true,
              });
              results.push({ ...base, status: "deduped", settlementKey });
              continue;
            }
          }
        } catch {
          // Preserve the original settlement error when the reconciliation read fails.
        }
      }
      results.push({
        ...base,
        status: isPermanentBountyRejection(message) ? "ineligible" : "pending",
        settlementKey: settlementKey || undefined,
        error: message,
      });
    }
  }
  await saveTraitBountyCompletionProcessing({
    version: 1,
    rollId: completion.rollId,
    status: results.some((result) => result.status === "pending") ? "pending" : "complete",
    processedAt: new Date().toISOString(),
    settlementKeys: results
      .map((result) => result.settlementKey || "")
      .filter(Boolean),
    errors: results
      .map((result) => result.error || "")
      .filter(Boolean),
  }).catch(() => undefined);
  return results;
}

export async function processPendingTraitBounties(limit = 50) {
  if (!traitBountyEngineEnabled()) {
    return {
      ok: true,
      enabled: false,
      scanned: 0,
      settled: 0,
      deduped: 0,
      pending: 0,
      results: [] as Array<Record<string, unknown>>,
    };
  }
  const normalizedLimit = Math.min(100, Math.max(1, Math.floor(limit) || 50));
  const [bounties, completions] = await Promise.all([
    listTraitBounties({ fresh: true }),
    listTraitLabCompletions(),
  ]);
  const ordered = completions
    .slice()
    .sort((left, right) => (
      left.completedAt.localeCompare(right.completedAt)
      || left.rollId.localeCompare(right.rollId)
    ));
  const processingRecords = await Promise.all(
    ordered.map((completion) => getTraitBountyCompletionProcessing(completion.rollId)),
  );
  const selected = ordered
    .filter((_, index) => processingRecords[index]?.status !== "complete")
    .slice(0, normalizedLimit);
  const results: Array<Record<string, unknown>> = [];
  for (const completion of selected) {
    const settlements = await settleTraitLabBountiesForCompletion(completion, { bounties });
    for (const settlement of settlements) {
      results.push({ rollId: completion.rollId, ...settlement });
    }
    if (!settlements.length) {
      await saveTraitBountyCompletionProcessing({
        version: 1,
        rollId: completion.rollId,
        status: "complete",
        processedAt: new Date().toISOString(),
        settlementKeys: [],
        errors: [],
      });
    }
  }
  return {
    ok: true,
    enabled: true,
    scanned: selected.length,
    settled: results.filter((result) => result.status === "settled").length,
    deduped: results.filter((result) => result.status === "deduped").length,
    pending: results.filter((result) => result.status === "pending").length,
    results,
  };
}

export async function traitBountyPublicState() {
  const address = traitBountiesContractAddress();
  const configured = Boolean(address);
  const enabled = traitBountyEngineEnabled();
  const [bounties, settlements, preflight] = configured
    ? await Promise.all([
      listTraitBounties(),
      listTraitBountySettlements(),
      publicBountyPreflight(),
    ])
    : [[], [], await publicBountyPreflight()];
  return {
    configured,
    enabled,
    chainId: MONAD_CHAIN_ID,
    contractAddress: address,
    preflight,
    bounties,
    settlements,
    catalog: traitBountyCatalog(),
  };
}

export function verifyTraitBountyProcessorSecret(value: unknown) {
  const expected = readEnv("DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET");
  const supplied = String(value || "");
  if (process.env.NODE_ENV === "production" && expected.length < 32) return false;
  if (!expected || expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
