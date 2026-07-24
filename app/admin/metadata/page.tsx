"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Button, Card, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { WalletButton } from "@/components/wallet/WalletButton";
import { adminPayloadHash, createAdminAuthorization } from "@/lib/adminMessage";
import { useWalletService } from "@/providers/WalletServiceProvider";

type MetadataAttribute = {
  trait_type?: string;
  value?: unknown;
};

type MetadataJson = {
  name?: string;
  description?: string;
  image?: string;
  attributes?: MetadataAttribute[];
  [key: string]: unknown;
};

type MetadataStatus = {
  ok?: boolean;
  authorized?: boolean;
  ownerConfigured?: boolean;
  config?: {
    maxSupply: number;
    imageCid: string;
    collectionName: string;
    description: string;
    uploadedMetadataPublished: boolean;
    uploadedMetadataPublishedAt?: string;
  };
  index?: {
    uploadedCount: number;
    missingCount: number;
    firstTokenId: number | null;
    lastTokenId: number | null;
    missingSample: number[];
    updatedAt?: string;
  };
  overrideCount?: number;
  requiredTraitTypes?: string[];
  token?: {
    ok?: boolean;
    tokenId?: number;
    metadata?: MetadataJson;
    uploadedBaseFound?: boolean;
    liveUploadedBase?: boolean;
    override?: {
      version?: number;
      name?: string;
      description?: string;
      image?: string;
      attributes?: Record<string, string>;
    } | null;
    error?: string;
  };
  error?: string;
};

type ParsedMetadataFile = {
  fileName: string;
  tokenId: number | null;
  metadata: MetadataJson | null;
  errors: string[];
  warnings: string[];
};

const REQUIRED_TRAITS = [
  "Background",
  "Droid",
  "Eyes",
  "Clothes",
  "Mouth",
  "Hat",
  "Special",
  "Accessories",
  "Accessories 2",
  "Stickers/Body art",
];
const UPLOAD_BATCH_SIZE = 100;
const DEFAULT_IMAGE_CID = "bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq";

function normalizeAddress(address?: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address || "") ? String(address).toLowerCase() : "";
}

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "-";
}

function extractTokenId(file: File, metadata?: MetadataJson) {
  const path = file.webkitRelativePath || file.name;
  const name = path.split("/").pop() || file.name;
  const withoutJson = name.replace(/\.json$/i, "");
  if (/^\d+$/.test(withoutJson)) return Number(withoutJson);
  const match = String(metadata?.name || "").match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}

function validateClientMetadata(metadata: MetadataJson | null, tokenId: number | null, imageCid: string, maxSupply: number) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!tokenId || !Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > maxSupply) errors.push("invalid token ID");
  if (!metadata || typeof metadata !== "object") {
    errors.push("metadata is not an object");
    return { errors, warnings };
  }
  if (!metadata.name || typeof metadata.name !== "string") errors.push("missing name");
  if (!metadata.image || typeof metadata.image !== "string") {
    errors.push("missing image");
  } else {
    const expectedPrefix = `ipfs://${imageCid}/`;
    if (!metadata.image.startsWith(expectedPrefix)) errors.push(`image does not use ${expectedPrefix}`);
    if (tokenId && !metadata.image.endsWith(`/${tokenId}.png`)) warnings.push(`image does not end with /${tokenId}.png`);
  }
  if (!Array.isArray(metadata.attributes)) {
    errors.push("attributes is not an array");
  } else {
    const traits = new Set(metadata.attributes.map((attribute) => String(attribute?.trait_type || "")));
    for (const trait of REQUIRED_TRAITS) {
      if (!traits.has(trait)) errors.push(`missing ${trait}`);
    }
  }
  return { errors, warnings };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function jsonPreview(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function createAdminSignatureRequest(walletAddress: string, payload: Record<string, unknown>) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const authorization = createAdminAuthorization({
    wallet: walletAddress,
    timestamp,
    nonce,
    action: "metadata",
    route: "/api/admin/metadata",
    payload,
  });
  return {
    timestamp,
    nonce,
    ...authorization,
  };
}

