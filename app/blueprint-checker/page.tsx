"use client";

import { useEffect, useState } from "react";
import {
  ASCENSION_BLUEPRINT_TRAITS,
  checkExactBlueprintMatch,
  normalizeWalletAddress,
  rewardDescriptionForTier,
  type BlueprintMatchResult,
  type BlueprintTrait,
  type BlueprintTraits,
} from "@/lib/ascension/blueprint";
import { builderLayerOrder, traitPathCandidates, type BuilderCategory, type BuilderSelection } from "@/lib/dyoor-builder";
import { Alert, Button, Card, EmptyState, LoadingSkeleton, PageShell, SectionHeader } from "@/components/ui/DyoorUi";
import { useWalletService } from "@/providers/WalletServiceProvider";

const SAVED_BLUEPRINT_TRAITS: Array<{ key: keyof BlueprintTraits; label: string }> = [
  { key: "background", label: "Background" },
  { key: "droid", label: "Droid" },
  { key: "condition", label: "Condition" },
  { key: "eyes", label: "Eyes" },
  { key: "clothes", label: "Clothes" },
  { key: "mouth", label: "Mouth" },
  { key: "hat", label: "Hat" },
  { key: "special", label: "Special" },
  { key: "accessories", label: "Accessories" },
  { key: "accessories 2", label: "Accessories 2" },
];

const SHARE_TRAIT_PARAMS: Array<{ key: keyof BlueprintTraits; param: string }> = [
  { key: "background", param: "Background" },
  { key: "droid", param: "Droid" },
  { key: "condition", param: "Condition" },
  { key: "eyes", param: "Eyes" },
  { key: "clothes", param: "Clothes" },
  { key: "mouth", param: "Mouth" },
  { key: "hat", param: "Hat" },
  { key: "special", param: "Special" },
  { key: "accessories", param: "Accessories" },
  { key: "accessories 2", param: "Accessories 2" },
];

type SavedBlueprint = {
  wallet?: string;
  rank?: number;
  blueprintId?: string;
  createdAt?: string;
  ascensionBlueprint?: boolean;
  traits?: Partial<BlueprintTraits>;
  build?: BuilderSelection | null;
  image?: string;
  imageUrl?: string;
  png?: string;
};

type OwnedTokensResponse = {
  ok?: boolean;
  tokenIds?: string[];
  count?: number;
  error?: string;
};

