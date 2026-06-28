"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Alert, Button, Card, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { adminMessage } from "@/lib/adminMessage";
import { MONAD_CHAIN_HEX } from "@/lib/monad";
import { useWalletService } from "@/providers/WalletServiceProvider";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type Snapshot = {
  ok?: boolean;
  generatedAt: string;
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
  };
  totals: {
    walletsFound: number;
    totalStaked: number;
    totalAscendedS1?: number;
    ascendedS1Wallets?: number;
    totalBlueprintsSaved: number;
  };
  staking: Array<Record<string, any>>;
  ascendedS1?: Array<Record<string, any>>;
  blueprints: Array<Record<string, any>>;
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
  timestamp: string;
  nonce: string;
  signature: unknown;
  cursor?: SnapshotCursor;
  discoveredWallets: string[];
  discoveredTokenIds: string[];
  tokenOwners: Record<string, string>;
  discovery?: Snapshot["discovery"];
  warnings: string[];
  complete: boolean;
};

type AirdropResult = {
  ok?: boolean;
  partial?: boolean;
  recipients?: string[];
  recipientCount?: number;
  successfulWallets?: string[];
  failedWallets?: Array<{ wallet: string; error?: string }>;
  successCount?: number;
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
  };
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
  const esc = (value: unknown) => `"${String(Array.isArray(value) ? value.join(" ") : value ?? "").replaceAll("\"", "\"\"")}"`;
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

function snapshotSessionLabel(session: SnapshotSession) {
  const discovery = session.discovery;
  if (!discovery) return "Snapshot scan signed. Scan the first range.";
  if (discovery.scanMode === "ownerOf") {
    const tokenLabel = discovery.maxTokenId
      ? `${(discovery.lastScannedTokenId || 0).toLocaleString()} / ${discovery.maxTokenId.toLocaleString()}`
      : `${discovery.lastScannedTokenId || 0}`;
    const stakedLabel = `${session.discoveredTokenIds.length} staked token${session.discoveredTokenIds.length === 1 ? "" : "s"}`;
    return session.complete
      ? `Exact S1 owner scan complete: ${tokenLabel}. Found ${stakedLabel}.`
      : `Exact S1 owner scan: ${tokenLabel}. Found ${stakedLabel}.`;
  }
  if (discovery.scanMode === "goldsky-events") {
    const blockLabel = discovery.latestBlock ? discovery.latestBlock.toLocaleString() : "latest indexed block";
    const stakedLabel = `${session.discoveredTokenIds.length} active staked token${session.discoveredTokenIds.length === 1 ? "" : "s"}`;
    return `Goldsky Ascension index complete at block ${blockLabel}. Found ${stakedLabel}.`;
  }
  const blockLabel = discovery.latestBlock
    ? `${(discovery.lastScannedBlock || 0).toLocaleString()} / ${discovery.latestBlock.toLocaleString()}`
    : `${discovery.lastScannedBlock || 0}`;
  const tokenLabel = `${session.discoveredTokenIds.length} token ID${session.discoveredTokenIds.length === 1 ? "" : "s"}`;
  return session.complete
    ? `Discovery complete at block ${blockLabel}. Found ${tokenLabel}.`
    : `Scanned Ascension logs: ${blockLabel}. Found ${tokenLabel}.`;
}