export default function AdminMetadataPage() {
  const walletService = useWalletService();
  const walletAddress = normalizeAddress(walletService.address);
  const [status, setStatus] = useState<MetadataStatus | null>(null);
  const [statusText, setStatusText] = useState("Connect owner wallet to manage Season 2 metadata.");
  const [loading, setLoading] = useState(false);
  const [parsedFiles, setParsedFiles] = useState<ParsedMetadataFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");
  const [allowFallbackPublish, setAllowFallbackPublish] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState("1");
  const [overrideVersion, setOverrideVersion] = useState("2");
  const [overrideName, setOverrideName] = useState("");
  const [overrideDescription, setOverrideDescription] = useState("");
  const [overrideImage, setOverrideImage] = useState("");
  const [overrideTraits, setOverrideTraits] = useState<Record<string, string>>({});
  const [configMaxSupply, setConfigMaxSupply] = useState("3333");
  const [configImageCid, setConfigImageCid] = useState(DEFAULT_IMAGE_CID);
  const [configCollectionName, setConfigCollectionName] = useState("D.Y.O.O.R");
  const [configDescription, setConfigDescription] = useState("Directive: Yield Opportunity Optimization Robots");

  const authorized = Boolean(walletAddress && status?.authorized);
  const parsedValid = parsedFiles.filter((file) => !file.errors.length && file.metadata && file.tokenId);
  const parsedInvalid = parsedFiles.filter((file) => file.errors.length);
  const parsedWarnings = parsedFiles.reduce((total, file) => total + file.warnings.length, 0);
  const uploadedCount = status?.index?.uploadedCount || 0;
  const maxSupply = status?.config?.maxSupply || Number(configMaxSupply) || 3333;

  const mergedPreview = status?.token?.metadata ? jsonPreview(status.token.metadata) : "";

  async function loadStatus(tokenId = selectedTokenId) {
    if (!walletAddress) {
      setStatus(null);
      setStatusText("Connect owner wallet to manage Season 2 metadata.");
      return;
    }
    const response = await fetch(`/api/admin/metadata?wallet=${encodeURIComponent(walletAddress)}&tokenId=${encodeURIComponent(tokenId)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({})) as MetadataStatus;
    setStatus(data);
    if (data.config) {
      setConfigMaxSupply(String(data.config.maxSupply || 3333));
      setConfigImageCid(data.config.imageCid || DEFAULT_IMAGE_CID);
      setConfigCollectionName(data.config.collectionName || "D.Y.O.O.R");
      setConfigDescription(data.config.description || "Directive: Yield Opportunity Optimization Robots");
    }
    if (data.token?.override) {
      setOverrideVersion(String(data.token.override.version || 2));
      setOverrideName(data.token.override.name || "");
      setOverrideDescription(data.token.override.description || "");
      setOverrideImage(data.token.override.image || "");
      setOverrideTraits(data.token.override.attributes || {});
    } else {
      setOverrideVersion("2");
      setOverrideName("");
      setOverrideDescription("");
      setOverrideImage("");
      setOverrideTraits({});
    }
    setStatusText(data.authorized ? "Owner wallet authorized." : "Connected wallet is not the configured owner.");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  async function ensureWallet() {
    if (walletAddress) return true;
    await walletService.connect();
    return false;
  }

  async function signMetadataAction(payload: Record<string, unknown>) {
    const { timestamp, nonce, message, ...authorization } = createAdminSignatureRequest(walletAddress, payload);
    const signature = await walletService.signMessage(message);
    return { wallet: walletAddress, timestamp, nonce, signature, ...authorization };
  }

  async function postAdmin(body: Record<string, unknown>) {
    const signed = await signMetadataAction(body);
    const response = await fetch("/api/admin/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...signed, ...body }),
    });
    const data = await response.json().catch(() => ({})) as MetadataStatus;
    if (!response.ok || data.ok === false) throw new Error(data.error || "Metadata admin request failed.");
    return data;
  }

  async function saveConfig() {
    if (!await ensureWallet() || !authorized) return;
    setLoading(true);
    setStatusText("Signing metadata config update.");
    try {
      const data = await postAdmin({
        mode: "save-config",
        maxSupply: configMaxSupply,
        imageCid: configImageCid,
        collectionName: configCollectionName,
        description: configDescription,
      });
      setStatus(data);
      setStatusText("Metadata config saved.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Metadata config save failed.");
    } finally {
      setLoading(false);
    }
  }

  async function parseFiles(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true);
    setStatusText("Parsing metadata files in browser.");
    try {
      const parsed = await Promise.all(Array.from(files).map(async (file) => {
        const fileName = file.webkitRelativePath || file.name;
        try {
          const metadata = JSON.parse(await file.text()) as MetadataJson;
          const tokenId = extractTokenId(file, metadata);
          const validation = validateClientMetadata(metadata, tokenId, configImageCid, Number(configMaxSupply) || 3333);
          return { fileName, tokenId, metadata, ...validation };
        } catch (error) {
          return {
            fileName,
            tokenId: null,
            metadata: null,
            errors: [error instanceof Error ? error.message : "invalid JSON"],
            warnings: [],
          };
        }
      }));
      parsed.sort((a, b) => (a.tokenId || Number.MAX_SAFE_INTEGER) - (b.tokenId || Number.MAX_SAFE_INTEGER));
      setParsedFiles(parsed);
      setStatusText(`Parsed ${parsed.length.toLocaleString()} file(s). ${parsed.filter((item) => item.errors.length).length.toLocaleString()} need fixes.`);
    } finally {
      setLoading(false);
    }
  }

  async function uploadParsedMetadata() {
    if (!await ensureWallet() || !authorized) return;
    if (!parsedValid.length) {
      setStatusText("No valid parsed metadata records are ready to upload.");
      return;
    }
    if (parsedInvalid.length) {
      setStatusText("Fix invalid metadata files before uploading.");
      return;
    }

    setLoading(true);
    setUploadProgress("Signing once for chunked metadata upload.");
    try {
      const batches = chunk(parsedValid, UPLOAD_BATCH_SIZE);
      const recordBatches = batches.map((batch) => batch.map((file) => ({
        tokenId: file.tokenId,
        metadata: file.metadata,
      })));
      const batchHashes = recordBatches.map((records) => adminPayloadHash(records));
      const uploadManifestHash = adminPayloadHash(batchHashes);
      const authorizationPayload = {
        mode: "upload-metadata-batch",
        uploadManifestHash,
        batchHashes,
      };
      const signed = await signMetadataAction(authorizationPayload);
      for (let index = 0; index < batches.length; index += 1) {
        const records = recordBatches[index];
        setUploadProgress(`Uploading batch ${index + 1} of ${batches.length}.`);
        const response = await fetch("/api/admin/metadata", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...signed,
            ...authorizationPayload,
            batchIndex: index,
            records,
          }),
        });
        const data = await response.json().catch(() => ({})) as MetadataStatus & { uploaded?: number };
        if (!response.ok || data.ok === false) throw new Error(data.error || `Upload batch ${index + 1} failed.`);
      }
      setUploadProgress("Upload complete. Refreshing metadata status.");
      await loadStatus();
      setStatusText(`Uploaded ${parsedValid.length.toLocaleString()} metadata file(s). Publish when ready.`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Metadata upload failed.");
    } finally {
      setLoading(false);
    }
  }

  async function publishMetadata(publish: boolean) {
    if (!await ensureWallet() || !authorized) return;
    setLoading(true);
    setStatusText(publish ? "Publishing uploaded metadata." : "Unpublishing uploaded metadata.");
    try {
      const data = await postAdmin({
        mode: publish ? "publish-uploaded-metadata" : "unpublish-uploaded-metadata",
        allowFallback: allowFallbackPublish,
      });
      setStatus(data);
      setStatusText(publish ? "Uploaded metadata is now live for /api/metadata/{tokenId}." : "Uploaded metadata is unpublished; API uses local/fallback metadata.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Publish update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadToken() {
    await loadStatus(selectedTokenId);
  }

  async function saveOverride() {
    if (!await ensureWallet() || !authorized) return;
    setLoading(true);
    setStatusText("Saving trait override.");
    try {
      const attributes = Object.fromEntries(Object.entries(overrideTraits).filter(([, value]) => value.trim()));
      const data = await postAdmin({
        mode: "save-token-overrides",
        tokenId: selectedTokenId,
        override: {
          version: overrideVersion,
          name: overrideName,
          description: overrideDescription,
          image: overrideImage,
          attributes,
        },
      });
      setStatus(data);
      setStatusText(`Override saved for token ${selectedTokenId}.`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Override save failed.");
    } finally {
      setLoading(false);
    }
  }

  async function clearOverride() {
    if (!await ensureWallet() || !authorized) return;
    setLoading(true);
    setStatusText("Clearing trait override.");
    try {
      const data = await postAdmin({ mode: "delete-token-overrides", tokenId: selectedTokenId });
      setStatus(data);
      setOverrideTraits({});
      setOverrideName("");
      setOverrideDescription("");
      setOverrideImage("");
      setStatusText(`Override cleared for token ${selectedTokenId}.`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Override clear failed.");
    } finally {
      setLoading(false);
    }
  }

  const published = status?.config?.uploadedMetadataPublished;
  const uploadCoverage = maxSupply ? Math.round((uploadedCount / maxSupply) * 100) : 0;

  return (
    <PageShell size="wide">
      <Card strong className="mb-6 p-6 md:p-8">
        <SectionHeader
          eyebrow="Owner Metadata"
          title="Season 2 Metadata Manager"
          copy="Upload generated metadata JSON, manage live trait overrides, and publish the dynamic metadata source used by /api/metadata/{tokenId}."
          actions={(
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link className="btn-secondary text-center" href="/admin-command-center">Command Center</Link>
              <WalletButton />
            </div>
          )}
        />
        <Alert tone={!walletAddress ? "warning" : authorized ? "success" : "danger"}>{statusText}</Alert>
      </Card>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Uploaded Metadata" value={`${uploadedCount.toLocaleString()} / ${maxSupply.toLocaleString()}`} />
        <StatCard label="Coverage" value={`${uploadCoverage}%`} />
        <StatCard label="Missing" value={(status?.index?.missingCount ?? maxSupply).toLocaleString()} />
        <StatCard label="Overrides" value={(status?.overrideCount || 0).toLocaleString()} />
        <StatCard label="Published" value={published ? "Live" : "Staged"} />
      </div>

      {loading && <Card className="mb-6 p-5"><LoadingSkeleton lines={4} /></Card>}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="p-5 md:p-6">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <p className="eyebrow">Collection Config</p>
              <h2 className="mt-2 text-xl font-black uppercase text-white">Runtime Metadata Settings</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/58">These values control fallback metadata and server validation for uploaded JSON.</p>
            </div>
            <span className={`rounded border px-3 py-2 text-xs font-black uppercase ${published ? "border-dyoor-cyan/40 text-dyoor-cyan" : "border-yellow-300/40 text-yellow-100"}`}>
              {published ? "published" : "staged"}
            </span>
          </div>
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Max Supply
              <input className="rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-dyoor-cyan" value={configMaxSupply} onChange={(event) => setConfigMaxSupply(event.target.value)} />
            </label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Image CID
              <input className="rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-dyoor-cyan" value={configImageCid} onChange={(event) => setConfigImageCid(event.target.value.trim())} />
            </label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Collection Name
              <input className="rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-dyoor-cyan" value={configCollectionName} onChange={(event) => setConfigCollectionName(event.target.value)} />
            </label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Description
              <textarea className="min-h-24 rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-dyoor-cyan" value={configDescription} onChange={(event) => setConfigDescription(event.target.value)} />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" disabled={!authorized || loading} onClick={saveConfig}>Save Config</Button>
            <Button variant="secondary" disabled={!walletAddress || loading} onClick={() => void loadStatus()}>Refresh</Button>
          </div>
        </Card>

        <Card className="p-5 md:p-6">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <p className="eyebrow">Bulk Upload</p>
              <h2 className="mt-2 text-xl font-black uppercase text-white">Generated Metadata JSON</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/58">Select all generated token JSON files. Filenames should be 1.json, 2.json, or extensionless names exported as JSON.</p>
            </div>
            <span className="rounded border border-dyoor-purple/35 px-3 py-2 text-xs font-black uppercase text-white/60">
              {parsedFiles.length ? `${parsedFiles.length.toLocaleString()} parsed` : "no files"}
            </span>
          </div>
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Metadata Files
              <input
                accept=".json,application/json"
                className="rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white file:mr-4 file:rounded file:border-0 file:bg-dyoor-cyan file:px-4 file:py-2 file:text-xs file:font-black file:uppercase file:text-black"
                multiple
                type="file"
                onChange={(event) => void parseFiles(event.target.files)}
              />
            </label>
            {parsedFiles.length ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded border border-dyoor-cyan/25 bg-dyoor-cyan/10 p-3">
                  <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/45">Valid</p>
                  <p className="mt-2 text-2xl font-black text-dyoor-cyan">{parsedValid.length.toLocaleString()}</p>
                </div>
                <div className="rounded border border-red-300/30 bg-red-400/10 p-3">
                  <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/45">Invalid</p>
                  <p className="mt-2 text-2xl font-black text-red-100">{parsedInvalid.length.toLocaleString()}</p>
                </div>
                <div className="rounded border border-yellow-300/30 bg-yellow-300/10 p-3">
                  <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/45">Warnings</p>
                  <p className="mt-2 text-2xl font-black text-yellow-100">{parsedWarnings.toLocaleString()}</p>
                </div>
              </div>
            ) : null}
            {parsedInvalid.length ? (
              <Alert tone="danger">
                {parsedInvalid.slice(0, 5).map((file) => `${file.fileName}: ${file.errors.join(", ")}`).join(" | ")}
              </Alert>
            ) : null}
            {uploadProgress ? <Alert tone={loading ? "busy" : "success"}>{uploadProgress}</Alert> : null}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" disabled={!authorized || loading || !parsedValid.length || Boolean(parsedInvalid.length)} onClick={uploadParsedMetadata}>Upload Valid Metadata</Button>
            <Button variant="ghost" disabled={loading || !parsedFiles.length} onClick={() => setParsedFiles([])}>Clear Parsed Files</Button>
          </div>
        </Card>

        <Card className="p-5 md:p-6">
          <div>
            <p className="eyebrow">Publish Gate</p>
            <h2 className="mt-2 text-xl font-black uppercase text-white">Make Uploaded Metadata Live</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-white/58">Publishing switches the public API to uploaded Blob metadata. Unpublished uploads stay staged.</p>
          </div>
          <div className="mt-5 rounded border border-white/10 bg-black/30 p-4 text-sm font-bold leading-6 text-white/62">
            <p>Uploaded range: {status?.index?.firstTokenId || "-"} to {status?.index?.lastTokenId || "-"}</p>
            <p>Missing sample: {status?.index?.missingSample?.length ? status.index.missingSample.join(", ") : "none detected"}</p>
            <p>Last update: {status?.index?.updatedAt ? new Date(status.index.updatedAt).toLocaleString() : "-"}</p>
            <p>Current baseURI: https://dyoor.xyz/api/metadata/</p>
          </div>
          <label className="mt-4 flex items-start gap-3 rounded border border-yellow-300/25 bg-yellow-300/10 p-3 text-sm font-bold leading-6 text-yellow-100">
            <input className="mt-1 h-4 w-4 accent-dyoor-cyan" checked={allowFallbackPublish} type="checkbox" onChange={(event) => setAllowFallbackPublish(event.target.checked)} />
            Allow publish even if some token IDs still use fallback metadata.
          </label>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" disabled={!authorized || loading || published} onClick={() => void publishMetadata(true)}>Publish Uploaded Metadata</Button>
            <Button variant="secondary" disabled={!authorized || loading || !published} onClick={() => void publishMetadata(false)}>Unpublish</Button>
          </div>
        </Card>

        <Card className="p-5 md:p-6">
          <div>
            <p className="eyebrow">Trait Overrides</p>
            <h2 className="mt-2 text-xl font-black uppercase text-white">Per-Token Dynamic Traits</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-white/58">Use this for rerolls, Energy upgrades, blueprint edits, and marketplace trait changes.</p>
          </div>
          <div className="mt-5 grid gap-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
                Token ID
                <input className="rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-dyoor-cyan" value={selectedTokenId} onChange={(event) => setSelectedTokenId(event.target.value)} />
              </label>
              <div className="flex items-end">
                <Button variant="secondary" disabled={!walletAddress || loading} onClick={() => void loadToken()}>Load Token</Button>
              </div>
            </div>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Metadata Version
              <input className="rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-dyoor-cyan" value={overrideVersion} onChange={(event) => setOverrideVersion(event.target.value)} />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              {REQUIRED_TRAITS.map((trait) => (
                <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45" key={trait}>
                  {trait}
                  <input
                    className="rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-dyoor-cyan"
                    placeholder="leave blank to preserve base"
                    value={overrideTraits[trait] || ""}
                    onChange={(event) => setOverrideTraits((current) => ({ ...current, [trait]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Override Name
              <input className="rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-dyoor-cyan" value={overrideName} onChange={(event) => setOverrideName(event.target.value)} />
            </label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Override Image
              <input className="rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-dyoor-cyan" value={overrideImage} onChange={(event) => setOverrideImage(event.target.value)} />
            </label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
              Override Description
              <textarea className="min-h-20 rounded border border-dyoor-purple/35 bg-black/35 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-dyoor-cyan" value={overrideDescription} onChange={(event) => setOverrideDescription(event.target.value)} />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" disabled={!authorized || loading} onClick={saveOverride}>Save Override</Button>
            <Button variant="ghost" disabled={!authorized || loading} onClick={clearOverride}>Clear Override</Button>
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-5 md:p-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <p className="eyebrow">Live Preview</p>
            <h2 className="mt-2 text-xl font-black uppercase text-white">/api/metadata/{selectedTokenId || "1"}</h2>
          </div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
            {status?.token?.liveUploadedBase ? "uploaded base" : status?.token?.uploadedBaseFound ? "uploaded staged" : "fallback/local base"}
          </p>
        </div>
        {mergedPreview ? (
          <pre className="mt-5 max-h-[36rem] overflow-auto rounded border border-dyoor-purple/25 bg-black/45 p-4 text-xs font-bold leading-5 text-white/70">{mergedPreview}</pre>
        ) : (
          <EmptyState title="No Preview Loaded" copy="Connect the owner wallet, then load a token ID to preview the merged metadata response." />
        )}
      </Card>

      <div className="mt-6 rounded border border-dyoor-purple/20 bg-black/20 p-4 text-xs font-bold leading-6 text-white/45">
        <p>Connected wallet: {walletAddress ? shortAddress(walletAddress) : "-"}</p>
        <p>Images remain on IPFS. This manager stores metadata JSON, runtime config, and trait overrides in Netlify Blobs.</p>
      </div>
    </PageShell>
  );
}
