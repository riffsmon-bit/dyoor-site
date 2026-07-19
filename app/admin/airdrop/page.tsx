"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { Alert, Button, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { WalletButton } from "@/components/wallet/WalletButton";
import { dyoorS2Contract } from "@/lib/contracts/addresses";
import { adminAirdropMessage } from "@/lib/adminMessage";
import {
  S2_ASCENDED_AIRDROP_EXPECTED,
  buildAirdropBatches,
  parseAirdropCsv,
  projectedSupplyStatus,
  validateFinalAirdropCsv,
  type AirdropBatch,
  type ParsedAirdropCsv,
} from "@/lib/s2-airdrop";
import { useWalletService } from "@/providers/WalletServiceProvider";

type LoadState = "idle" | "loading" | "success" | "error";
type BatchStatus = "pending" | "simulated" | "completed" | "failed";

type ContractStatus = {
  owner: Address | "";
  totalSupply: bigint;
  maxSupply: bigint;
  airdropReserve: bigint;
  totalAirdropped: bigint;
  paused: boolean;
  airdropPaused: boolean;
};

type BatchProgress = {
  batchId: Hex;
  status: BatchStatus;
  txHash?: Hex;
  blockNumber?: string;
  gasEstimate?: string;
  error?: string;
  completedAt?: string;
  recipientCount?: number;
  quantityMinted?: string;
};

type AdminAuth = {
  chainId: string;
  contractAddress: string;
  expiresAt: number;
  message: string;
  nonce: string;
  signature: string;
  timestamp: string;
};

const S2_CHAIN_ID = 143;
const S2_CHAIN_HEX = "0x8f";
const S2_CHAIN_NAME = process.env.NEXT_PUBLIC_DYOOR_S2_CHAIN_NAME || "Monad";
const S2_RPC_URL = process.env.NEXT_PUBLIC_DYOOR_S2_RPC_URL || process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://rpc.monad.xyz";
const S2_EXPLORER_URL = (process.env.NEXT_PUBLIC_DYOOR_S2_EXPLORER_URL || "https://monadscan.com").replace(/\/$/, "");
const CONFIGURED_OWNER_WALLET = process.env.NEXT_PUBLIC_DYOOR_OWNER_ADDRESS || process.env.NEXT_PUBLIC_ADMIN_WALLET || "";
const DEFAULT_BATCH_SIZE = 25;

const airdropAbi = parseAbi([
  "function owner() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function AIRDROP_RESERVE() view returns (uint256)",
  "function totalAirdropped() view returns (uint256)",
  "function paused() view returns (bool)",
  "function airdropPaused() view returns (bool)",
  "function airdropBatchExecuted(bytes32 batchId) view returns (bool)",
  "function airdropBatch(bytes32 batchId,uint256 batchIndex,address[] recipients,uint256[] quantities)",
]);

const s2Chain = defineChain({
  id: S2_CHAIN_ID,
  name: S2_CHAIN_NAME,
  nativeCurrency: { decimals: 18, name: "MON", symbol: "MON" },
  rpcUrls: { default: { http: [S2_RPC_URL] }, public: { http: [S2_RPC_URL] } },
  blockExplorers: { default: { name: "Monadscan", url: S2_EXPLORER_URL } },
});

function normalizeAddress(value?: string) {
  try {
    return value ? getAddress(value) : "";
  } catch {
    return "";
  }
}

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "-";
}

function currentTimeMs() {
  return Date.now();
}

function formatGas(value?: string) {
  return value ? BigInt(value).toLocaleString() : "-";
}

async function sha256Hex(text: string): Promise<Hex> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/user rejected|user denied|rejected request/i.test(message)) return "Transaction rejected in wallet.";
  if (/insufficient funds/i.test(message)) return "Owner wallet has insufficient MON for gas.";
  if (/execution reverted|reverted/i.test(message)) return message.split("\n")[0] || "Transaction simulation reverted.";
  return message || "Airdrop action failed.";
}

function progressMap(progress: BatchProgress[]) {
  return new Map(progress.map((item) => [item.batchId, item]));
}

function storageKey(contractAddress: string, checksum: string) {
  return `dyoor:s2-airdrop:${S2_CHAIN_ID}:${contractAddress.toLowerCase()}:${checksum}`;
}

function progressForBatch(progress: BatchProgress[], batch: AirdropBatch): BatchProgress {
  return progressMap(progress).get(batch.batchId) || {
    batchId: batch.batchId,
    status: "pending",
    recipientCount: batch.recipientCount,
    quantityMinted: batch.quantityMinted.toString(),
  };
}