function TraitGrid({
  traits,
  result,
  title,
}: {
  traits: Partial<BlueprintTraits>;
  result?: BlueprintMatchResult | null;
  title: string;
}) {
  const mismatches = new Set((result?.mismatchTraits || []).map((item) => item.trait));
  const missing = new Set((result?.missingTraits || []).map((item) => item.trait));
  const matched = new Set(result?.matchedTraits || []);

  function tone(trait: BlueprintTrait) {
    if (matched.has(trait)) return "border-emerald-300/35 bg-emerald-300/10";
    if (mismatches.has(trait) || missing.has(trait)) return "border-red-400/35 bg-red-400/10";
    return "border-dyoor-purple/16 bg-black/20";
  }

  return (
    <section>
      <h3 className="mb-3 text-lg font-black uppercase">{title}</h3>
      <div className="grid gap-2 md:grid-cols-2">
        {ASCENSION_BLUEPRINT_TRAITS.map((trait) => (
          <div className={`rounded border p-3 ${tone(trait)}`} key={trait}>
            <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-white/45">{trait}</p>
            <p className="mt-1 font-black">{traits?.[trait] || "-"}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${response.status})`);
  }
  return data as T;
}

function ResultSummary({ result }: { result: BlueprintMatchResult | null }) {
  if (!result) {
    return (
      <EmptyState
        title="Awaiting Droid Signal"
        copy="Connect a wallet and scan a token ID to compare minted traits against your saved Ascension Blueprint."
      />
    );
  }

  const ownership = result.ownershipConfirmed === null
    ? "Ownership/minter data unavailable in metadata."
    : result.ownershipConfirmed
      ? "Ownership/minter wallet confirmed."
      : "Ownership/minter wallet does not match connected wallet.";

  if (result.exactMatch) {
    return (
      <div className="space-y-2">
        <p className="text-xl font-black text-emerald-100">Exact Blueprint Match Confirmed</p>
        <p>Reward Tier: {result.rewardTier}</p>
        <p>{rewardDescriptionForTier(result.rewardTier)}</p>
        <p>Eligible Wallet: {result.wallet}</p>
        <p>Token ID: {result.tokenId}</p>
        <p>Matched Traits: {result.matchedTraits.join(", ")}</p>
        <p>{ownership}</p>
        <p>Claim status: pending admin confirmation</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xl font-black text-yellow-100">Not an exact match</p>
      <p>Completion: {result.completionPercent}%</p>
      <p>{ownership}</p>
      <p>Missing: {result.missingTraits.length}</p>
      <p>Mismatches: {result.mismatchTraits.length}</p>
    </div>
  );
}

function SavedBlueprintPreview({ blueprint }: { blueprint: SavedBlueprint }) {
  const image = blueprint.image || blueprint.imageUrl || blueprint.png || "";
  const build = blueprint.build || {};
  const layers = builderLayerOrder
    .map((category) => {
      const file = build[category];
      return file ? { category, file } : null;
    })
    .filter(Boolean) as Array<{ category: BuilderCategory; file: string }>;

  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="aspect-square w-full rounded border border-white/12 bg-black/30 object-cover" src={image} alt="Saved Ascension Blueprint" />;
  }

  if (!layers.length) {
    return (
      <div className="grid aspect-square w-full place-items-center rounded border border-white/12 bg-black/30 text-sm font-black uppercase tracking-[0.2em] text-white/35">
        Blueprint
      </div>
    );
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded border border-white/12 bg-black/30">
      {layers.map((layer) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="absolute inset-0 h-full w-full object-contain"
          key={`${layer.category}-${layer.file}`}
          data-next-source-index="1"
          data-sources={JSON.stringify(traitPathCandidates(layer.category, layer.file))}
          onError={(event) => {
            const img = event.currentTarget;
            const sources = JSON.parse(img.dataset.sources || "[]") as string[];
            const nextIndex = Number(img.dataset.nextSourceIndex || "1");
            const nextSource = sources[nextIndex];
            if (nextSource) {
              img.dataset.nextSourceIndex = String(nextIndex + 1);
              img.src = nextSource;
              return;
            }
            img.style.display = "none";
          }}
          src={traitPathCandidates(layer.category, layer.file)[0]}
          alt=""
        />
      ))}
    </div>
  );
}

function blueprintImage(blueprint: SavedBlueprint) {
  return blueprint.image || blueprint.imageUrl || blueprint.png || "";
}

function blueprintShareParams(blueprint: SavedBlueprint) {
  const params = new URLSearchParams();
  params.set("saved", "1");
  if (blueprint.rank) params.set("rank", String(blueprint.rank));
  if (blueprint.blueprintId) params.set("blueprintId", blueprint.blueprintId);
  for (const trait of SHARE_TRAIT_PARAMS) {
    const value = blueprint.traits?.[trait.key];
    if (value) params.set(trait.param, value);
  }
  return params;
}

function withShareVersion(params: URLSearchParams) {
  const versioned = new URLSearchParams(params);
  versioned.set("v", `share-${Date.now().toString(36)}`);
  return versioned;
}

function absoluteBlueprintUrl(path: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://dyoor.netlify.app";
  return `${origin}${path}`;
}

function blueprintShareUrl(blueprint: SavedBlueprint) {
  const params = withShareVersion(blueprintShareParams(blueprint));
  return absoluteBlueprintUrl(`/blueprint-share${params.toString() ? `?${params}` : ""}`);
}

function blueprintShareImageUrl(blueprint: SavedBlueprint) {
  const params = blueprintShareParams(blueprint);
  return absoluteBlueprintUrl(`/blueprint-share-image.png${params.toString() ? `?${params}` : ""}`);
}

function blueprintDownloadName(blueprint: SavedBlueprint, fallbackExtension = "png") {
  const id = String(blueprint.blueprintId || "dyoor-blueprint").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return `${id}.${fallbackExtension}`;
}

async function downloadBlueprintCard(blueprint: SavedBlueprint) {
  const source = blueprintImage(blueprint) || blueprintShareImageUrl(blueprint);
  if (!source) throw new Error("No blueprint image available.");
  const response = await fetch(source);
  if (!response.ok) throw new Error("Blueprint image download failed.");
  const blob = await response.blob();
  const extension = blob.type.includes("jpeg") ? "jpg" : blob.type.includes("svg") ? "svg" : "png";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = blueprintDownloadName(blueprint, extension);
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SavedBlueprintCard({
  blueprint,
  loading,
  status,
}: {
  blueprint: SavedBlueprint | null;
  loading: boolean;
  status: string;
}) {
  const [shareStatus, setShareStatus] = useState("");

  async function handleDownload() {
    if (!blueprint) return;
    setShareStatus("Preparing download...");
    try {
      await downloadBlueprintCard(blueprint);
      setShareStatus("Blueprint card downloaded.");
    } catch {
      const image = blueprintImage(blueprint) || blueprintShareImageUrl(blueprint);
      window.open(image, "_blank", "noopener,noreferrer");
      setShareStatus("Download blocked by the browser. Opened the image instead.");
    }
  }

  function shareToX() {
    if (!blueprint) return;
    const shareUrl = blueprintShareUrl(blueprint);
    const text = blueprint.blueprintId
      ? `My ${blueprint.blueprintId} DYOOR Ascension Blueprint`
      : "My DYOOR Ascension Blueprint";
    const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
    setShareStatus("X share window opened.");
  }

  return (
    <Card className="p-5 md:p-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">My Saved Blueprint</p>
          <h2 className="mt-2 text-2xl font-black uppercase">Saved Build</h2>
        </div>
        {blueprint ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void handleDownload()}>Download Card</Button>
            <Button variant="primary" onClick={shareToX}>Share on X</Button>
          </div>
        ) : null}
      </div>
      <Alert className="mt-4" tone={loading ? "busy" : blueprint ? "success" : "idle"}>
        {loading ? "Loading saved blueprint..." : status}
      </Alert>
      {shareStatus ? <Alert className="mt-3" tone="idle">{shareStatus}</Alert> : null}

      {loading && <LoadingSkeleton className="mt-5" lines={5} />}

      {blueprint && (
        <div className="mt-5 grid gap-5 md:grid-cols-[260px_1fr]">
          <SavedBlueprintPreview blueprint={blueprint} />
          <div className="space-y-4">
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <div className="terminal-panel p-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-white/45">Saved Wallet</p>
                <p className="mt-1 break-all font-black">{blueprint.wallet || "None"}</p>
              </div>
              <div className="terminal-panel p-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-white/45">Saved Date</p>
                <p className="mt-1 font-black">{blueprint.createdAt ? new Date(blueprint.createdAt).toLocaleString() : "None"}</p>
              </div>
              <div className="terminal-panel p-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-white/45">Blueprint ID</p>
                <p className="mt-1 font-black">{blueprint.blueprintId || "None"}</p>
              </div>
              <div className="terminal-panel p-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-white/45">Status</p>
                <p className="mt-1 font-black">{blueprint.ascensionBlueprint ? "Ascension Blueprint" : "None"}</p>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {SAVED_BLUEPRINT_TRAITS.map((trait) => (
                <div className="terminal-panel p-3" key={trait.key}>
                  <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-white/45">{trait.label}</p>
                  <p className="mt-1 font-black">{blueprint.traits?.[trait.key] || "None"}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function BlueprintCheckerPage() {
  const walletService = useWalletService();
  const authenticated = walletService.connected;
  const walletAddress = normalizeWalletAddress(walletService.address || "");
  const [tokenId, setTokenId] = useState("");
  const [status, setStatus] = useState(
    "Frontend checker results are for preview. Final prizes must be confirmed by admin script or server-side data after reveal.",
  );
  const [statusTone, setStatusTone] = useState<"idle" | "good" | "warn" | "bad" | "busy">("idle");
  const [result, setResult] = useState<BlueprintMatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedBlueprint, setSavedBlueprint] = useState<SavedBlueprint | null>(null);
  const [savedWallet, setSavedWallet] = useState("");
  const [savedStatus, setSavedStatus] = useState("Connect wallet, then click View My Saved Blueprint.");
  const [savedLoading, setSavedLoading] = useState(false);
  const [ownedTokenIds, setOwnedTokenIds] = useState<string[]>([]);
  const [ownedLoading, setOwnedLoading] = useState(false);
  const [ownedStatus, setOwnedStatus] = useState("Connect wallet to load owned Season 2 droids.");
  const visibleSavedBlueprint = savedWallet === walletAddress ? savedBlueprint : null;
  const visibleSavedStatus = savedWallet && savedWallet !== walletAddress
    ? "Wallet changed. Click View My Saved Blueprint to load this wallet."
    : savedStatus;

  const statusClass = {
    idle: "border-white/12 bg-white/[0.03] text-white/62",
    good: "border-emerald-300/35 bg-emerald-300/10 text-emerald-100",
    warn: "border-yellow-300/35 bg-yellow-300/10 text-yellow-100",
    bad: "border-red-400/40 bg-red-400/10 text-red-100",
    busy: "border-dyoor-cyan/40 bg-dyoor-cyan/10 text-dyoor-cyan",
  }[statusTone];

  useEffect(() => {
    let active = true;

    async function loadOwnedDroids() {
      if (!walletAddress) {
        setOwnedTokenIds([]);
        setOwnedStatus("Connect wallet to load owned Season 2 droids.");
        return;
      }

      setOwnedLoading(true);
      setOwnedStatus("Loading owned Season 2 droids...");
      try {
        const data = await fetchJson<OwnedTokensResponse>(
          `/api/s2/owned-tokens?wallet=${encodeURIComponent(walletAddress)}`,
        );
        if (!active) return;
        const tokenIds = Array.from(new Set(Array.isArray(data.tokenIds)
          ? data.tokenIds.map((id) => String(id)).filter((id) => /^\d+$/.test(id))
          : []))
          .sort((a, b) => Number(a) - Number(b));

        setOwnedTokenIds(tokenIds);
        setTokenId((current) => {
          const cleanCurrent = current.trim();
          return cleanCurrent && tokenIds.includes(cleanCurrent) ? cleanCurrent : tokenIds[0] || current;
        });
        setOwnedStatus(tokenIds.length
          ? `${tokenIds.length} owned Season 2 droid${tokenIds.length === 1 ? "" : "s"} loaded.`
          : "No Season 2 droids found for this wallet.");
      } catch (error) {
        if (!active) return;
        setOwnedTokenIds([]);
        setOwnedStatus(error instanceof Error ? error.message : "Could not load owned Season 2 droids.");
      } finally {
        if (active) setOwnedLoading(false);
      }
    }

    void loadOwnedDroids();
    return () => {
      active = false;
    };
  }, [walletAddress]);

  async function runCheck() {
    const cleanTokenId = tokenId.trim();
    if (!walletAddress) {
      setStatus("Connect wallet first.");
      setStatusTone("warn");
      await walletService.connect().catch(() => {});
      return;
    }

    if (!cleanTokenId) {
      setStatus("Enter a token ID.");
      setStatusTone("warn");
      return;
    }

    setLoading(true);
    setStatus("Checking saved Blueprint and minted metadata...");
    setStatusTone("busy");

    try {
      const nextResult = await checkExactBlueprintMatch(walletAddress, cleanTokenId);
      setResult(nextResult);
      setStatus("Check complete. Frontend results remain provisional until admin confirmation.");
      setStatusTone("good");
    } catch (error) {
      setResult(null);
      setStatus(error instanceof Error ? error.message : "Could not check Blueprint match.");
      setStatusTone("bad");
    } finally {
      setLoading(false);
    }
  }

  async function loadSavedBlueprint() {
    if (!walletAddress) {
      setSavedStatus("Connect wallet first.");
      setSavedBlueprint(null);
      await walletService.connect().catch(() => {});
      return;
    }

    setSavedLoading(true);
    setSavedStatus("Loading saved blueprint...");
    try {
      const data = await fetchJson<{ registration?: SavedBlueprint | null }>(
        `/api/ascension-blueprints?wallet=${encodeURIComponent(walletAddress)}`,
      );
      if (!data.registration) {
        setSavedBlueprint(null);
        setSavedWallet(walletAddress);
        setSavedStatus("No saved blueprint found for this wallet.");
        return;
      }
      setSavedBlueprint(data.registration);
      setSavedWallet(walletAddress);
      setSavedStatus("Saved blueprint loaded.");
    } catch {
      try {
        const data = await fetchJson<{ registration?: SavedBlueprint | null }>(
          `/.netlify/functions/ascension-blueprints?wallet=${encodeURIComponent(walletAddress)}`,
        );
        if (!data.registration) {
          setSavedBlueprint(null);
          setSavedWallet(walletAddress);
          setSavedStatus("No saved blueprint found for this wallet.");
          return;
        }
        setSavedBlueprint(data.registration);
        setSavedWallet(walletAddress);
        setSavedStatus("Saved blueprint loaded.");
      } catch (error) {
        setSavedBlueprint(null);
        setSavedWallet(walletAddress);
        setSavedStatus(error instanceof Error ? error.message : "Could not load saved blueprint.");
      }
    } finally {
      setSavedLoading(false);
    }
  }

  return (
    <PageShell>
      <Card strong className="energy-grid mb-8 p-6 md:p-8">
        <SectionHeader
          eyebrow="Season 2 Verification Preview"
          title="Blueprint Checker"
          copy="Scan a minted Droid against the registered Ascension Blueprint trait stack. Frontend signals are provisional until admin confirmation."
        />
        <div className="mt-5 flex flex-wrap gap-2">
          {["Exact traits only", "Frontend preview", "Admin confirmed"].map((label) => (
            <span className="rounded border border-dyoor-purple/28 bg-white/[0.035] px-3 py-2 text-xs font-black uppercase text-white/64" key={label}>
              {label}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <Card className="p-5 md:p-6">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Wallet + Token</p>
          <h2 className="mt-2 text-2xl font-black uppercase">Match Check</h2>
          <div className="mt-5 space-y-3">
            <label className="grid gap-2">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Owned Droid</span>
              <select
                className="field-control"
                disabled={!walletAddress || ownedLoading || !ownedTokenIds.length}
                value={ownedTokenIds.includes(tokenId.trim()) ? tokenId.trim() : ""}
                onChange={(event) => setTokenId(event.target.value)}
              >
                <option value="">
                  {ownedLoading ? "Loading owned droids..." : ownedTokenIds.length ? "Select a droid" : "No owned droids loaded"}
                </option>
                {ownedTokenIds.map((id) => (
                  <option key={id} value={id}>D.Y.O.O.R #{id}</option>
                ))}
              </select>
            </label>
            <input
              className="field-control"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Token ID, or select above"
              value={tokenId}
              onChange={(event) => setTokenId(event.target.value)}
            />
            <Button
              className="w-full"
              variant="primary"
              onClick={runCheck}
              disabled={loading}
            >
              {loading ? "Scanning Traits..." : "Check Blueprint Match"}
            </Button>
            <Button
              className="w-full"
              variant="secondary"
              onClick={() => void loadSavedBlueprint()}
              disabled={savedLoading}
            >
              {savedLoading ? "Loading Blueprint..." : "View My Saved Blueprint"}
            </Button>
            {!authenticated && (
              <Button className="w-full" variant="ghost" onClick={() => void walletService.connect()}>
                Connect Wallet
              </Button>
            )}
          </div>
          <div className={`status-signal mt-5 ${statusClass}`}>{status}</div>
          <div className="terminal-panel mt-4 p-4 text-sm text-white/58">
            Wallet: {walletAddress || "Not connected"}
            <br />
            Owned droids: {ownedLoading ? "loading" : ownedTokenIds.length}
            <br />
            {ownedStatus}
          </div>
        </Card>

        <Card className="space-y-6 p-5 md:p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Result</p>
            <h2 className="mt-2 text-2xl font-black uppercase">Trait Comparison</h2>
            <div className="mt-4 text-white/70">
              <ResultSummary result={result} />
            </div>
          </div>
          <TraitGrid title="Saved Blueprint Traits" traits={result?.blueprint.traits || {}} result={result} />
          <TraitGrid title="Minted NFT Traits" traits={result?.mintedTraits || {}} result={result} />
        </Card>
      </div>

      <div className="mt-5">
        <SavedBlueprintCard blueprint={visibleSavedBlueprint} loading={savedLoading} status={visibleSavedStatus} />
      </div>
    </PageShell>
  );
}
