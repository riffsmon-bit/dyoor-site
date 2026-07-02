"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Alert, Button, Card, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { WalletButton } from "@/components/wallet/WalletButton";
import { adminMessage } from "@/lib/adminMessage";
import { MONAD_CHAIN_HEX } from "@/lib/monad";
import { useWalletService } from "@/providers/WalletServiceProvider";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type Snapshot = {
  ok?: boolean;
  generatedAt: string;
  verified?: boolean;
  validation?: {
    verified?: boolean;
    status?: "verified" | "warning" | "failed";
    checks?: Array<{ scope: string; label: string; status: string; detail: string }>;
    warnings?: string[];
    errors?: string[];
  };
  contracts?: {
    chainId?: number;
    s1?: string;
    ascensionStaking?: string;
    energyBank?: string;
  };
  dataSources?: Record<string, string>;
  fileNames?: {
    stakingCsv?: string;
    stakingJson?: string;
    blueprintCsv?: string;
    blueprintJson?: string;
    combinedCsv?: string;
    combinedJson?: string;
  };
  exportHistory?: Array<Record<string, any>>;
  discovery?: {
    scanMode?: string;
    startBlock?: number;
    latestBlock?: number;
    lastScannedBlock?: number;
    chunkSize?: number;
    chunksScanned?: number;
    failedChunks?: number;
    limited?: boolean;
    discoveredWallets?: number;
    discoveredTokenIds?: number;
    startTokenId?: number;
    lastScannedTokenId?: number;
    maxTokenId?: number;
    batchTokens?: number;
    failedTokenReads?: number;
    stakingContractBalance?: number;
    startIndex?: number;
    lastScannedIndex?: number;
    maxIndex?: number;
  };
  totals: {
    walletsFound: number;
    totalStaked: number;
    totalAscendedS1?: number;
    ascendedS1Wallets?: number;
    unregisteredDeposits?: number;
    totalBlueprintsSaved: number;
    totalBlueprintSourceRecords?: number;
    walletsWithBoth?: number;
    walletsStakedNoBlueprint?: number;
    walletsBlueprintNoStake?: number;
    stakingContractBalance?: number;
  };
  staking: Array<Record<string, any>>;
  ascendedS1?: Array<Record<string, any>>;
  unregisteredDeposits?: Array<Record<string, any>>;
  blueprints: Array<Record<string, any>>;
  blueprintVersions?: Array<Record<string, any>>;
  combined: Array<Record<string, any>>;
  warnings?: string[];
};

type SnapshotCursor = {
  nextBlock?: number;
  latestBlock?: number;
  batchBlocks?: number;
  scanMode?: string;
  nextTokenId?: number;
  maxTokenId?: number;
  nextIndex?: number;
  maxIndex?: number;
  batchTokens?: number;
} | null;

type SnapshotDiscoverResponse = {
  ok?: boolean;
  complete?: boolean;
  cursor?: SnapshotCursor;
  wallets?: string[];
  tokenIds?: string[];
  tokenOwners?: Record<string, string>;
  discovery?: Snapshot["discovery"];
  warnings?: string[];
  error?: string;
};

type SnapshotSession = {
  cursor?: SnapshotCursor;
  discoveredWallets: string[];
  discoveredTokenIds: string[];
  tokenOwners: Record<string, string>;
  discovery?: Snapshot["discovery"];
  warnings: string[];
  complete: boolean;
};

type AdminBackendStatus = {
  backendStatus?: string;
  snapshotSystemStatus?: string;
  chainId?: number;
  contracts?: {
    s1?: string;
    ascensionStaking?: string;
    energyBank?: string;
  };
  dataSources?: Record<string, string>;
};

type AirdropResult = {
  ok?: boolean;
  partial?: boolean;
  recipients?: string[];
  recipientCount?: number;
  successfulWallets?: string[];
  skippedWallets?: string[];
  failedWallets?: Array<{ wallet: string; error?: string }>;
  successCount?: number;
  skippedCount?: number;
  failureCount?: number;
  amountRaw?: string;
  totalRaw?: string;
  requestedTotalRaw?: string;
  campaignId?: string;
  campaignIds?: string[];
  txHash?: string;
  txHashes?: string[];
  blockNumber?: number | null;
  batchCount?: number;
  executionMode?: string;
  actionId?: string;
  note?: string;
  timestamp?: string;
  results?: Array<Record<string, any>>;
  error?: string;
};

type ReconciliationRow = {
  wallet: string;
  totalHarvestedFromEvents?: string;
  harvestedShown?: string;
  lifetimeShown?: string;
  bankShown?: string;
  expectedHarvested?: string;
  expectedLifetime?: string;
  expectedBank?: string;
  missing?: string;
  affected?: string;
  recommendedCredit?: string;
  recommendedCreditRaw?: string;
  repairable?: string;
  evidenceTxHashes?: string;
  evidenceClaimKeys?: string;
  notes?: string;
  repairItems?: Array<Record<string, string>>;
  [key: string]: any;
};

type ReconciliationReport = {
  generatedAt: string;
  indexedBlock?: number;
  energyBankAddress?: string;
  repairPreflight?: {
    ready?: boolean;
    reason?: string;
    operator?: string;
    chainId?: string;
    hasCreditRole?: boolean | null;
    hasAdminRole?: boolean | null;
    paused?: boolean | null;
  };
  rowCount: number;
  affectedCount: number;
  totalMissingRaw: string;
  totalMissing: string;
  totalRecommendedCreditRaw: string;
  totalRecommendedCredit: string;
  rows: ReconciliationRow[];
};

type ReconciliationRepairResult = {
  ok?: boolean;
  partial?: boolean;
  reportSummary?: Record<string, unknown>;
  repair?: {
    repairedAt?: string;
    operator?: string;
    results?: Array<Record<string, any>>;
    successCount?: number;
    failureCount?: number;
    skippedCount?: number;
    logged?: boolean;
    preflight?: ReconciliationReport["repairPreflight"];
  };
  preflight?: ReconciliationReport["repairPreflight"];
  error?: string;
};

function normalizeAddress(address?: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address || "") ? String(address).toLowerCase() : "";
}

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "-";
}