function SnapshotSection({
  rows,
  title,
  description,
  filename,
}: {
  rows: Array<Record<string, any>>;
  title: string;
  description: string;
  filename: string;
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
          <Button variant="secondary" disabled={!filteredRows.length} onClick={() => downloadFile(`${filename}.csv`, toCsv(filteredRows), "text/csv")}>Download CSV</Button>
          <Button variant="ghost" disabled={!filteredRows.length} onClick={() => downloadFile(`${filename}.json`, JSON.stringify(filteredRows, null, 2), "application/json")}>Download JSON</Button>
        </div>
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
  const authenticated = walletService.connected;
  const walletAddress = normalizeAddress(walletService.address);
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
        return;
      }
      const response = await fetch(`/api/admin/snapshots?wallet=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      const provider = await walletService.getProvider().catch(() => null) as Eip1193Provider | null;
      const chainId = provider ? await provider.request({ method: "eth_chainId" }).catch(() => "") : "";
      if (!active) return;
      setAuthorized(Boolean(data.authorized));
      setAuthStatus(data.authorized ? "Owner wallet connected. Sign to unlock snapshots." : "Not authorized.");
      setCurrentChainId(String(chainId || ""));
      setLastVerifiedAt(new Date().toISOString());
    }
    void checkOwner();
    return () => {
      active = false;
    };
  }, [walletAddress, walletService]);

  const filenameBase = useMemo(() => `dyoor-admin-${stamp(snapshot?.generatedAt)}`, [snapshot?.generatedAt]);
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

  async function createSnapshotSession() {
    if (!walletAddress) {
      await walletService.connect().catch(() => {});
      return null;
    }
    if (!authorized) return null;
    setSnapshotProgress("Sign owner authorization for snapshot exports.");
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const message = adminMessage(walletAddress, timestamp, nonce, "snapshot");
    const provider = await getProvider();
    const signature = await provider.request({ method: "personal_sign", params: [message, walletAddress] });
    const session: SnapshotSession = {
      timestamp,
      nonce,
      signature,
      discoveredWallets: [],
      discoveredTokenIds: [],
      tokenOwners: {},
      warnings: [],
      complete: false,
    };
    setLastSignatureAt(new Date().toISOString());
    setSnapshotSession(session);
    setSnapshot(null);
    setAuthStatus("Snapshot signed. Scan the first range.");
    setSnapshotProgress("Snapshot signed. Scan the first range.");
    return session;
  }

  async function startSnapshotSession() {
    setLoading(true);
    setError("");
    try {
      await createSnapshotSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin snapshot failed.");
    } finally {
      setLoading(false);
    }
  }

  async function scanSnapshotRange() {
    setLoading(true);
    setError("");
    try {
      const session = snapshotSession || await createSnapshotSession();
      if (!session) return;
      setSnapshotProgress("Scanning next Ascension log range.");
      const data = await postSnapshotRequest({
        mode: "discover",
        wallet: walletAddress,
        timestamp: session.timestamp,
        nonce: session.nonce,
        signature: session.signature,
        cursor: session.cursor,
      }) as SnapshotDiscoverResponse;
      const nextSession = mergeSnapshotSession(session, data);
      const label = snapshotSessionLabel(nextSession);
      setSnapshotSession(nextSession);
      setSnapshotProgress(label);
      setAuthStatus(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin snapshot failed.");
    } finally {
      setLoading(false);
    }
  }

  async function finalizeSnapshotSession() {
    if (!snapshotSession) {
      setError("Start a snapshot scan first.");
      return;
    }
    setLoading(true);
    setError("");
    setSnapshotProgress("Building snapshot export tables.");
    setAuthStatus("Building snapshot export tables.");
    try {
      const data = await postSnapshotRequest({
        mode: "finalize",
        wallet: walletAddress,
        timestamp: snapshotSession.timestamp,
        nonce: snapshotSession.nonce,
        signature: snapshotSession.signature,
        discoveredWallets: snapshotSession.discoveredWallets,
        discoveredTokenIds: snapshotSession.discoveredTokenIds,
        tokenOwners: snapshotSession.tokenOwners,
        discovery: snapshotSession.discovery,
        warnings: snapshotSession.warnings,
      }, 3) as Snapshot;
      if (data?.ok === false) throw new Error("Admin snapshot failed.");
      setSnapshot(data);
      setAuthStatus("Snapshot generated.");
      setSnapshotProgress("Snapshot export tables built.");
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

  function runSnapshotPrimaryAction() {
    if (!authenticated) return void walletService.connect();
    if (!snapshotSession) return void startSnapshotSession();
    if (!snapshotSession.complete) return void scanSnapshotRange();
    if (!snapshot) return void finalizeSnapshotSession();
    resetSnapshotSession();
  }

  const snapshotPrimaryLabel = !authenticated
    ? "Connect Owner Wallet"
    : !snapshotSession
      ? "Start Snapshot"
      : !snapshotSession.complete
        ? "Scan Next Range"
        : !snapshot
          ? "Build Exports"
          : "New Snapshot";

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
        ? `Airdrop partially complete. ${data.successCount || 0} credited, ${data.failureCount || 0} failed.`
        : `Airdrop complete. ${data.successCount || data.recipientCount || airdropRecipients.length} wallets credited.`);
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
      setReconciliationStatus(`Report ready. ${data.report?.affectedCount || 0} affected wallet(s), ${data.report?.totalRecommendedCredit || "0"} Energy recommended.`);
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
          actions={<Button variant="primary" onClick={runSnapshotPrimaryAction} disabled={loading || (authenticated && !authorized)}>{loading ? "Working..." : snapshotPrimaryLabel}</Button>}
        />
        <Alert tone={!walletAddress ? "warning" : authorized ? "success" : "danger"}>{authStatus}</Alert>
      </Card>

      {error && <Alert className="mb-6" tone="danger">{error}</Alert>}
      {snapshotProgress ? <Alert className="mb-6" tone={loading ? "busy" : "success"}>{snapshotProgress}</Alert> : null}
      {snapshotSession ? (
        <Card className="mb-6 p-5 md:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="eyebrow">Snapshot Session</p>
              <h2 className="mt-2 text-xl font-black uppercase text-white">{snapshotSession.complete ? "Discovery Complete" : "Discovery In Progress"}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/62">{snapshotSessionLabel(snapshotSession)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={loading || snapshotSession.complete} onClick={() => void scanSnapshotRange()}>Scan Next Range</Button>
              <Button variant="primary" disabled={loading || !snapshotSession.complete} onClick={() => void finalizeSnapshotSession()}>Build Exports</Button>
              <Button variant="ghost" disabled={loading} onClick={resetSnapshotSession}>Reset</Button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Last Scanned</p>
              <p className="mt-2 text-sm font-black text-white">
                {snapshotSession.discovery?.scanMode === "ownerOf"
                  ? snapshotSession.discovery?.lastScannedTokenId?.toLocaleString() || "-"
                  : snapshotSession.discovery?.lastScannedBlock?.toLocaleString() || "-"}
              </p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">
                {snapshotSession.discovery?.scanMode === "ownerOf" ? "Max Token" : "Latest Block"}
              </p>
              <p className="mt-2 text-sm font-black text-white">
                {snapshotSession.discovery?.scanMode === "ownerOf"
                  ? snapshotSession.discovery?.maxTokenId?.toLocaleString() || "-"
                  : snapshotSession.discovery?.latestBlock?.toLocaleString() || "-"}
              </p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Next Batch</p>
              <p className="mt-2 text-sm font-black text-white">
                {snapshotSession.discovery?.scanMode === "ownerOf"
                  ? snapshotSession.cursor?.batchTokens?.toLocaleString() || snapshotSession.discovery?.batchTokens?.toLocaleString() || "-"
                  : snapshotSession.cursor?.batchBlocks?.toLocaleString() || snapshotSession.discovery?.chunkSize?.toLocaleString() || "-"}
              </p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Staked IDs</p>
              <p className="mt-2 text-sm font-black text-dyoor-cyan">{snapshotSession.discoveredTokenIds.length}</p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Warnings</p>
              <p className="mt-2 text-sm font-black text-white">{snapshotSession.warnings.length}</p>
            </div>
          </div>
        </Card>
      ) : null}
      {snapshotSession?.warnings.length ? (
        <Alert className="mb-6" tone="warning">
          {snapshotSession.warnings.slice(-3).join(" ")}
        </Alert>
      ) : null}
      {snapshot?.warnings?.length ? (
        <Alert className="mb-6" tone="warning">
          {snapshot.warnings.join(" ")}
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
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
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
          <div className={`rounded border p-3 ${currentChainId && currentChainId.toLowerCase() !== MONAD_CHAIN_HEX ? "border-yellow-300/25 bg-yellow-300/10" : "border-dyoor-purple/25 bg-black/30"}`}>
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Current Network</p>
            <p className="mt-2 text-sm font-black uppercase text-white">{currentChainId ? currentChainId.toLowerCase() === MONAD_CHAIN_HEX ? "Monad" : currentChainId : "-"}</p>
          </div>
          <div className="rounded border border-dyoor-purple/25 bg-black/30 p-3">
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Last Verified</p>
            <p className="mt-2 text-sm font-black text-white">{lastSignatureAt ? new Date(lastSignatureAt).toLocaleTimeString() : lastVerifiedAt ? new Date(lastVerifiedAt).toLocaleTimeString() : "-"}</p>
          </div>
        </div>
      </Card>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Wallets Found" value={snapshot?.totals.walletsFound ?? "-"} />
        <StatCard label="Total Staked" value={snapshot?.totals.totalStaked ?? "-"} />
        <StatCard label="Ascended S1 NFTs" value={snapshot?.totals.totalAscendedS1 ?? "-"} />
        <StatCard label="Blueprints Saved" value={snapshot?.totals.totalBlueprintsSaved ?? "-"} />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded border border-dyoor-purple/25 bg-white/[0.035] p-4 text-sm font-bold text-white/62">
        <div className="grid gap-1">
        <span>Last generated: {snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleString() : "Not generated yet"}</span>
          {snapshot?.discovery ? (
            <span className="text-xs text-white/45">
              Log scan: {snapshot.discovery.lastScannedBlock?.toLocaleString() || "-"} / {snapshot.discovery.latestBlock?.toLocaleString() || "-"} blocks, {snapshot.discovery.chunksScanned || 0} chunks
            </span>
          ) : null}
        </div>
        <Button variant="secondary" onClick={runSnapshotPrimaryAction} disabled={!authorized || loading}>{snapshotPrimaryLabel}</Button>
      </div>

      <div className="grid gap-6">
        <SnapshotSection
          title="Ascension Staking Snapshot"
          description="Wallets, staked S1 counts, token IDs when available, pending Energy, lifetime Energy, ascended flag, and snapshot timestamp."
          rows={snapshot?.staking || []}
          filename={`${filenameBase}-staking`}
        />
        <SnapshotSection
          title="Ascended S1 NFT Snapshot"
          description="One row per ascended Season 1 NFT, including token ID, owner wallet, source, Energy values, and snapshot timestamp."
          rows={snapshot?.ascendedS1 || []}
          filename={`${filenameBase}-ascended-s1`}
        />
        <SnapshotSection
          title="Blueprint Snapshot"
          description="Saved Blueprint records with wallet, timestamp, blueprint ID, image URL, ordered traits, and eligibility/status flag."
          rows={snapshot?.blueprints || []}
          filename={`${filenameBase}-blueprints`}
        />
        <SnapshotSection
          title="Combined Ascension Snapshot"
          description="Matched staking and saved Blueprint data by wallet for partner review and campaign analysis."
          rows={snapshot?.combined || []}
          filename={`${filenameBase}-combined`}
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
                    <p>Failed: <span className="text-red-200">{airdropResult.failureCount ?? airdropResult.failedWallets?.length ?? 0}</span></p>
                    <p>Total credited: <span className="text-dyoor-cyan">{airdropResult.totalRaw ? formatUnits(BigInt(airdropResult.totalRaw), 18) : "0"}</span></p>
                    <p>Batches: <span className="text-dyoor-cyan">{airdropResult.batchCount || 0}</span></p>
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
                              <td className={row.status === "success" ? "px-3 py-2 text-dyoor-cyan" : "px-3 py-2 text-red-200"}>{String(row.status || "")}</td>
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

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
          </div>

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
                Max credits this batch
              </label>
              <input
                id="reconciliation-limit"
                className="field-control mt-2"
                inputMode="numeric"
                value={reconciliationLimit}
                onChange={(event) => setReconciliationLimit(event.target.value.replace(/[^\d]/g, ""))}
              />
              <label className="mt-4 flex items-start gap-3 rounded border border-white/10 bg-white/[0.035] p-3 text-sm font-bold text-white/70">
                <input className="mt-1" type="checkbox" checked={reconciliationConfirm} onChange={(event) => setReconciliationConfirm(event.target.checked)} />
                I reviewed the affected-wallet preview and understand this will credit missing harvest Energy in the Energy Bank.
              </label>
              <Button
                className="mt-4 w-full"
                variant="primary"
                disabled={!authorized || reconciliationLoading || !reconciliationReport || !affectedReconciliationRows.length || !reconciliationConfirm}
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
                            <td className="max-w-40 truncate px-3 py-2 text-white/45">{String(row.creditTxHash || row.error || row.reason || "-")}</td>
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