export default function AdminAirdropPage() {
  const wallet = useWalletService();
  const contractAddress = dyoorS2Contract || "";
  const [currentChainId, setCurrentChainId] = useState("");
  const [contractStatus, setContractStatus] = useState<ContractStatus>({
    owner: "",
    totalSupply: 0n,
    maxSupply: 3333n,
    airdropReserve: 610n,
    totalAirdropped: 0n,
    paused: false,
    airdropPaused: false,
  });
  const [statusState, setStatusState] = useState<LoadState>("idle");
  const [actionState, setActionState] = useState<LoadState>("idle");
  const [statusText, setStatusText] = useState("Upload a CSV to prepare owner-signed Season 2 airdrop batches.");
  const [error, setError] = useState("");
  const [csvName, setCsvName] = useState("");
  const [csvSha256, setCsvSha256] = useState<Hex | "">("");
  const [parsed, setParsed] = useState<ParsedAirdropCsv | null>(null);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [batches, setBatches] = useState<AirdropBatch[]>([]);
  const [progress, setProgress] = useState<BatchProgress[]>([]);
  const [adminAuth, setAdminAuth] = useState<AdminAuth | null>(null);
  const [executionPaused, setExecutionPaused] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const pausedRef = useRef(false);

  const publicClient = useMemo(() => createPublicClient({
    chain: s2Chain,
    transport: http(S2_RPC_URL),
  }), []);

  const walletAddress = normalizeAddress(wallet.address);
  const wrongNetwork = Boolean(wallet.connected && currentChainId && currentChainId.toLowerCase() !== S2_CHAIN_HEX);
  const ownerAuthorized = Boolean(walletAddress && contractStatus.owner && walletAddress.toLowerCase() === contractStatus.owner.toLowerCase());
  const completedCount = progress.filter((item) => item.status === "completed").length;
  const failedCount = progress.filter((item) => item.status === "failed").length;
  const pendingCount = Math.max(0, batches.length - completedCount - failedCount);
  const progressById = progressMap(progress);
  const uniqueWalletCount = parsed ? new Set(parsed.rows.map((row) => row.wallet.toLowerCase())).size : 0;
  const nextBatch = batches.find((batch) => progressForBatch(progress, batch).status !== "completed") || null;
  const projected = parsed
    ? projectedSupplyStatus(contractStatus.totalSupply, contractStatus.maxSupply, parsed.totalQuantity)
    : projectedSupplyStatus(contractStatus.totalSupply, contractStatus.maxSupply, 0n);
  const projectedAirdropTotal = parsed ? contractStatus.totalAirdropped + parsed.totalQuantity : contractStatus.totalAirdropped;
  const exceedsAirdropReserve = projectedAirdropTotal > contractStatus.airdropReserve;
  const finalValidation = parsed ? validateFinalAirdropCsv(parsed) : null;
  const activeStorageKey = contractAddress && csvSha256 ? storageKey(contractAddress, csvSha256) : "";
  const authActive = Boolean(adminAuth);
  const confirmationMatches = confirmationText === S2_ASCENDED_AIRDROP_EXPECTED.confirmationPhrase;
  const executionBlocked = Boolean(
    !ownerAuthorized
      || wrongNetwork
      || projected.exceedsSupply
      || exceedsAirdropReserve
      || contractStatus.paused
      || contractStatus.airdropPaused
      || !finalValidation?.ok
      || !confirmationMatches,
  );

  const refreshChain = useCallback(async () => {
    if (!wallet.connected) {
      setCurrentChainId("");
      return "";
    }
    try {
      const provider = await wallet.getProvider();
      const chainId = String(await provider.request({ method: "eth_chainId" }) || "");
      setCurrentChainId(chainId);
      return chainId;
    } catch {
      setCurrentChainId("");
      return "";
    }
  }, [wallet]);

  const switchChain = useCallback(async () => {
    const provider = await wallet.getProvider();
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: S2_CHAIN_HEX }] });
    } catch {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: S2_CHAIN_HEX,
          chainName: S2_CHAIN_NAME,
          rpcUrls: [S2_RPC_URL],
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          blockExplorerUrls: [S2_EXPLORER_URL],
        }],
      });
    }
    await refreshChain();
  }, [refreshChain, wallet]);

  const refreshStatus = useCallback(async () => {
    if (!contractAddress) {
      setStatusState("error");
      setError("Set NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS before using the airdrop manager.");
      return;
    }
    setStatusState("loading");
    setError("");
    try {
      const [owner, totalSupply, maxSupply, airdropReserve, totalAirdropped, paused, airdropPaused] = await Promise.all([
        publicClient.readContract({ address: contractAddress as Address, abi: airdropAbi, functionName: "owner" }),
        publicClient.readContract({ address: contractAddress as Address, abi: airdropAbi, functionName: "totalSupply" }),
        publicClient.readContract({ address: contractAddress as Address, abi: airdropAbi, functionName: "maxSupply" }),
        publicClient.readContract({ address: contractAddress as Address, abi: airdropAbi, functionName: "AIRDROP_RESERVE" }),
        publicClient.readContract({ address: contractAddress as Address, abi: airdropAbi, functionName: "totalAirdropped" }),
        publicClient.readContract({ address: contractAddress as Address, abi: airdropAbi, functionName: "paused" }),
        publicClient.readContract({ address: contractAddress as Address, abi: airdropAbi, functionName: "airdropPaused" }),
      ]);
      setContractStatus({
        owner: getAddress(owner),
        totalSupply,
        maxSupply,
        airdropReserve,
        totalAirdropped,
        paused,
        airdropPaused,
      });
      setStatusState("success");
    } catch (err) {
      setStatusState("error");
      setError(normalizeError(err));
    }
  }, [contractAddress, publicClient]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshChain();
      void refreshStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshChain, refreshStatus]);

  useEffect(() => {
    if (!activeStorageKey) return;
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(activeStorageKey);
        const saved = raw ? JSON.parse(raw) as BatchProgress[] : [];
        setProgress(batches.map((batch) => ({
          ...progressForBatch(saved, batch),
          recipientCount: batch.recipientCount,
          quantityMinted: batch.quantityMinted.toString(),
        })));
      } catch {
        setProgress(batches.map((batch) => ({
          batchId: batch.batchId,
          status: "pending",
          recipientCount: batch.recipientCount,
          quantityMinted: batch.quantityMinted.toString(),
        })));
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStorageKey, batches.length]);

  useEffect(() => {
    if (!activeStorageKey || !progress.length) return;
    window.localStorage.setItem(activeStorageKey, JSON.stringify(progress));
  }, [activeStorageKey, progress]);

  function updateBatchProgress(batchId: Hex, patch: Partial<BatchProgress>) {
    setProgress((current) => {
      const map = progressMap(current);
      const existing = map.get(batchId) || { batchId, status: "pending" as BatchStatus };
      map.set(batchId, { ...existing, ...patch, batchId });
      return batches.map((batch) => ({
        ...progressForBatch(Array.from(map.values()), batch),
        recipientCount: batch.recipientCount,
        quantityMinted: batch.quantityMinted.toString(),
      }));
    });
  }

  async function parseCsv(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setActionState("loading");
    setError("");
    setStatusText("Parsing CSV.");
    try {
      const text = await file.text();
      const fileChecksum = await sha256Hex(text);
      const nextParsed = parseAirdropCsv(text);
      setCsvName(file.name);
      setCsvSha256(fileChecksum);
      setParsed(nextParsed);
      const nextBatches = contractAddress && nextParsed.rows.length
        ? buildAirdropBatches({
          batchSize,
          chainId: S2_CHAIN_ID,
          contractAddress: getAddress(contractAddress),
          rows: nextParsed.rows,
          snapshotChecksum: fileChecksum,
        })
        : [];
      setBatches(nextBatches);
      setProgress(nextBatches.map((batch) => ({
        batchId: batch.batchId,
        status: "pending",
        recipientCount: batch.recipientCount,
        quantityMinted: batch.quantityMinted.toString(),
      })));
      setActionState("success");
      setStatusText(`Parsed ${nextParsed.rows.length} valid row(s) from ${file.name}.`);
    } catch (err) {
      setActionState("error");
      setError(normalizeError(err));
    }
  }

  function rebuildBatches(nextBatchSize = batchSize) {
    if (!parsed || !contractAddress) return;
    const nextBatches = buildAirdropBatches({
      batchSize: nextBatchSize,
      chainId: S2_CHAIN_ID,
      contractAddress: getAddress(contractAddress),
      rows: parsed.rows,
      snapshotChecksum: csvSha256 || parsed.checksum,
    });
    setBatches(nextBatches);
    setProgress(nextBatches.map((batch) => ({
      ...progressForBatch(progress, batch),
      recipientCount: batch.recipientCount,
      quantityMinted: batch.quantityMinted.toString(),
    })));
  }

  async function getAirdropAuth() {
    if (!wallet.connected) {
      await wallet.connect();
      return null;
    }
    if (wrongNetwork) {
      await switchChain();
      return null;
    }
    if (!ownerAuthorized) throw new Error("Connected wallet is not the contract owner.");
    const now = currentTimeMs();
    if (adminAuth && adminAuth.expiresAt > now) return adminAuth;

    const timestamp = String(now);
    const expiresAt = String(now + 5 * 60 * 1000);
    const nonce = crypto.randomUUID();
    const message = adminAirdropMessage({
      chainId: String(S2_CHAIN_ID),
      contractAddress,
      expiresAt,
      nonce,
      timestamp,
      wallet: walletAddress,
    });
    const signature = await wallet.signMessage(message);
    const nextAuth = {
      chainId: String(S2_CHAIN_ID),
      contractAddress,
      expiresAt: Number(expiresAt),
      message,
      nonce,
      signature,
      timestamp,
    };
    setAdminAuth(nextAuth);
    return nextAuth;
  }

  async function ensureAdminAuth() {
    return Boolean(await getAirdropAuth());
  }

  function currentJobId() {
    if (!contractAddress || !csvSha256) return "";
    return `dyoor-s2-ascended-${S2_CHAIN_ID}-${contractAddress.toLowerCase()}-${csvSha256.slice(2, 14)}`;
  }

  function jobPayload(status: string) {
    const jobId = currentJobId();
    return {
      jobId,
      chainId: S2_CHAIN_ID,
      contractAddress,
      csvFilename: csvName,
      csvSha256,
      canonicalRecipientChecksum: parsed?.checksum || "",
      uniqueWalletCount,
      totalQuantity: parsed?.totalQuantity.toString() || "0",
      holderSnapshotAllocation: S2_ASCENDED_AIRDROP_EXPECTED.holderSnapshotQuantity.toString(),
      additionalTreasuryAllocation: S2_ASCENDED_AIRDROP_EXPECTED.additionalTreasuryQuantity.toString(),
      treasuryFinalAllocation: S2_ASCENDED_AIRDROP_EXPECTED.treasuryFinalQuantity.toString(),
      batchSize,
      status,
      createdBy: walletAddress,
      batches: batches.map((batch) => ({
        batchId: batch.batchId,
        batchIndex: batch.batchIndex,
        recipients: batch.recipients,
        quantities: batch.quantities.map(String),
        recipientCount: batch.recipientCount,
        quantityMinted: batch.quantityMinted.toString(),
        firstCsvLine: batch.firstCsvLine,
        lastCsvLine: batch.lastCsvLine,
        firstWallet: batch.firstWallet,
        lastWallet: batch.lastWallet,
      })),
      progress,
    };
  }

  async function persistJob(status: string) {
    const auth = await getAirdropAuth();
    if (!auth || !parsed || !currentJobId()) return;
    const response = await fetch("/api/admin/airdrop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "save-job",
        wallet: walletAddress,
        chainId: auth.chainId,
        contractAddress: auth.contractAddress,
        timestamp: auth.timestamp,
        expiresAt: String(auth.expiresAt),
        nonce: auth.nonce,
        signature: auth.signature,
        job: jobPayload(status),
      }),
    });
    const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!response.ok || data.ok === false) throw new Error(data.error || "Failed to persist airdrop job.");
  }

  async function simulateBatch(batch: AirdropBatch) {
    if (!contractAddress || !walletAddress) throw new Error("Connect owner wallet first.");
    const alreadyExecuted = await publicClient.readContract({
      address: contractAddress as Address,
      abi: airdropAbi,
      functionName: "airdropBatchExecuted",
      args: [batch.batchId],
    });
    if (alreadyExecuted) {
      updateBatchProgress(batch.batchId, { status: "completed", error: "", completedAt: "completed on-chain before this session" });
      return;
    }

    const latestSupply = await publicClient.readContract({
      address: contractAddress as Address,
      abi: airdropAbi,
      functionName: "totalSupply",
    });
    const latestAirdropped = await publicClient.readContract({
      address: contractAddress as Address,
      abi: airdropAbi,
      functionName: "totalAirdropped",
    });
    if (latestSupply + batch.quantityMinted > contractStatus.maxSupply) {
      throw new Error("Batch would exceed remaining supply.");
    }
    if (latestAirdropped + batch.quantityMinted > contractStatus.airdropReserve) {
      throw new Error("Batch would exceed the reserved airdrop allocation.");
    }

    await publicClient.simulateContract({
      account: walletAddress as Address,
      address: contractAddress as Address,
      abi: airdropAbi,
      functionName: "airdropBatch",
      args: [batch.batchId, BigInt(batch.batchIndex), batch.recipients, batch.quantities],
    });

    const data = encodeFunctionData({
      abi: airdropAbi,
      functionName: "airdropBatch",
      args: [batch.batchId, BigInt(batch.batchIndex), batch.recipients, batch.quantities],
    });
    const gas = await publicClient.estimateGas({
      account: walletAddress as Address,
      to: contractAddress as Address,
      data,
    });

    updateBatchProgress(batch.batchId, { status: "simulated", gasEstimate: gas.toString(), error: "" });
  }

  async function executeBatch(batch: AirdropBatch) {
    if (!confirmationMatches) {
      setError(`Type ${S2_ASCENDED_AIRDROP_EXPECTED.confirmationPhrase} before execution.`);
      return;
    }
    if (!finalValidation?.ok) {
      setError(finalValidation?.errors.join(" ") || "Final CSV totals are not valid.");
      return;
    }
    setActionState("loading");
    setError("");
    try {
      const authorized = await ensureAdminAuth();
      if (!authorized) return;
      await persistJob("executing");
      await simulateBatch(batch);

      const data = encodeFunctionData({
        abi: airdropAbi,
        functionName: "airdropBatch",
        args: [batch.batchId, BigInt(batch.batchIndex), batch.recipients, batch.quantities],
      });

      setStatusText(`Waiting for owner wallet confirmation for batch ${batch.batchIndex + 1}.`);
      const txHash = await wallet.sendTransaction({
        from: walletAddress,
        to: contractAddress,
        data,
        value: "0x0",
      });
      updateBatchProgress(batch.batchId, { status: "simulated", txHash: txHash as Hex, error: "" });

      setStatusText(`Batch ${batch.batchIndex + 1} submitted. Waiting for confirmation.`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex, confirmations: 1 });
      updateBatchProgress(batch.batchId, {
        status: "completed",
        txHash: txHash as Hex,
        blockNumber: receipt.blockNumber.toString(),
        completedAt: new Date().toISOString(),
        error: "",
      });
      setActionState("success");
      setStatusText(`Batch ${batch.batchIndex + 1} confirmed.`);
      await refreshStatus();
      await persistJob("executing");
    } catch (err) {
      updateBatchProgress(batch.batchId, { status: "failed", error: normalizeError(err) });
      await persistJob("failed").catch(() => undefined);
      setActionState("error");
      setError(normalizeError(err));
    }
  }

  async function executeAll() {
    if (!batches.length) return;
    pausedRef.current = false;
    setExecutionPaused(false);
    for (const batch of batches) {
      if (pausedRef.current) break;
      const item = progressById.get(batch.batchId);
      if (item?.status === "completed") continue;
      await executeBatch(batch);
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  }

  async function runDryRun() {
    if (!batches.length) return;
    setActionState("loading");
    setError("");
    setStatusText("Running dry-run simulation for every batch.");
    try {
      await persistJob("dry-run");
      for (const batch of batches) {
        await simulateBatch(batch);
      }
      setActionState("success");
      setStatusText("Dry run complete. No transactions were sent.");
      await persistJob("dry-run-complete");
    } catch (err) {
      setActionState("error");
      setError(normalizeError(err));
    }
  }

  function pauseExecution() {
    pausedRef.current = true;
    setExecutionPaused(true);
    setStatusText("Batch execution paused. Completed batches remain recorded.");
  }

  function exportResults() {
    const payload = {
      generatedAt: new Date().toISOString(),
      contractAddress,
      chainId: S2_CHAIN_ID,
      csvName,
      csvSha256,
      canonicalRecipientChecksum: parsed?.checksum,
      totals: {
        rows: parsed?.rows.length || 0,
        invalidRows: parsed?.invalidRows.length || 0,
        duplicateWallets: parsed?.duplicateRows.length || 0,
        quantity: parsed?.totalQuantity.toString() || "0",
        holderSnapshotAllocation: S2_ASCENDED_AIRDROP_EXPECTED.holderSnapshotQuantity.toString(),
        additionalTreasuryAllocation: S2_ASCENDED_AIRDROP_EXPECTED.additionalTreasuryQuantity.toString(),
        treasuryFinalAllocation: S2_ASCENDED_AIRDROP_EXPECTED.treasuryFinalQuantity.toString(),
      },
      batches: batches.map((batch) => ({
        ...batch,
        quantities: batch.quantities.map(String),
        quantityMinted: batch.quantityMinted.toString(),
      })),
      progress,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dyoor-s2-airdrop-${parsed?.checksum?.slice(2, 10) || "results"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const tone = error ? "danger" : actionState === "loading" || statusState === "loading" ? "busy" : actionState === "success" ? "success" : wrongNetwork ? "warning" : "idle";

  return (
    <PageShell size="wide" className="space-y-7">
      <SectionHeader
        eyebrow="Owner Tools"
        title="Season 2 Airdrop Manager"
        copy="CSV-based owner wallet execution for D.Y.O.O.R Season 2 NFT airdrops. Transactions are signed only by the connected owner wallet."
        actions={(
          <div className="flex flex-wrap gap-3">
            <WalletButton />
            <Button variant="secondary" onClick={() => void refreshStatus()} disabled={statusState === "loading"}>Refresh Status</Button>
          </div>
        )}
      />

      <Alert tone={tone}>{error || statusText}</Alert>
      {wrongNetwork ? <Alert tone="warning">Switch wallet to {S2_CHAIN_NAME} ({S2_CHAIN_HEX}) before executing batches.</Alert> : null}
      {!ownerAuthorized && wallet.connected ? <Alert tone="warning">Connected wallet is not the contract owner. Write actions are disabled.</Alert> : null}
      {contractStatus.paused ? <Alert tone="danger">Minting is globally paused on the contract, and airdrops are blocked while this pause is active.</Alert> : null}
      {contractStatus.airdropPaused ? <Alert tone="danger">Airdrops are paused on the contract. Unpause from owner tooling before execution.</Alert> : null}
      {exceedsAirdropReserve ? <Alert tone="danger">This CSV would exceed the contract airdrop reserve. Reduce the file or deploy a corrected contract.</Alert> : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Current Network" value={currentChainId || "-"} />
        <StatCard label="Connected Wallet" value={walletAddress ? shortAddress(walletAddress) : "-"} />
        <StatCard label="Configured Owner" value={CONFIGURED_OWNER_WALLET ? shortAddress(CONFIGURED_OWNER_WALLET) : "-"} />
        <StatCard label="Contract Owner" value={contractStatus.owner ? shortAddress(contractStatus.owner) : "-"} />
        <StatCard label="NFT Contract" value={contractAddress ? shortAddress(contractAddress) : "-"} />
        <StatCard label="Total Supply" value={contractStatus.totalSupply.toString()} />
        <StatCard label="Maximum Supply" value={contractStatus.maxSupply.toString()} />
        <StatCard label="Remaining Supply" value={(contractStatus.maxSupply > contractStatus.totalSupply ? contractStatus.maxSupply - contractStatus.totalSupply : 0n).toString()} />
        <StatCard label="Total Airdropped" value={contractStatus.totalAirdropped.toString()} />
        <StatCard label="Airdrop Reserve" value={contractStatus.airdropReserve.toString()} />
        <StatCard label="Reserve Remaining" value={(contractStatus.airdropReserve > contractStatus.totalAirdropped ? contractStatus.airdropReserve - contractStatus.totalAirdropped : 0n).toString()} />
        <StatCard label="Paused" value={contractStatus.paused ? "Mint Paused" : contractStatus.airdropPaused ? "Airdrop Paused" : "No"} />
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="glass-panel p-5">
          <div className="flex flex-col gap-2">
            <p className="eyebrow">Upload CSV</p>
            <h2 className="text-2xl font-black uppercase text-white">Recipient Snapshot</h2>
            <p className="text-sm font-semibold leading-6 text-white/58">Accepted headers: wallet,amount or wallet,quantity.</p>
          </div>

          <div className="mt-5 grid gap-4">
            <input
              className="rounded border border-dyoor-purple/35 bg-black/45 px-4 py-3 text-sm font-bold text-white file:mr-4 file:rounded file:border-0 file:bg-dyoor-cyan file:px-4 file:py-2 file:text-xs file:font-black file:uppercase file:text-black"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void parseCsv(event.target.files)}
            />

            <label className="grid gap-2">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Batch Size</span>
              <select
                className="rounded border border-dyoor-purple/35 bg-black/45 px-4 py-3 text-sm font-black uppercase text-white outline-none transition focus:border-dyoor-cyan"
                value={batchSize}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setBatchSize(next);
                  rebuildBatches(next);
                }}
              >
                {[5, 10, 15, 25, 35, 50].map((size) => <option key={size} value={size}>{size} recipients</option>)}
              </select>
            </label>

            {parsed ? (
              <div className="grid gap-2 rounded border border-white/12 bg-white/[0.035] p-4 text-sm font-semibold text-white/66">
                <p>File: <span className="text-white">{csvName}</span></p>
                <p>Valid rows: <span className="text-white">{parsed.rows.length}</span></p>
                <p>Unique wallets: <span className={uniqueWalletCount === S2_ASCENDED_AIRDROP_EXPECTED.uniqueWallets ? "text-white" : "text-red-100"}>{uniqueWalletCount}</span></p>
                <p>Invalid rows: <span className={parsed.invalidRows.length ? "text-red-100" : "text-white"}>{parsed.invalidRows.length}</span></p>
                <p>Duplicate wallets: <span className={parsed.duplicateRows.length ? "text-yellow-100" : "text-white"}>{parsed.duplicateRows.length}</span></p>
                <p>Holder snapshot allocation: <span className="text-white">{S2_ASCENDED_AIRDROP_EXPECTED.holderSnapshotQuantity.toString()}</span></p>
                <p>Additional treasury allocation: <span className="text-white">{S2_ASCENDED_AIRDROP_EXPECTED.additionalTreasuryQuantity.toString()}</span></p>
                <p>Combined airdrop allocation: <span className="text-dyoor-cyan">{S2_ASCENDED_AIRDROP_EXPECTED.totalQuantity.toString()}</span></p>
                <p>Treasury final allocation: <span className={finalValidation?.treasuryFinalQuantity === S2_ASCENDED_AIRDROP_EXPECTED.treasuryFinalQuantity ? "text-white" : "text-red-100"}>{finalValidation?.treasuryFinalQuantity?.toString() || "-"}</span></p>
                <p>Total requested quantity: <span className={parsed.totalQuantity === S2_ASCENDED_AIRDROP_EXPECTED.totalQuantity ? "text-dyoor-cyan" : "text-red-100"}>{parsed.totalQuantity.toString()}</span></p>
                <p>Projected final supply: <span className={projected.exceedsSupply ? "text-red-100" : "text-white"}>{projected.projected.toString()}</span></p>
                <p>Projected airdrop total: <span className={exceedsAirdropReserve ? "text-red-100" : "text-white"}>{projectedAirdropTotal.toString()} / {contractStatus.airdropReserve.toString()}</span></p>
                <p>CSV SHA-256: <span className="break-all font-mono text-xs text-dyoor-cyan">{csvSha256 || "-"}</span></p>
                <p>Canonical recipient checksum: <span className="break-all font-mono text-xs text-dyoor-cyan">{parsed.checksum}</span></p>
                {finalValidation?.errors.length ? (
                  <p className="text-red-100">{finalValidation.errors.join(" ")}</p>
                ) : <p className="text-emerald-100">Final CSV totals match the expected 56 wallets / 610 NFTs.</p>}
              </div>
            ) : null}
          </div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex flex-col gap-2">
            <p className="eyebrow">Execution</p>
            <h2 className="text-2xl font-black uppercase text-white">Batches</h2>
            <p className="text-sm font-semibold leading-6 text-white/58">Simulate first, then sign each transaction from the owner wallet.</p>
          </div>

          {!parsed ? (
            <EmptyState className="mt-5" title="No CSV Loaded" copy="Upload a recipient CSV to create deterministic batches." />
          ) : statusState === "loading" ? (
            <LoadingSkeleton className="mt-5" lines={5} />
          ) : (
            <div className="mt-5 grid gap-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <StatCard label="Batches" value={batches.length.toString()} />
                <StatCard label="Completed" value={completedCount.toString()} />
                <StatCard label="Pending" value={pendingCount.toString()} />
                <StatCard label="Failed" value={failedCount.toString()} />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" disabled={!nextBatch || !ownerAuthorized || actionState === "loading"} onClick={() => nextBatch && void simulateBatch(nextBatch).catch((err) => setError(normalizeError(err)))}>
                  Simulate Next
                </Button>
                <Button variant="secondary" disabled={!batches.length || !ownerAuthorized || actionState === "loading" || projected.exceedsSupply || exceedsAirdropReserve || contractStatus.paused || contractStatus.airdropPaused || !finalValidation?.ok} onClick={() => void runDryRun()}>
                  Dry Run All
                </Button>
                <Button variant="primary" disabled={!nextBatch || actionState === "loading" || executionBlocked} onClick={() => nextBatch && void executeBatch(nextBatch)}>
                  Execute Next Batch
                </Button>
                <Button variant="secondary" disabled={!batches.length || actionState === "loading" || executionBlocked} onClick={() => void executeAll()}>
                  Execute All Sequentially
                </Button>
                <Button variant="ghost" disabled={actionState !== "loading"} onClick={pauseExecution}>Pause Execution</Button>
                <Button variant="secondary" disabled={!progress.length} onClick={exportResults}>Export Results</Button>
              </div>

              <div className="rounded border border-white/12 bg-black/30 p-4 text-sm font-semibold text-white/66">
                <p>Admin auth: <span className={authActive ? "text-emerald-100" : "text-white/45"}>{authActive ? "Signed" : "Not signed"}</span></p>
                <p>Execution pause: <span className={executionPaused ? "text-yellow-100" : "text-white"}>{executionPaused ? "Paused" : "Ready"}</span></p>
                <p>Required confirmation: <span className="text-white">{S2_ASCENDED_AIRDROP_EXPECTED.confirmationPhrase}</span></p>
                <label className="mt-3 grid gap-2">
                  <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Final Owner Confirmation</span>
                  <input
                    className="rounded border border-dyoor-purple/35 bg-black/45 px-4 py-3 text-sm font-black text-white outline-none transition focus:border-dyoor-cyan"
                    value={confirmationText}
                    onChange={(event) => setConfirmationText(event.target.value)}
                    placeholder={S2_ASCENDED_AIRDROP_EXPECTED.confirmationPhrase}
                  />
                </label>
                {nextBatch ? (
                  <p className="mt-3">Next batch: <span className="text-white">#{nextBatch.batchIndex + 1}</span>, {nextBatch.recipientCount} recipient(s), {nextBatch.quantityMinted.toString()} NFT(s), expected next token #{(contractStatus.totalSupply + 1n).toString()}</p>
                ) : <p>Next batch: <span className="text-white">None</span></p>}
              </div>

              <div className="max-h-[28rem] overflow-auto rounded border border-white/12">
                <table className="min-w-full text-left text-xs font-semibold text-white/66">
                  <thead className="sticky top-0 bg-black text-white">
                    <tr>
                      <th className="p-3">Batch</th>
                      <th className="p-3">Rows</th>
                      <th className="p-3">NFTs</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Gas</th>
                      <th className="p-3">Tx</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => {
                      const item = progressForBatch(progress, batch);
                      return (
                        <tr key={batch.batchId} className="border-t border-white/10">
                          <td className="p-3 font-black text-white">#{batch.batchIndex + 1}</td>
                          <td className="p-3">{batch.firstCsvLine}-{batch.lastCsvLine}<span className="block max-w-44 truncate font-mono text-white/40">{batch.firstWallet}{" -> "}{batch.lastWallet}</span></td>
                          <td className="p-3">{batch.quantityMinted.toString()}</td>
                          <td className="p-3 uppercase">{item.status}{item.error ? <span className="block max-w-xs text-red-100">{item.error}</span> : null}</td>
                          <td className="p-3">{formatGas(item.gasEstimate)}</td>
                          <td className="p-3">{item.txHash ? <a className="text-dyoor-cyan underline" href={`${S2_EXPLORER_URL}/tx/${item.txHash}`} target="_blank" rel="noreferrer">{shortAddress(item.txHash)}</a> : "-"}</td>
                          <td className="p-3">
                            <Button className="px-3 py-2 text-[0.7rem]" variant={item.status === "failed" ? "primary" : "secondary"} disabled={!ownerAuthorized || actionState === "loading" || item.status === "completed"} onClick={() => void executeBatch(batch)}>
                              {item.status === "failed" ? "Retry" : "Execute"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      {parsed ? (
        <section className="grid gap-5 lg:grid-cols-2">
          <div className="glass-panel p-5">
            <p className="eyebrow">Invalid Rows</p>
            <div className="mt-4 max-h-72 overflow-auto rounded border border-white/12">
              {parsed.invalidRows.length ? (
                <table className="min-w-full text-left text-xs font-semibold text-white/66">
                  <thead className="bg-black text-white"><tr><th className="p-3">Line</th><th className="p-3">Wallet</th><th className="p-3">Amount</th><th className="p-3">Reason</th></tr></thead>
                  <tbody>{parsed.invalidRows.slice(0, 50).map((row) => <tr key={`${row.lineNumber}-${row.reason}`} className="border-t border-white/10"><td className="p-3">{row.lineNumber}</td><td className="p-3">{row.wallet || "-"}</td><td className="p-3">{row.quantity || "-"}</td><td className="p-3 text-red-100">{row.reason}</td></tr>)}</tbody>
                </table>
              ) : <p className="p-4 text-sm font-semibold text-white/58">No invalid rows.</p>}
            </div>
          </div>

          <div className="glass-panel p-5">
            <p className="eyebrow">Duplicate Rows</p>
            <div className="mt-4 max-h-72 overflow-auto rounded border border-white/12">
              {parsed.duplicateRows.length ? (
                <table className="min-w-full text-left text-xs font-semibold text-white/66">
                  <thead className="bg-black text-white"><tr><th className="p-3">Wallet</th><th className="p-3">Lines</th><th className="p-3">Total Qty</th></tr></thead>
                  <tbody>{parsed.duplicateRows.slice(0, 50).map((row) => <tr key={row.wallet} className="border-t border-white/10"><td className="p-3 font-mono">{row.wallet}</td><td className="p-3">{row.lineNumbers.join(", ")}</td><td className="p-3">{row.totalQuantity.toString()}</td></tr>)}</tbody>
                </table>
              ) : <p className="p-4 text-sm font-semibold text-white/58">No duplicate wallet rows.</p>}
            </div>
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