function toCsv(rows: Array<Record<string, any>>) {
  if (!rows.length) return "";
  const headers = Array.from(rows.reduce<Set<string>>((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const esc = (value: unknown) => `"${String(Array.isArray(value) ? value.join(", ") : value ?? "").replaceAll("\"", "\"\"")}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((header) => esc(row[header])).join(","))].join("\n");
}

function downloadFile(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(value?: string) {
  return (value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function snapshotFileStamp(value?: string) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const yyyy = safeDate.getUTCFullYear();
  const mm = String(safeDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(safeDate.getUTCDate()).padStart(2, "0");
  const hh = String(safeDate.getUTCHours()).padStart(2, "0");
  const min = String(safeDate.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

function compactMessages(messages?: string[], max = 4) {
  const unique = Array.from(new Set((messages || []).filter(Boolean)));
  if (unique.length <= max) return unique.join(" ");
  return `${unique.slice(0, max).join(" ")} ${unique.length - max} more warning(s) hidden in the JSON export.`;
}

function parseWalletList(value: string) {
  const tokens = value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];

  for (const token of tokens) {
    const wallet = normalizeAddress(token);
    if (!wallet) {
      invalid.push(token);
      continue;
    }
    if (seen.has(wallet)) {
      duplicates.push(wallet);
      continue;
    }
    seen.add(wallet);
    valid.push(wallet);
  }

  return {
    rawCount: tokens.length,
    valid,
    invalid,
    duplicates,
  };
}

function parseEnergyAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d{0,18})?$/.test(trimmed)) return null;
  try {
    const raw = parseUnits(trimmed, 18);
    return raw > 0n ? raw : null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function postSnapshotRequest(payload: Record<string, unknown>, attempts = 3) {
  let lastError = "Admin snapshot failed.";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch("/api/admin/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok !== false) return data;
      lastError = data?.error || `Admin snapshot failed (${response.status}).`;
      if (response.status < 500 || attempt === attempts) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Admin snapshot failed.";
      if (attempt === attempts) break;
    }
    await sleep(700 * attempt);
  }
  throw new Error(lastError);
}

function mergeSnapshotSession(session: SnapshotSession, data: SnapshotDiscoverResponse): SnapshotSession {
  const discoveredWallets = new Set(session.discoveredWallets);
  const discoveredTokenIds = new Set(session.discoveredTokenIds);
  const tokenOwners = { ...session.tokenOwners };
  const warnings = new Set(session.warnings);

  for (const wallet of data.wallets || []) {
    const normalized = normalizeAddress(wallet);
    if (normalized) discoveredWallets.add(normalized);
  }
  for (const tokenId of data.tokenIds || []) {
    const value = String(tokenId);
    if (/^\d+$/.test(value)) discoveredTokenIds.add(value);
  }
  for (const [tokenId, wallet] of Object.entries(data.tokenOwners || {})) {
    const normalized = normalizeAddress(wallet);
    if (/^\d+$/.test(tokenId) && normalized) {
      discoveredTokenIds.add(tokenId);
      discoveredWallets.add(normalized);
      tokenOwners[tokenId] = normalized;
    }
  }
  for (const warning of data.warnings || []) warnings.add(warning);

  const page = data.discovery || {};
  const discovery = {
    scanMode: page.scanMode ?? session.discovery?.scanMode,
    startBlock: page.startBlock ?? session.discovery?.startBlock,
    latestBlock: page.latestBlock ?? session.discovery?.latestBlock,
    lastScannedBlock: page.lastScannedBlock ?? session.discovery?.lastScannedBlock,
    chunkSize: page.chunkSize ?? session.discovery?.chunkSize,
    chunksScanned: (session.discovery?.chunksScanned || 0) + (page.chunksScanned || 0),
    failedChunks: (session.discovery?.failedChunks || 0) + (page.failedChunks || 0),
    limited: Boolean(session.discovery?.limited || page.limited),
    discoveredWallets: discoveredWallets.size,
    discoveredTokenIds: discoveredTokenIds.size,
    startTokenId: page.startTokenId ?? session.discovery?.startTokenId,
    lastScannedTokenId: page.lastScannedTokenId ?? session.discovery?.lastScannedTokenId,
    maxTokenId: page.maxTokenId ?? session.discovery?.maxTokenId,
    batchTokens: page.batchTokens ?? session.discovery?.batchTokens,
    failedTokenReads: (session.discovery?.failedTokenReads || 0) + (page.failedTokenReads || 0),
    stakingContractBalance: page.stakingContractBalance ?? session.discovery?.stakingContractBalance,
    startIndex: page.startIndex ?? session.discovery?.startIndex,
    lastScannedIndex: page.lastScannedIndex ?? session.discovery?.lastScannedIndex,
    maxIndex: page.maxIndex ?? session.discovery?.maxIndex,
  };

  return {
    ...session,
    cursor: data.cursor || undefined,
    discoveredWallets: Array.from(discoveredWallets).sort(),
    discoveredTokenIds: Array.from(discoveredTokenIds).sort((a, b) => Number(a) - Number(b)),
    tokenOwners,
    discovery,
    warnings: Array.from(warnings),
    complete: Boolean(data.complete),
  };
}

function snapshotGatherLabel(session: SnapshotSession) {
  const discovery = session.discovery;
  const contractBalance = discovery?.stakingContractBalance || 0;
  const gathered = session.discoveredTokenIds.length;
  if (!discovery) return "Preparing snapshot collection.";
  if (contractBalance) {
    return session.complete
      ? `Collection complete. Found ${gathered.toLocaleString()} of ${contractBalance.toLocaleString()} staked S1 token IDs.`
      : `Gathering staked S1 token IDs. Found ${gathered.toLocaleString()} of ${contractBalance.toLocaleString()} so far.`;
  }
  return session.complete
    ? `Collection complete. Found ${gathered.toLocaleString()} staked S1 token IDs.`
    : `Gathering staked S1 token IDs. Found ${gathered.toLocaleString()} so far.`;
}

function SnapshotSection({
  rows,
  title,
  description,
  csvFilename,
  jsonFilename,
  jsonPayload,
  validationStatus,
  dataSource,
}: {
  rows: Array<Record<string, any>>;
  title: string;
  description: string;
  csvFilename: string;
  jsonFilename: string;
  jsonPayload?: unknown;
  validationStatus?: string;
  dataSource?: string;
}) {
  const [query, setQuery] = useState("");
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
  }, [query, rows]);
  const preview = filteredRows.slice(0, 8);
  return (
    <Card className="p-5 md:p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="eyebrow">Export Module</p>
          <h2 className="mt-2 text-2xl font-black uppercase text-white">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-white/60">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!filteredRows.length} onClick={() => downloadFile(csvFilename, toCsv(filteredRows), "text/csv")}>Download CSV</Button>
          <Button variant="ghost" disabled={!filteredRows.length} onClick={() => downloadFile(jsonFilename, JSON.stringify(jsonPayload ?? filteredRows, null, 2), "application/json")}>Download JSON</Button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-xs font-black uppercase tracking-[0.12em] text-white/45 md:grid-cols-2">
        <span>Validation: <span className={validationStatus === "verified" ? "text-dyoor-cyan" : validationStatus === "failed" ? "text-red-200" : "text-yellow-100"}>{validationStatus || "pending"}</span></span>
        <span>Data source: <span className="text-white/70">{dataSource || "pending"}</span></span>
      </div>
      <input
        className="field-control mt-5"
        placeholder="Search wallet, token ID, blueprint ID, trait, or status"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {!filteredRows.length ? (
        <EmptyState className="mt-5" title="No Snapshot Data" copy="Generate a snapshot to populate this export table." />
      ) : (
        <div className="mt-5 overflow-auto rounded border border-dyoor-purple/25 bg-black/35">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.14em] text-white/45">
              <tr>
                {Object.keys(preview[0]).slice(0, 8).map((key) => <th className="px-3 py-3" key={key}>{key}</th>)}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, index) => (
                <tr className="border-t border-white/8" key={index}>
                  {Object.keys(preview[0]).slice(0, 8).map((key) => (
                    <td className="max-w-64 truncate px-3 py-3 font-semibold text-white/70" key={key}>
                      {key === "wallet" ? shortAddress(row[key]) : Array.isArray(row[key]) ? row[key].join(", ") : String(row[key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function AdminPage() {
  const walletService = useWalletService();
  const getWalletProviderForStatus = walletService.getProvider;
  const authenticated = walletService.connected;
  const walletAddress = normalizeAddress(walletService.address);
  const wrongNetwork = walletService.status === "wrong-network";
  const [authorized, setAuthorized] = useState(false);
  const [authStatus, setAuthStatus] = useState("Connect owner wallet.");
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotSession, setSnapshotSession] = useState<SnapshotSession | null>(null);
  const [error, setError] = useState("");
  const [snapshotProgress, setSnapshotProgress] = useState("");
  const [airdropRecipientsInput, setAirdropRecipientsInput] = useState("");
  const [airdropAmount, setAirdropAmount] = useState("");
  const [airdropCampaign, setAirdropCampaign] = useState(`dyoor-energy-${new Date().toISOString().slice(0, 10)}`);
  const [airdropNote, setAirdropNote] = useState("");
  const [airdropConfirm, setAirdropConfirm] = useState(false);
  const [airdropLoading, setAirdropLoading] = useState(false);
  const [airdropStatus, setAirdropStatus] = useState("Paste wallets or upload a CSV to preview an Energy airdrop.");
  const [airdropResult, setAirdropResult] = useState<AirdropResult | null>(null);
  const [reconciliationReport, setReconciliationReport] = useState<ReconciliationReport | null>(null);
  const [reconciliationResult, setReconciliationResult] = useState<ReconciliationRepairResult | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [reconciliationStatus, setReconciliationStatus] = useState("Load the Energy reconciliation report before applying any repair credits.");
  const [reconciliationConfirm, setReconciliationConfirm] = useState(false);
  const [reconciliationLimit, setReconciliationLimit] = useState("10");
  const [lastVerifiedAt, setLastVerifiedAt] = useState("");
  const [lastSignatureAt, setLastSignatureAt] = useState("");
  const [currentChainId, setCurrentChainId] = useState("");
  const [adminBackend, setAdminBackend] = useState<AdminBackendStatus | null>(null);

  useEffect(() => {
    let active = true;
    async function checkOwner() {
      setSnapshot(null);
      setSnapshotSession(null);
      setError("");
      setSnapshotProgress("");
      if (!walletAddress) {
        setAuthorized(false);
        setAuthStatus("Connect owner wallet.");
        setCurrentChainId("");
        setAdminBackend(null);
        return;
      }
      const response = await fetch(`/api/admin/snapshots?wallet=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      const provider = await getWalletProviderForStatus().catch(() => null) as Eip1193Provider | null;
      const chainId = provider ? await provider.request({ method: "eth_chainId" }).catch(() => "") : "";
      if (!active) return;
      setAuthorized(Boolean(data.authorized));
      setAdminBackend(data as AdminBackendStatus);
      setAuthStatus(data.authorized ? "Owner wallet connected. Sign to unlock snapshots." : "Not authorized.");
      setCurrentChainId(String(chainId || ""));
      setLastVerifiedAt(new Date().toISOString());
    }
    void checkOwner();
    return () => {
      active = false;
    };
  }, [getWalletProviderForStatus, walletAddress]);

  const filenameBase = useMemo(() => `dyoor-admin-${stamp(snapshot?.generatedAt)}`, [snapshot?.generatedAt]);
  const snapshotFiles = useMemo(() => {
    const fallbackStamp = snapshotFileStamp(snapshot?.generatedAt);
    return {
      stakingCsv: snapshot?.fileNames?.stakingCsv || `ascension-staking-snapshot-${fallbackStamp}.csv`,
      stakingJson: snapshot?.fileNames?.stakingJson || `ascension-staking-snapshot-${fallbackStamp}.json`,
      blueprintCsv: snapshot?.fileNames?.blueprintCsv || `ascension-blueprint-snapshot-${fallbackStamp}.csv`,
      blueprintJson: snapshot?.fileNames?.blueprintJson || `ascension-blueprint-snapshot-${fallbackStamp}.json`,
      combinedCsv: snapshot?.fileNames?.combinedCsv || `combined-ascension-snapshot-${fallbackStamp}.csv`,
      combinedJson: snapshot?.fileNames?.combinedJson || `combined-ascension-snapshot-${fallbackStamp}.json`,
      ascendedCsv: `${filenameBase}-ascended-s1.csv`,
      ascendedJson: `${filenameBase}-ascended-s1.json`,
      unregisteredCsv: `${filenameBase}-pending-unregistered-deposits.csv`,
      unregisteredJson: `${filenameBase}-pending-unregistered-deposits.json`,
    };
  }, [filenameBase, snapshot?.fileNames, snapshot?.generatedAt]);
  const unregisteredDepositRows = useMemo(() => {
    if (snapshot?.unregisteredDeposits?.length) return snapshot.unregisteredDeposits;
    return (snapshot?.ascendedS1 || []).filter((row) => (
      String(row.wallet || "") === "unregistered" || String(row.tokenIdSource || "").includes("unregistered")
    ));
  }, [snapshot]);
  const parsedAirdropRecipients = useMemo(() => parseWalletList(airdropRecipientsInput), [airdropRecipientsInput]);
  const airdropRecipients = parsedAirdropRecipients.valid;
  const airdropAmountRaw = useMemo(() => parseEnergyAmount(airdropAmount), [airdropAmount]);
  const airdropTotalRaw = useMemo(() => airdropAmountRaw ? airdropAmountRaw * BigInt(airdropRecipients.length) : 0n, [airdropAmountRaw, airdropRecipients.length]);
  const estimatedActionCount = Math.max(airdropRecipients.length ? 1 : 0, Math.ceil(airdropRecipients.length / 150));
  const airdropRows = useMemo(() => {
    if (airdropResult?.results?.length) {
      return airdropResult.results.map((row) => ({
        wallet: row.wallet,
        status: row.status,
        amountEnergy: row.amountRaw ? formatUnits(BigInt(String(row.amountRaw)), 18) : "",
        campaignId: row.campaignId || "",
        txHash: row.txHash || "",
        blockNumber: row.blockNumber || "",
        error: row.error || "",
        timestamp: airdropResult.timestamp || "",
        note: airdropResult.note || "",
      }));
    }
    if (!airdropResult?.recipients?.length) return [];
    return airdropResult.recipients.map((wallet) => ({
      wallet,
      status: "submitted",
      amountEnergy: airdropResult.amountRaw ? formatUnits(BigInt(airdropResult.amountRaw), 18) : "",
      campaignId: airdropResult.campaignId || "",
      txHash: airdropResult.txHash || "",
      blockNumber: airdropResult.blockNumber || "",
      error: "",
      timestamp: airdropResult.timestamp || "",
      note: airdropResult.note || "",
    }));
  }, [airdropResult]);
  const reconciliationRows = useMemo(() => (reconciliationReport?.rows || []).map((row) => ({
    wallet: row.wallet,
    totalHarvestedFromEvents: row.totalHarvestedFromEvents || "",
    harvestedShown: row.harvestedShown || "",
    lifetimeShown: row.lifetimeShown || "",
    bankShown: row.bankShown || "",
    expectedHarvested: row.expectedHarvested || "",
    expectedLifetime: row.expectedLifetime || "",
    expectedBank: row.expectedBank || "",
    missing: row.missing || "",
    affected: row.affected || "no",
    recommendedCredit: row.recommendedCredit || "",
    repairable: row.repairable || "no",
    evidenceTxHashes: row.evidenceTxHashes || "",
    notes: row.notes || "",
  })), [reconciliationReport]);
  const affectedReconciliationRows = useMemo(() => reconciliationRows.filter((row) => row.affected === "yes"), [reconciliationRows]);
  const reconciliationFilename = useMemo(() => `energy-reconciliation-${new Date().toISOString().slice(0, 10)}`, []);

  async function getProvider() {
    return await walletService.getProvider() as Eip1193Provider;
  }

  async function signAdminAction(action: "snapshot" | "energy-airdrop" | "energy-reconciliation") {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const message = adminMessage(walletAddress, timestamp, nonce, action);
    const provider = await getProvider();
    const signature = await provider.request({ method: "personal_sign", params: [message, walletAddress] });
    setLastSignatureAt(new Date().toISOString());
    return { timestamp, nonce, signature };
  }

  function emptySnapshotSession(): SnapshotSession {
    return {
      discoveredWallets: [],
      discoveredTokenIds: [],
      tokenOwners: {},
      warnings: [],
      complete: false,
    };
  }

  async function generateSnapshot() {
    if (!walletAddress) {
      await connectOwnerWallet();
      return;
    }
    if (!authorized) return;
    setLoading(true);
    setError("");
    setSnapshot(null);
    let session = emptySnapshotSession();
    setSnapshotSession(session);
    setSnapshotProgress("Sign once to gather staking and blueprint data.");
    setAuthStatus("Sign once to gather staking and blueprint data.");
    try {
      const signature = await signAdminAction("snapshot");
      const signedPayload = {
        ...signature,
        wallet: walletAddress,
      };

      for (let step = 0; step < 80; step += 1) {
        setSnapshotProgress(step === 0 ? "Gathering current staked S1 token IDs." : snapshotGatherLabel(session));
        const data = await postSnapshotRequest({
          ...signedPayload,
          mode: "discover",
          cursor: session.cursor,
          discoveredTokenIds: session.discoveredTokenIds,
        }, 3) as SnapshotDiscoverResponse;
        session = mergeSnapshotSession(session, data);
        const label = snapshotGatherLabel(session);
        setSnapshotSession(session);
        setSnapshotProgress(label);
        setAuthStatus(label);
        if (session.complete) break;
        await sleep(150);
      }

      if (!session.complete) {
        throw new Error("Snapshot collection did not finish before the safety limit. Try again.");
      }

      setSnapshotProgress("Generating snapshot tables and CSV downloads.");
      setAuthStatus("Generating snapshot tables and CSV downloads.");
      const data = await postSnapshotRequest({
        ...signedPayload,
        mode: "finalize",
        discoveredWallets: session.discoveredWallets,
        discoveredTokenIds: session.discoveredTokenIds,
        tokenOwners: session.tokenOwners,
        discovery: session.discovery,
        warnings: session.warnings,
      }) as Snapshot;
      if (data?.ok === false) throw new Error("Admin snapshot failed.");
      setSnapshot(data);
      setAuthStatus("Snapshot generated.");
      setSnapshotProgress("Snapshot generated. CSV and JSON downloads are ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin snapshot failed.");
    } finally {
      setLoading(false);
    }
  }

  function resetSnapshotSession() {
    setSnapshotSession(null);
    setSnapshot(null);
    setError("");
    setSnapshotProgress("");
    setAuthStatus(authorized ? "Owner wallet connected. Sign to unlock snapshots." : "Connect owner wallet.");
  }

  async function connectOwnerWallet() {
    setError("");
    setSnapshotProgress("");
    setAuthStatus(walletAddress && !authorized ? "Switch to the configured owner wallet." : wrongNetwork ? "Switching wallet to Monad." : "Opening wallet connection.");
    try {
      if (wrongNetwork) {
        await walletService.switchChain();
        setAuthStatus("Wallet network switched. Verifying owner access.");
        return;
      }

      if (walletAddress && !authorized) {
        const provider = await walletService.getProvider().catch(() => null) as Eip1193Provider | null;
        if (provider) {
          await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] }).catch(() => undefined);
          await provider.request({ method: "eth_requestAccounts" }).catch(() => undefined);
        }
        await walletService.disconnect().catch(() => {});
        await sleep(150);
      }
      await walletService.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Wallet connection failed.";
      setError(message);
      setAuthStatus("Wallet connection failed.");
    }
  }

  function runSnapshotPrimaryAction() {
    if (!authenticated || !authorized) return void connectOwnerWallet();
    return void generateSnapshot();
  }

  const snapshotPrimaryLabel = !authenticated
    ? "Connect Owner Wallet"
    : wrongNetwork
      ? "Switch to Monad"
    : !authorized
      ? "Switch Owner Wallet"
    : loading
      ? "Generating Snapshot"
      : snapshot
        ? "Regenerate Snapshot"
        : "Generate Snapshot CSV";

  async function loadCsvFile(file?: File | null) {
    if (!file) return;
    const text = await file.text();
    setAirdropRecipientsInput((current) => [current, text].filter(Boolean).join("\n"));
    setAirdropStatus("CSV loaded. Review the preview before submitting.");
  }

  async function executeAirdrop() {
    if (!walletAddress) {
      await walletService.connect().catch(() => {});
      return;
    }
    if (!authorized) return;
    if (!airdropRecipients.length) {
      setAirdropStatus("Add at least one valid wallet.");
      return;
    }
    if (!airdropAmountRaw) {
      setAirdropStatus("Enter a positive Energy amount.");
      return;
    }
    if (!airdropCampaign.trim()) {
      setAirdropStatus("Enter a campaign ID.");
      return;
    }
    if (!airdropConfirm) {
      setAirdropStatus("Confirm the preview before submitting.");
      return;
    }

    setAirdropLoading(true);
    setAirdropResult(null);
    setAirdropStatus("Sign owner authorization for Energy airdrop.");
    try {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const message = adminMessage(walletAddress, timestamp, nonce, "energy-airdrop");
      const provider = await getProvider();
      const signature = await provider.request({ method: "personal_sign", params: [message, walletAddress] });
      setLastSignatureAt(new Date().toISOString());
      setAirdropStatus("Submitting airdrop transaction...");
      const response = await fetch("/api/admin/energy-airdrop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          timestamp,
          nonce,
          signature,
          recipients: airdropRecipients,
          amountRaw: airdropAmountRaw.toString(),
          campaignId: airdropCampaign.trim(),
          note: airdropNote.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      setAirdropResult(data as AirdropResult);
      if (!response.ok || (data?.ok === false && !data?.partial)) throw new Error(data?.error || "Energy airdrop failed.");
      setAirdropStatus(data.partial
        ? `Airdrop partially complete. ${data.successCount || 0} credited, ${data.skippedCount || 0} skipped, ${data.failureCount || 0} failed.`
        : `Airdrop complete. ${data.successCount || 0} credited, ${data.skippedCount || 0} skipped.`);
      setAirdropConfirm(false);
    } catch (err) {
      setAirdropStatus(err instanceof Error ? err.message : "Energy airdrop failed.");
    } finally {
      setAirdropLoading(false);
    }
  }

  async function loadEnergyReconciliation() {
    if (!walletAddress || !authorized) return;
    setReconciliationLoading(true);
    setReconciliationStatus("Sign owner authorization for Energy reconciliation.");
    setReconciliationResult(null);
    try {
      const signature = await signAdminAction("energy-reconciliation");
      setReconciliationStatus("Building Energy reconciliation report.");
      const response = await fetch("/api/admin/energy-reconciliation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...signature,
          wallet: walletAddress,
          mode: "report",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Energy reconciliation report failed.");
      setReconciliationReport(data.report as ReconciliationReport);
      const preflight = data.report?.repairPreflight;
      setReconciliationStatus(preflight?.ready === false
        ? `Report ready, but repair is blocked: ${preflight.reason || "Energy Bank operator preflight failed."}`
        : `Report ready. ${data.report?.affectedCount || 0} affected wallet(s), ${data.report?.totalRecommendedCredit || "0"} Energy recommended.`);
      setReconciliationConfirm(false);
    } catch (err) {
      setReconciliationStatus(err instanceof Error ? err.message : "Energy reconciliation report failed.");
    } finally {
      setReconciliationLoading(false);
    }
  }

  async function applyEnergyReconciliation() {
    if (!walletAddress || !authorized || !reconciliationReport) return;
    if (!reconciliationConfirm) {
      setReconciliationStatus("Confirm the reconciliation preview before applying credits.");
      return;
    }
    setReconciliationLoading(true);
    setReconciliationStatus("Sign owner authorization to apply reconciliation credits.");
    try {
      const signature = await signAdminAction("energy-reconciliation");
      setReconciliationStatus("Applying reconciliation credits in a safe batch.");
      const response = await fetch("/api/admin/energy-reconciliation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...signature,
          wallet: walletAddress,
          mode: "repair",
          limit: Number(reconciliationLimit || 10),
        }),
      });
      const data = await response.json().catch(() => ({}));
      setReconciliationResult(data as ReconciliationRepairResult);
      if (!response.ok || (data?.ok === false && !data?.partial)) throw new Error(data?.error || "Energy reconciliation repair failed.");
      setReconciliationStatus(data.partial
        ? `Repair partially complete. ${data.repair?.successCount || 0} credited, ${data.repair?.failureCount || 0} failed.`
        : `Repair batch complete. ${data.repair?.successCount || 0} credit(s) applied, ${data.repair?.skippedCount || 0} skipped.`);
      setReconciliationConfirm(false);
    } catch (err) {
      setReconciliationStatus(err instanceof Error ? err.message : "Energy reconciliation repair failed.");
    } finally {
      setReconciliationLoading(false);
    }
  }

  return (
    <PageShell>
      <Card strong className="energy-grid mb-8 p-6 md:p-8">
        <SectionHeader
          eyebrow="Owner Command"
          title="DYOOR Admin Command Center"
          copy="Owner-only command surface for protected snapshots and internal Energy operations. Every action requires the configured owner wallet, a fresh signature, timestamp, and nonce."
          actions={(
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <WalletButton />
              <Button variant="primary" onClick={runSnapshotPrimaryAction} disabled={loading}>{loading ? "Working..." : snapshotPrimaryLabel}</Button>
            </div>
          )}
        />
        <Alert tone={!walletAddress ? "warning" : authorized ? "success" : "danger"}>{authStatus}</Alert>
      </Card>

      {error && <Alert className="mb-6" tone="danger">{error}</Alert>}
      {snapshotProgress ? <Alert className="mb-6" tone={loading ? "busy" : "success"}>{snapshotProgress}</Alert> : null}
      {snapshotSession ? (
        <Card className="mb-6 p-5 md:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="eyebrow">Snapshot Builder</p>
              <h2 className="mt-2 text-xl font-black uppercase text-white">{snapshot ? "Exports Ready" : snapshotSession.complete ? "Generating Exports" : "Gathering Data"}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/62">{snapshotGatherLabel(snapshotSession)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={loading} onClick={runSnapshotPrimaryAction}>{snapshot ? "Regenerate" : "Generate"}</Button>
              <Button variant="ghost" disabled={loading} onClick={resetSnapshotSession}>Clear</Button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Status</p>
              <p className="mt-2 text-sm font-black text-white">{snapshot ? "Ready" : snapshotSession.complete ? "Finalizing" : "Gathering"}</p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Staked IDs Found</p>
              <p className="mt-2 text-sm font-black text-dyoor-cyan">{snapshotSession.discoveredTokenIds.length.toLocaleString()}</p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Contract Balance</p>
              <p className="mt-2 text-sm font-black text-white">{snapshotSession.discovery?.stakingContractBalance?.toLocaleString() || "-"}</p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Wallets Found</p>
              <p className="mt-2 text-sm font-black text-white">{(snapshot?.totals.walletsFound ?? snapshotSession.discoveredWallets.length).toLocaleString()}</p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Warnings</p>
              <p className="mt-2 text-sm font-black text-white">{snapshot ? (snapshot.warnings || []).length : snapshotSession.warnings.length}</p>
            </div>
          </div>
        </Card>
      ) : null}
      {!snapshot && snapshotSession?.warnings.length ? (
        <Alert className="mb-6" tone="warning">
          {snapshotSession.warnings.slice(-3).join(" ")}
        </Alert>
      ) : null}
      {snapshot?.warnings?.length ? (
        <Alert className="mb-6" tone="warning">
          {compactMessages(snapshot.warnings)}
        </Alert>
      ) : null}
      {loading && <Card className="mb-6 p-5"><LoadingSkeleton lines={5} /></Card>}

      <Card className="mb-6 p-5 md:p-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="eyebrow">Admin Status</p>
            <h2 className="mt-2 text-xl font-black uppercase text-white">Authorization Check</h2>
          </div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
            {authorized ? "Owner verified" : walletAddress ? "Wallet rejected" : "Wallet required"}
          </p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Connected Wallet</p>
            <p className="mt-2 break-all text-sm font-black text-white">{walletAddress ? shortAddress(walletAddress) : "Connect owner wallet"}</p>
          </div>
          <div className={`rounded border p-3 ${authorized ? "border-dyoor-cyan/35 bg-dyoor-cyan/10" : "border-yellow-300/25 bg-yellow-300/10"}`}>
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Owner Authorization</p>
            <p className={`mt-2 text-sm font-black ${authorized ? "text-dyoor-cyan" : "text-yellow-100"}`}>{authorized ? "Authorized" : walletAddress ? "Not authorized" : "Not connected"}</p>
          </div>
          <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Wallet Source</p>
            <p className="mt-2 text-sm font-black uppercase text-white">{walletService.providerName || walletService.source || "-"}</p>
          </div>
          <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Wallet State</p>
            <p className="mt-2 text-sm font-black uppercase text-white">{walletService.status}</p>
          </div>
          <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Wallet Control</p>
            <div className="mt-2">
              <WalletButton />
            </div>
          </div>
          <div className={`rounded border p-3 ${currentChainId && currentChainId.toLowerCase() !== MONAD_CHAIN_HEX ? "border-yellow-300/25 bg-yellow-300/10" : "border-dyoor-purple/25 bg-black/30"}`}>
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Current Network</p>
            <p className="mt-2 text-sm font-black uppercase text-white">{currentChainId ? currentChainId.toLowerCase() === MONAD_CHAIN_HEX ? "Monad" : currentChainId : "-"}</p>
          </div>
          <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Last Verified</p>
            <p className="mt-2 text-sm font-black text-white">{lastSignatureAt ? new Date(lastSignatureAt).toLocaleTimeString() : lastVerifiedAt ? new Date(lastVerifiedAt).toLocaleTimeString() : "-"}</p>
          </div>
          <div className={`rounded border p-3 ${adminBackend?.backendStatus === "ok" ? "border-dyoor-cyan/35 bg-dyoor-cyan/10" : "border-yellow-300/25 bg-yellow-300/10"}`}>
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Backend/API Status</p>
            <p className={`mt-2 text-sm font-black uppercase ${adminBackend?.backendStatus === "ok" ? "text-dyoor-cyan" : "text-yellow-100"}`}>{adminBackend?.backendStatus || "-"}</p>
          </div>
          <div className={`rounded border p-3 ${adminBackend?.snapshotSystemStatus === "ready" ? "border-dyoor-cyan/35 bg-dyoor-cyan/10" : "border-yellow-300/25 bg-yellow-300/10"}`}>
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Snapshot System</p>
            <p className={`mt-2 text-sm font-black uppercase ${adminBackend?.snapshotSystemStatus === "ready" ? "text-dyoor-cyan" : "text-yellow-100"}`}>{adminBackend?.snapshotSystemStatus || "-"}</p>
          </div>
        </div>
      </Card>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Wallets Found" value={snapshot?.totals.walletsFound ?? "-"} />
        <StatCard label="Total Staked" value={snapshot?.totals.totalStaked ?? "-"} />
        <StatCard label="Ascended S1 NFTs" value={snapshot?.totals.totalAscendedS1 ?? "-"} />
        <StatCard label="Pending Deposits" value={snapshot ? snapshot.totals.unregisteredDeposits ?? unregisteredDepositRows.length : "-"} />
        <StatCard label="Blueprints Saved" value={snapshot?.totals.totalBlueprintsSaved ?? "-"} />
        <StatCard label="Both Staked + Blueprint" value={snapshot?.totals.walletsWithBoth ?? "-"} />
        <StatCard label="Staked No Blueprint" value={snapshot?.totals.walletsStakedNoBlueprint ?? "-"} />
        <StatCard label="Blueprint No Stake" value={snapshot?.totals.walletsBlueprintNoStake ?? "-"} />
        <StatCard label="Validation" value={snapshot?.validation?.status ?? "-"} />
      </div>

      {snapshot ? (
        <Card className="mb-6 p-5 md:p-6">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <p className="eyebrow">Validation Summary</p>
              <h2 className="mt-2 text-xl font-black uppercase text-white">
                {snapshot.validation?.status === "verified" ? "Snapshot Verified" : snapshot.validation?.status === "failed" ? "Snapshot Not Verified" : "Snapshot Has Warnings"}
              </h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/58">
                Downloads are generated from normalized lowercase wallets. Failed validation means the snapshot should be treated as a debugging export, not a trusted eligibility list.
              </p>
            </div>
            <span className={`rounded border px-3 py-2 text-xs font-black uppercase ${snapshot.validation?.status === "verified" ? "border-dyoor-cyan/40 text-dyoor-cyan" : snapshot.validation?.status === "failed" ? "border-red-300/40 text-red-100" : "border-yellow-300/40 text-yellow-100"}`}>
              {snapshot.validation?.status || "pending"}
            </span>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_0.8fr]">
            <div className="rounded border border-white/10 bg-black/30 p-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-white/45">Checks</p>
              <div className="mt-3 grid gap-2">
                {(snapshot.validation?.checks || []).map((check, index) => (
                  <div className="rounded border border-white/10 bg-white/[0.035] p-3 text-sm font-bold text-white/68" key={`${check.scope}-${check.label}-${index}`}>
                    <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                      <span className="uppercase tracking-[0.08em] text-white">{check.label}</span>
                      <span className={check.status === "pass" ? "text-dyoor-cyan" : check.status === "fail" ? "text-red-200" : "text-yellow-100"}>{check.status}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-white/52">{check.detail}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded border border-white/10 bg-black/30 p-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-white/45">Data Sources</p>
              <div className="mt-3 grid gap-2 text-xs font-bold leading-5 text-white/58">
                {Object.entries(snapshot.dataSources || {}).map(([key, value]) => (
                  <p className="rounded border border-white/10 bg-white/[0.035] p-3" key={key}>
                    <span className="font-black uppercase tracking-[0.1em] text-dyoor-cyan">{key}</span>
                    <span className="mt-1 block break-words">{String(value)}</span>
                  </p>
                ))}
              </div>
            </div>
          </div>
          {snapshot.exportHistory?.length ? (
            <div className="mt-5 rounded border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-white/45">Export History</p>
              <div className="mt-3 grid gap-2 text-xs font-bold text-white/58 md:grid-cols-2 xl:grid-cols-3">
                {snapshot.exportHistory.slice(0, 6).map((entry, index) => (
                  <div className="rounded border border-white/10 bg-black/25 p-3" key={`${entry.generatedAt || index}`}>
                    <p className="text-white">{entry.generatedAt ? new Date(String(entry.generatedAt)).toLocaleString() : "-"}</p>
                    <p className="mt-1 uppercase text-dyoor-cyan">{String(entry.validationStatus || "-")}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded border border-dyoor-purple/25 bg-white/[0.035] p-4 text-sm font-bold text-white/62">
        <div className="grid gap-1">
        <span>Last generated: {snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleString() : "Not generated yet"}</span>
          {snapshot?.discovery ? (
            <span className="text-xs text-white/45">
              Collection: {(snapshot.totals.totalAscendedS1 || snapshot.totals.totalStaked || 0).toLocaleString()} staked S1 token IDs, {snapshot.totals.walletsFound.toLocaleString()} wallet rows
            </span>
          ) : null}
        </div>
        <Button variant="secondary" onClick={runSnapshotPrimaryAction} disabled={loading}>{snapshotPrimaryLabel}</Button>
      </div>

      <div className="grid gap-6">
        <SnapshotSection
          title="Ascension Staking Snapshot"
          description="Wallets, staked S1 counts, token IDs when available, pending Energy, lifetime Energy, ascended flag, and snapshot timestamp."
          rows={snapshot?.staking || []}
          csvFilename={snapshotFiles.stakingCsv}
          jsonFilename={snapshotFiles.stakingJson}
          jsonPayload={snapshot ? { generatedAt: snapshot.generatedAt, totals: snapshot.totals, validation: snapshot.validation, dataSources: snapshot.dataSources, rows: snapshot.staking } : undefined}
          validationStatus={snapshot?.validation?.status}
          dataSource={snapshot?.dataSources?.staking}
        />
        <SnapshotSection
          title="Ascended S1 NFT Snapshot"
          description="One row per ascended Season 1 NFT, including token ID, owner wallet, source, Energy values, and snapshot timestamp."
          rows={snapshot?.ascendedS1 || []}
          csvFilename={snapshotFiles.ascendedCsv}
          jsonFilename={snapshotFiles.ascendedJson}
          jsonPayload={snapshot ? { generatedAt: snapshot.generatedAt, totals: snapshot.totals, validation: snapshot.validation, dataSources: snapshot.dataSources, rows: snapshot.ascendedS1 || [] } : undefined}
          validationStatus={snapshot?.validation?.status}
          dataSource={snapshot?.dataSources?.stakingAuthority}
        />
        <SnapshotSection
          title="Pending / Unregistered Deposits"
          description="S1 NFTs currently held by the Ascension staking contract where stakeInfo does not return a registered staker. These are the old recovery-scan results."
          rows={unregisteredDepositRows}
          csvFilename={snapshotFiles.unregisteredCsv}
          jsonFilename={snapshotFiles.unregisteredJson}
          jsonPayload={snapshot ? { generatedAt: snapshot.generatedAt, totals: snapshot.totals, validation: snapshot.validation, dataSources: snapshot.dataSources, rows: unregisteredDepositRows } : undefined}
          validationStatus={unregisteredDepositRows.length ? "warning" : snapshot?.validation?.status}
          dataSource="S1 ownerOf(tokenId) + Ascension stakeInfo(tokenId)"
        />
        <SnapshotSection
          title="Blueprint Snapshot"
          description="Saved Blueprint records with wallet, timestamp, blueprint ID, image URL, ordered traits, and eligibility/status flag."
          rows={snapshot?.blueprints || []}
          csvFilename={snapshotFiles.blueprintCsv}
          jsonFilename={snapshotFiles.blueprintJson}
          jsonPayload={snapshot ? { generatedAt: snapshot.generatedAt, totals: snapshot.totals, validation: snapshot.validation, dataSources: snapshot.dataSources, latestRows: snapshot.blueprints, allVersions: snapshot.blueprintVersions || [] } : undefined}
          validationStatus={snapshot?.validation?.status}
          dataSource={snapshot?.dataSources?.blueprint}
        />
        <SnapshotSection
          title="Combined Ascension Snapshot"
          description="Matched staking and saved Blueprint data by wallet for partner review and campaign analysis."
          rows={snapshot?.combined || []}
          csvFilename={snapshotFiles.combinedCsv}
          jsonFilename={snapshotFiles.combinedJson}
          jsonPayload={snapshot ? { generatedAt: snapshot.generatedAt, totals: snapshot.totals, validation: snapshot.validation, dataSources: snapshot.dataSources, rows: snapshot.combined } : undefined}
          validationStatus={snapshot?.validation?.status}
          dataSource="staking + blueprint"
        />

        <Card className="p-5 md:p-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div>
              <p className="eyebrow">Owner Tool</p>
              <h2 className="mt-2 text-2xl font-black uppercase text-white">Energy Airdrop</h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-white/60">
                Credit internal Energy to one wallet or a deduped bulk list. Requires owner signature and an Energy Bank operator with admin permissions.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!airdropRows.length} onClick={() => downloadFile(`${filenameBase}-energy-airdrop.csv`, toCsv(airdropRows), "text/csv")}>Export CSV</Button>
              <Button variant="ghost" disabled={!airdropRows.length} onClick={() => downloadFile(`${filenameBase}-energy-airdrop.json`, JSON.stringify(airdropResult, null, 2), "application/json")}>Export JSON</Button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
            <div className="space-y-3">
              <textarea
                className="min-h-40 w-full rounded border border-white/15 bg-black/35 p-3 text-sm font-bold text-white outline-none focus:border-dyoor-cyan"
                placeholder="Paste wallets, one per line or comma-separated"
                value={airdropRecipientsInput}
                onChange={(event) => setAirdropRecipientsInput(event.target.value)}
              />
              <input
                className="block w-full rounded border border-white/15 bg-black/35 p-3 text-sm font-bold text-white file:mr-3 file:rounded file:border-0 file:bg-dyoor-cyan file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:text-black"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) => void loadCsvFile(event.target.files?.[0])}
              />
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  className="field-control"
                  placeholder="Energy each, e.g. 25000"
                  inputMode="decimal"
                  value={airdropAmount}
                  onChange={(event) => setAirdropAmount(event.target.value)}
                />
                <input
                  className="field-control"
                  placeholder="Campaign ID"
                  value={airdropCampaign}
                  onChange={(event) => setAirdropCampaign(event.target.value)}
                />
              </div>
              <textarea
                className="min-h-24 w-full rounded border border-white/15 bg-black/35 p-3 text-sm font-bold text-white outline-none focus:border-dyoor-cyan"
                placeholder="Optional note or reason, stored in the result export"
                value={airdropNote}
                onChange={(event) => setAirdropNote(event.target.value)}
              />
            </div>

            <div className="rounded border border-dyoor-purple/25 bg-black/35 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Preview</p>
              <div className="mt-4 grid gap-3 text-sm font-black text-white/70">
                <div className="rounded border border-white/10 bg-white/[0.035] p-3">Raw entries: <span className="text-dyoor-cyan">{parsedAirdropRecipients.rawCount}</span></div>
                <div className="rounded border border-white/10 bg-white/[0.035] p-3">Valid wallets: <span className="text-dyoor-cyan">{airdropRecipients.length}</span></div>
                <div className="rounded border border-white/10 bg-white/[0.035] p-3">Duplicates removed: <span className="text-dyoor-cyan">{parsedAirdropRecipients.duplicates.length}</span></div>
                <div className={`rounded border p-3 ${parsedAirdropRecipients.invalid.length ? "border-red-400/35 bg-red-400/10 text-red-100" : "border-white/10 bg-white/[0.035]"}`}>Invalid entries: <span className="text-dyoor-cyan">{parsedAirdropRecipients.invalid.length}</span></div>
                <div className="rounded border border-white/10 bg-white/[0.035] p-3">Energy each: <span className="text-dyoor-cyan">{airdropAmountRaw ? formatUnits(airdropAmountRaw, 18) : "-"}</span></div>
                <div className="rounded border border-white/10 bg-white/[0.035] p-3">Total Energy: <span className="text-dyoor-cyan">{airdropTotalRaw ? formatUnits(airdropTotalRaw, 18) : "-"}</span></div>
                <div className="rounded border border-white/10 bg-white/[0.035] p-3">Estimated actions: <span className="text-dyoor-cyan">{estimatedActionCount}</span></div>
                {(parsedAirdropRecipients.invalid.length > 0 || parsedAirdropRecipients.duplicates.length > 0) && (
                  <div className="rounded border border-yellow-300/25 bg-yellow-300/10 p-3 text-yellow-100">
                    {parsedAirdropRecipients.invalid.length > 0 && <p className="break-words">Invalid: {parsedAirdropRecipients.invalid.slice(0, 6).join(", ")}{parsedAirdropRecipients.invalid.length > 6 ? "..." : ""}</p>}
                    {parsedAirdropRecipients.duplicates.length > 0 && <p className="mt-1 break-words">Duplicates: {parsedAirdropRecipients.duplicates.slice(0, 6).map(shortAddress).join(", ")}{parsedAirdropRecipients.duplicates.length > 6 ? "..." : ""}</p>}
                  </div>
                )}
                <label className="flex items-start gap-3 rounded border border-white/10 bg-white/[0.035] p-3 text-sm font-bold">
                  <input className="mt-1" type="checkbox" checked={airdropConfirm} onChange={(event) => setAirdropConfirm(event.target.checked)} />
                  I reviewed the valid wallet count, removed duplicates, invalid entries, Energy amount, and campaign ID.
                </label>
              </div>
              <Button
                className="mt-4 w-full"
                variant="primary"
                disabled={!authorized || airdropLoading || !airdropConfirm || !airdropRecipients.length || !airdropAmountRaw}
                onClick={() => void executeAirdrop()}
              >
                {airdropLoading ? "Airdrop Running..." : "Submit Energy Airdrop"}
              </Button>
              <Alert className="mt-4" tone={airdropResult?.ok ? "success" : airdropResult?.partial ? "warning" : airdropLoading ? "busy" : airdropResult?.error ? "danger" : "idle"}>
                {airdropStatus}
              </Alert>
              {airdropResult?.txHash && (
                <p className="mt-3 break-all text-sm font-bold text-dyoor-cyan">Tx: {airdropResult.txHash}</p>
              )}
              {airdropResult && (
                <div className="mt-4 rounded border border-white/10 bg-white/[0.035] p-3 text-sm font-bold text-white/65">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <p>Successful: <span className="text-dyoor-cyan">{airdropResult.successCount ?? airdropResult.successfulWallets?.length ?? 0}</span></p>
                    <p>Skipped: <span className="text-yellow-100">{airdropResult.skippedCount ?? airdropResult.skippedWallets?.length ?? 0}</span></p>
                    <p>Failed: <span className="text-red-200">{airdropResult.failureCount ?? airdropResult.failedWallets?.length ?? 0}</span></p>
                    <p>Total credited: <span className="text-dyoor-cyan">{airdropResult.totalRaw ? formatUnits(BigInt(airdropResult.totalRaw), 18) : "0"}</span></p>
                    <p>Batches: <span className="text-dyoor-cyan">{airdropResult.batchCount || 0}</span></p>
                    <p>Mode: <span className="text-dyoor-cyan">{airdropResult.executionMode || "-"}</span></p>
                  </div>
                  {airdropResult.actionId && <p className="mt-2 break-all text-white/50">Action ID: {airdropResult.actionId}</p>}
                  {airdropRows.length > 0 && (
                    <div className="mt-3 max-h-60 overflow-auto rounded border border-white/10 bg-black/30">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-white/[0.04] uppercase tracking-[0.12em] text-white/40">
                          <tr>
                            <th className="px-3 py-2">Wallet</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Tx</th>
                          </tr>
                        </thead>
                        <tbody>
                          {airdropRows.slice(0, 40).map((row, index) => (
                            <tr className="border-t border-white/8" key={`${row.wallet}-${index}`}>
                              <td className="px-3 py-2 text-white/70">{shortAddress(String(row.wallet))}</td>
                              <td className={row.status === "success" ? "px-3 py-2 text-dyoor-cyan" : row.status === "skipped" ? "px-3 py-2 text-yellow-100" : "px-3 py-2 text-red-200"}>{String(row.status || "")}</td>
                              <td className="max-w-36 truncate px-3 py-2 text-white/45">{row.txHash || row.error || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-5 md:p-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div>
              <p className="eyebrow">Owner Tool</p>
              <h2 className="mt-2 text-2xl font-black uppercase text-white">Energy Reconciliation</h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-white/60">
                Compare indexed Ascension harvests against Energy Bank balances, export affected wallets, and apply missing harvest credits only when claim keys have not already been used.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={reconciliationLoading || !authorized} onClick={() => void loadEnergyReconciliation()}>
                {reconciliationLoading ? "Working..." : "Load Report"}
              </Button>
              <Button
                variant="secondary"
                disabled={!reconciliationRows.length}
                onClick={() => downloadFile(`${reconciliationFilename}.csv`, toCsv(reconciliationRows), "text/csv")}
              >
                Export CSV
              </Button>
              <Button
                variant="ghost"
                disabled={!reconciliationReport}
                onClick={() => downloadFile(`${reconciliationFilename}.json`, JSON.stringify(reconciliationReport, null, 2), "application/json")}
              >
                Export JSON
              </Button>
            </div>
          </div>

          <Alert className="mt-5" tone={reconciliationLoading ? "busy" : reconciliationResult?.error ? "danger" : reconciliationReport ? "success" : "idle"}>
            {reconciliationStatus}
          </Alert>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Wallets Checked</p>
              <p className="mt-2 text-sm font-black text-white">{reconciliationReport?.rowCount ?? "-"}</p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Affected</p>
              <p className="mt-2 text-sm font-black text-dyoor-cyan">{reconciliationReport?.affectedCount ?? "-"}</p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Missing Energy</p>
              <p className="mt-2 text-sm font-black text-white">{reconciliationReport?.totalMissing ?? "-"}</p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Recommended Credit</p>
              <p className="mt-2 text-sm font-black text-white">{reconciliationReport?.totalRecommendedCredit ?? "-"}</p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Indexed Block</p>
              <p className="mt-2 text-sm font-black text-white">{reconciliationReport?.indexedBlock?.toLocaleString() ?? "-"}</p>
            </div>
            <div className={`rounded border p-3 ${reconciliationReport?.repairPreflight?.ready ? "border-dyoor-cyan/30 bg-dyoor-cyan/10" : "border-yellow-300/25 bg-yellow-300/10"}`}>
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Repair Preflight</p>
              <p className={`mt-2 text-sm font-black ${reconciliationReport?.repairPreflight?.ready ? "text-dyoor-cyan" : "text-yellow-100"}`}>
                {reconciliationReport ? reconciliationReport.repairPreflight?.ready ? "Ready" : "Blocked" : "-"}
              </p>
            </div>
          </div>

          {reconciliationReport?.repairPreflight ? (
            <div className="mt-4 grid gap-3 rounded border border-white/10 bg-white/[0.03] p-4 text-xs font-bold text-white/58 md:grid-cols-2 xl:grid-cols-4">
              <p>Operator: <span className="text-white">{shortAddress(reconciliationReport.repairPreflight.operator || "")}</span></p>
              <p>Chain: <span className="text-white">{reconciliationReport.repairPreflight.chainId || "-"}</span></p>
              <p>Credit Role: <span className={reconciliationReport.repairPreflight.hasCreditRole ? "text-dyoor-cyan" : "text-yellow-100"}>{String(reconciliationReport.repairPreflight.hasCreditRole)}</span></p>
              <p>Paused: <span className={reconciliationReport.repairPreflight.paused ? "text-red-200" : "text-dyoor-cyan"}>{String(reconciliationReport.repairPreflight.paused)}</span></p>
              {reconciliationReport.repairPreflight.reason ? (
                <p className="md:col-span-2 xl:col-span-4">Reason: <span className="text-yellow-100">{reconciliationReport.repairPreflight.reason}</span></p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.72fr]">
            <div className="rounded border border-dyoor-purple/25 bg-black/35 p-4">
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Affected Preview</p>
                  <p className="mt-1 text-sm font-semibold text-white/55">Only wallets with missing usable Energy are shown here.</p>
                </div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
                  {affectedReconciliationRows.length} row(s)
                </p>
              </div>
              {!affectedReconciliationRows.length ? (
                <EmptyState className="mt-4" title="No Affected Wallets Loaded" copy="Load the report to check indexed harvests against Energy Bank balances." />
              ) : (
                <div className="mt-4 max-h-80 overflow-auto rounded border border-white/10 bg-black/30">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-white/[0.04] uppercase tracking-[0.12em] text-white/40">
                      <tr>
                        <th className="px-3 py-2">Wallet</th>
                        <th className="px-3 py-2">Harvested</th>
                        <th className="px-3 py-2">Bank</th>
                        <th className="px-3 py-2">Missing</th>
                        <th className="px-3 py-2">Credit</th>
                        <th className="px-3 py-2">Repairable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {affectedReconciliationRows.slice(0, 60).map((row, index) => (
                        <tr className="border-t border-white/8" key={`${row.wallet}-${index}`}>
                          <td className="px-3 py-2 font-black text-white/75">{shortAddress(row.wallet)}</td>
                          <td className="px-3 py-2 text-white/60">{row.expectedHarvested || "-"}</td>
                          <td className="px-3 py-2 text-white/60">{row.bankShown || "-"}</td>
                          <td className="px-3 py-2 text-yellow-100">{row.missing || "-"}</td>
                          <td className="px-3 py-2 text-dyoor-cyan">{row.recommendedCredit || "-"}</td>
                          <td className={row.repairable === "yes" ? "px-3 py-2 text-dyoor-cyan" : "px-3 py-2 text-red-200"}>{row.repairable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded border border-dyoor-purple/25 bg-black/35 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Repair Batch</p>
              <label className="mt-4 block text-xs font-black uppercase tracking-[0.16em] text-white/45" htmlFor="reconciliation-limit">
                Max repair actions this run
              </label>
              <input
                id="reconciliation-limit"
                className="field-control mt-2"
                inputMode="numeric"
                value={reconciliationLimit}
                onChange={(event) => setReconciliationLimit(event.target.value.replace(/[^\d]/g, ""))}
              />
              <p className="mt-2 text-xs font-semibold leading-5 text-white/45">
                This is a count of wallet credit actions, not an Energy amount. The server caps each run at 25 actions.
              </p>
              <label className="mt-4 flex items-start gap-3 rounded border border-white/10 bg-white/[0.035] p-3 text-sm font-bold text-white/70">
                <input className="mt-1" type="checkbox" checked={reconciliationConfirm} onChange={(event) => setReconciliationConfirm(event.target.checked)} />
                I reviewed the affected-wallet preview and understand this will credit missing harvest Energy in the Energy Bank.
              </label>
              <Button
                className="mt-4 w-full"
                variant="primary"
                disabled={!authorized || reconciliationLoading || !reconciliationReport || reconciliationReport.repairPreflight?.ready === false || !affectedReconciliationRows.length || !reconciliationConfirm}
                onClick={() => void applyEnergyReconciliation()}
              >
                {reconciliationLoading ? "Repair Running..." : "Apply Next Credit Batch"}
              </Button>
              <p className="mt-3 break-all text-xs font-semibold text-white/45">
                Energy Bank: {reconciliationReport?.energyBankAddress || "-"}
              </p>
              {reconciliationResult?.repair && (
                <div className="mt-4 rounded border border-white/10 bg-white/[0.035] p-3 text-sm font-bold text-white/65">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <p>Credited: <span className="text-dyoor-cyan">{reconciliationResult.repair.successCount || 0}</span></p>
                    <p>Skipped: <span className="text-white">{reconciliationResult.repair.skippedCount || 0}</span></p>
                    <p>Failed: <span className="text-red-200">{reconciliationResult.repair.failureCount || 0}</span></p>
                  </div>
                  {reconciliationResult.repair.preflight?.reason ? (
                    <p className="mt-3 break-words text-xs text-yellow-100">{reconciliationResult.repair.preflight.reason}</p>
                  ) : null}
                  <div className="mt-3 max-h-52 overflow-auto rounded border border-white/10 bg-black/30">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-white/[0.04] uppercase tracking-[0.12em] text-white/40">
                        <tr>
                          <th className="px-3 py-2">Wallet</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Tx / Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(reconciliationResult.repair.results || []).map((row, index) => (
                          <tr className="border-t border-white/8" key={`${row.wallet || index}-${index}`}>
                            <td className="px-3 py-2 text-white/70">{shortAddress(String(row.wallet || ""))}</td>
                            <td className={row.status === "success" ? "px-3 py-2 text-dyoor-cyan" : row.status === "failed" ? "px-3 py-2 text-red-200" : "px-3 py-2 text-yellow-100"}>{String(row.status || "")}</td>
                            <td className="min-w-64 max-w-[28rem] whitespace-normal break-words px-3 py-2 text-white/45">
                              {String(row.creditTxHash || row.error || row.reason || "-")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
