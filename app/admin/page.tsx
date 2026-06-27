"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Alert, Button, Card, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { adminMessage } from "@/lib/adminMessage";
import { useWalletService } from "@/providers/WalletServiceProvider";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type Snapshot = {
  generatedAt: string;
  totals: {
    walletsFound: number;
    totalStaked: number;
    totalBlueprintsSaved: number;
  };
  staking: Array<Record<string, any>>;
  blueprints: Array<Record<string, any>>;
  combined: Array<Record<string, any>>;
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
  const [error, setError] = useState("");
  const [airdropRecipientsInput, setAirdropRecipientsInput] = useState("");
  const [airdropAmount, setAirdropAmount] = useState("");
  const [airdropCampaign, setAirdropCampaign] = useState(`dyoor-energy-${new Date().toISOString().slice(0, 10)}`);
  const [airdropNote, setAirdropNote] = useState("");
  const [airdropConfirm, setAirdropConfirm] = useState(false);
  const [airdropLoading, setAirdropLoading] = useState(false);
  const [airdropStatus, setAirdropStatus] = useState("Paste wallets or upload a CSV to preview an Energy airdrop.");
  const [airdropResult, setAirdropResult] = useState<AirdropResult | null>(null);
  const [lastVerifiedAt, setLastVerifiedAt] = useState("");
  const [lastSignatureAt, setLastSignatureAt] = useState("");

  useEffect(() => {
    let active = true;
    async function checkOwner() {
      setSnapshot(null);
      setError("");
      if (!walletAddress) {
        setAuthorized(false);
        setAuthStatus("Connect owner wallet.");
        return;
      }
      const response = await fetch(`/api/admin/snapshots?wallet=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!active) return;
      setAuthorized(Boolean(data.authorized));
      setAuthStatus(data.authorized ? "Owner wallet connected. Sign to unlock snapshots." : "Not authorized.");
      setLastVerifiedAt(new Date().toISOString());
    }
    void checkOwner();
    return () => {
      active = false;
    };
  }, [walletAddress]);

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

  async function getProvider() {
    return await walletService.getProvider() as Eip1193Provider;
  }

  async function generateSnapshot() {
    if (!walletAddress) {
      await walletService.connect().catch(() => {});
      return;
    }
    if (!authorized) return;
    setLoading(true);
    setError("");
    try {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const message = adminMessage(walletAddress, timestamp, nonce, "snapshot");
      const provider = await getProvider();
      const signature = await provider.request({ method: "personal_sign", params: [message, walletAddress] });
      const response = await fetch("/api/admin/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress, timestamp, nonce, signature }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Admin snapshot failed.");
      setSnapshot(data as Snapshot);
      setAuthStatus("Snapshot generated.");
      setLastSignatureAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin snapshot failed.");
    } finally {
      setLoading(false);
    }
  }

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

  return (
    <PageShell>
      <Card strong className="energy-grid mb-8 p-6 md:p-8">
        <SectionHeader
          eyebrow="Owner Command"
          title="DYOOR Admin Command Center"
          copy="Owner-only command surface for protected snapshots and internal Energy operations. Every action requires the configured owner wallet, a fresh signature, timestamp, and nonce."
          actions={<Button variant="primary" onClick={authenticated ? generateSnapshot : () => void walletService.connect()} disabled={loading || (authenticated && !authorized)}>{loading ? "Generating..." : authenticated ? "Generate Staking Snapshot" : "Connect Owner Wallet"}</Button>}
        />
        <Alert tone={!walletAddress ? "warning" : authorized ? "success" : "danger"}>{authStatus}</Alert>
      </Card>

      {error && <Alert className="mb-6" tone="danger">{error}</Alert>}
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
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/40">Last Verified</p>
            <p className="mt-2 text-sm font-black text-white">{lastSignatureAt ? new Date(lastSignatureAt).toLocaleTimeString() : lastVerifiedAt ? new Date(lastVerifiedAt).toLocaleTimeString() : "-"}</p>
          </div>
        </div>
      </Card>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard label="Total Wallets Found" value={snapshot?.totals.walletsFound ?? "-"} />
        <StatCard label="Total Staked" value={snapshot?.totals.totalStaked ?? "-"} />
        <StatCard label="Blueprints Saved" value={snapshot?.totals.totalBlueprintsSaved ?? "-"} />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded border border-dyoor-purple/25 bg-white/[0.035] p-4 text-sm font-bold text-white/62">
        <span>Last generated: {snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleString() : "Not generated yet"}</span>
        <Button variant="secondary" onClick={generateSnapshot} disabled={!authorized || loading}>Generate Staking Snapshot</Button>
      </div>

      <div className="grid gap-6">
        <SnapshotSection
          title="Ascension Staking Snapshot"
          description="Wallets, staked S1 counts, token IDs when available, pending Energy, lifetime Energy, ascended flag, and snapshot timestamp."
          rows={snapshot?.staking || []}
          filename={`${filenameBase}-staking`}
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
      </div>
    </PageShell>
  );
}
