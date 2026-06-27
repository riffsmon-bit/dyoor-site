"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ASCENSION_BLUEPRINT_LIMIT,
  ascensionBlueprintSignMessage,
  normalizeBlueprintTraits,
  normalizeWalletAddress,
} from "@/lib/ascension/blueprint";
import {
  availableCategories,
  builderLayerOrder,
  builderTraits,
  fileLabel,
  hasSelectedTraits,
  randomSelection,
  ruleConflict,
  selectedBlueprintTraits,
  traitPath,
  type BuilderCategory,
  type BuilderSelection,
} from "@/lib/dyoor-builder";
import { Alert, Button, Card, PageShell, SectionHeader } from "@/components/ui/DyoorUi";
import { useWalletService } from "@/providers/WalletServiceProvider";

const CANVAS_SIZE = 1024;
const DOWNLOAD_NAME = "dyoor-droid-pfp.png";

type BlueprintStatus = {
  remaining?: number;
  full?: boolean;
  registration?: {
    rank?: number;
    blueprintId?: string;
    build?: BuilderSelection;
  } | null;
};

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function selectedSummary(selection: BuilderSelection) {
  const parts = builderLayerOrder
    .filter((category) => selection[category])
    .map((category) => `${category}: ${fileLabel(selection[category] || "")}`);
  return parts.length ? parts.join(" / ") : "No traits selected";
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${response.status})`);
  }
  return data as T;
}

export default function BuildDroidPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const walletService = useWalletService();
  const authenticated = walletService.connected;
  const walletAddress = normalizeWalletAddress(walletService.address || "");
  const categories = useMemo(() => availableCategories(), []);
  const [activeCategory, setActiveCategory] = useState<BuilderCategory>(() => categories[0] || builderLayerOrder[0]);
  const [selection, setSelection] = useState<BuilderSelection>({});
  const [status, setStatus] = useState("Loading builder.");
  const [warning, setWarning] = useState("");
  const [blueprintStatus, setBlueprintStatus] = useState("Connect wallet to save one Ascension Blueprint.");
  const [remaining, setRemaining] = useState(ASCENSION_BLUEPRINT_LIMIT);
  const [full, setFull] = useState(false);
  const [registration, setRegistration] = useState<BlueprintStatus["registration"]>(null);
  const [saving, setSaving] = useState(false);

  const activeTraits = builderTraits[activeCategory] || [];
  const canSave = Boolean(walletAddress && hasSelectedTraits(selection) && !full && !registration && !saving);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const next: BuilderSelection = {};
      for (const category of builderLayerOrder) {
        const file = params.get(category);
        if (file && (builderTraits[category] || []).includes(file)) next[category] = file;
      }
      setSelection(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function renderPreview() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const gradient = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      gradient.addColorStop(0, "#13091f");
      gradient.addColorStop(0.5, "#061314");
      gradient.addColorStop(1, "#201018");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.strokeStyle = "rgba(66,241,200,.35)";
      ctx.lineWidth = 8;
      ctx.strokeRect(28, 28, CANVAS_SIZE - 56, CANVAS_SIZE - 56);

      const layers = builderLayerOrder
        .map((category) => {
          const file = selection[category];
          return file ? { category, file } : null;
        })
        .filter(Boolean) as Array<{ category: BuilderCategory; file: string }>;

      if (!layers.length) {
        ctx.fillStyle = "rgba(255,255,255,.86)";
        ctx.font = "800 48px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("D.Y.O.O.R", CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 16);
        ctx.font = "600 24px Arial, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,.62)";
        ctx.fillText("Select traits to build your Droid", CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 36);
        setStatus("No traits selected.");
        return;
      }

      let loadedCount = 0;
      for (const layer of layers) {
        const img = await loadImage(traitPath(layer.category, layer.file));
        if (cancelled) return;
        if (!img) continue;
        ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        loadedCount += 1;
      }

      setStatus(loadedCount ? `${loadedCount} layer${loadedCount === 1 ? "" : "s"} rendered.` : "Selected layers could not be loaded.");
    }

    void renderPreview();
    return () => {
      cancelled = true;
    };
  }, [selection]);

  useEffect(() => {
    async function loadBlueprintStatus() {
      const walletQuery = walletAddress ? `?wallet=${encodeURIComponent(walletAddress)}` : "";
      try {
        const data = await fetchJson<BlueprintStatus>(`/api/ascension-blueprints${walletQuery}`);
        setRemaining(data.remaining ?? ASCENSION_BLUEPRINT_LIMIT);
        setFull(Boolean(data.full));
        setRegistration(data.registration || null);
        if (data.registration) {
          setBlueprintStatus(`Blueprint ID: ${data.registration.blueprintId || ""} | Rank: #${data.registration.rank || ""}`);
        } else {
          setBlueprintStatus(walletAddress ? "Connected wallet can save one Ascension Blueprint." : "Connect wallet to save one Ascension Blueprint.");
        }
      } catch (error) {
        setBlueprintStatus(error instanceof Error ? error.message : "Blueprint status unavailable.");
      }
    }

    const timer = window.setTimeout(() => {
      void loadBlueprintStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [walletAddress]);

  function toggleTrait(category: BuilderCategory, file: string) {
    const conflict = ruleConflict({ category, file }, selection);
    const isSelected = selection[category] === file;
    if (conflict && !isSelected) {
      setWarning(conflict);
      return;
    }

    setWarning("");
    setSelection((current) => ({
      ...current,
      [category]: current[category] === file ? "" : file,
    }));
  }

  function resetBuild() {
    setSelection({});
    setWarning("");
  }

  function randomizeBuild() {
    setSelection(randomSelection());
    setWarning("");
  }

  async function downloadBuild() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      setStatus("PNG export failed.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = DOWNLOAD_NAME;
    link.rel = "noopener";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("PNG downloaded.");
  }

  async function copyBuild() {
    const params = new URLSearchParams();
    for (const category of builderLayerOrder) {
      if (selection[category]) params.set(category, selection[category] || "");
    }
    const url = `${window.location.origin}${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Build link copied.");
    } catch {
      setStatus("Copy unavailable in this browser.");
    }
  }

  async function getProvider() {
    return await walletService.getProvider() as Eip1193Provider;
  }

  async function saveBlueprint() {
    if (!walletAddress) {
      setBlueprintStatus("Connect wallet first.");
      await walletService.connect().catch(() => {});
      return;
    }
    if (!hasSelectedTraits(selection)) {
      setBlueprintStatus("Select traits before saving.");
      return;
    }
    if (!canSave) return;

    setSaving(true);
    setBlueprintStatus("Preparing wallet signature...");

    try {
      const traits = normalizeBlueprintTraits(selectedBlueprintTraits(selection));
      const message = await ascensionBlueprintSignMessage(walletAddress, traits);
      const provider = await getProvider();
      const signature = await provider.request({
        method: "personal_sign",
        params: [message, walletAddress],
      });
      const data = await fetchJson<BlueprintStatus>("/api/ascension-blueprints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress, traits, build: selection, message, signature }),
      });

      setRemaining(data.remaining ?? remaining);
      setFull(Boolean(data.full));
      setRegistration(data.registration || null);
      setBlueprintStatus(data.registration ? "Ascension Blueprint Secured" : "Blueprint status updated.");
    } catch (error) {
      setBlueprintStatus(error instanceof Error ? error.message : "Could not save Ascension Blueprint.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <Card strong className="energy-grid mb-8 p-6 md:p-8">
        <SectionHeader
          eyebrow="D.Y.O.O.R Droid Lab"
          title="Ascension Blueprint"
          copy="Design your future Droid in the Trait Core terminal. Save one Blueprint and lock your Architect signal."
          actions={
            <div className="rounded border border-dyoor-cyan/35 bg-dyoor-cyan/10 px-4 py-3 text-sm font-black uppercase text-dyoor-cyan">
              {Math.max(0, remaining)} Architect Slots
            </div>
          }
        />
      </Card>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="p-5 md:p-6">
          <div className="terminal-panel overflow-hidden">
            <canvas ref={canvasRef} className="aspect-square h-auto w-full" width={CANVAS_SIZE} height={CANVAS_SIZE} />
          </div>
          <div className="terminal-panel mt-4 p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Selected Build</p>
            <p className="mt-2 text-sm text-white/70">{selectedSummary(selection)}</p>
            <p className="mt-3 text-sm text-dyoor-cyan">{status}</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Button variant="secondary" onClick={randomizeBuild}>
              Randomize
            </Button>
            <Button variant="ghost" onClick={resetBuild}>
              Reset
            </Button>
            <Button variant="ghost" onClick={copyBuild}>
              Copy Build
            </Button>
            <Button variant="secondary" onClick={downloadBuild}>
              Download
            </Button>
          </div>

          <section className="terminal-panel mt-5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Ascension Blueprint</p>
                <h2 className="mt-2 text-2xl font-black uppercase">500 Architects</h2>
              </div>
              <span className="rounded border border-dyoor-cyan/35 px-3 py-2 text-xs font-black uppercase text-dyoor-cyan">
                {Math.max(0, remaining)} left
              </span>
            </div>
            <div className="mt-4 rounded border border-dyoor-purple/24 bg-white/[0.045] p-4">
              <strong>ASCENSION BLUEPRINT</strong>
              <span className="ml-2 text-dyoor-cyan">ARCHITECT</span>
              <p className="mt-1 text-sm text-white/55">
                {registration ? `${registration.blueprintId || ""} / Rank #${registration.rank || ""}` : "Blueprint ID / Rank pending"}
              </p>
            </div>
            <Button
              className="mt-4 w-full"
              variant={registration ? "secondary" : "primary"}
              onClick={saveBlueprint}
              disabled={!canSave}
            >
              {registration ? "Ascension Blueprint Secured" : saving ? "Saving Blueprint..." : "Save Ascension Blueprint"}
            </Button>
            {!authenticated && (
              <Button className="mt-3 w-full" variant="ghost" onClick={() => void walletService.connect()}>
                Connect Wallet
              </Button>
            )}
            <p className="mt-3 text-sm text-white/58">{blueprintStatus}</p>
          </section>
        </Card>

        <Card className="p-5 md:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Trait Stack</p>
              <h2 className="mt-2 text-2xl font-black uppercase">Layer Controls</h2>
            </div>
            <span className="rounded border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/55">Allowlist Only</span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                className={`rounded border px-3 py-2 text-xs font-black uppercase ${
                  category === activeCategory ? "border-dyoor-cyan text-dyoor-cyan" : "border-white/15 text-white/58"
                }`}
                type="button"
                onClick={() => setActiveCategory(category)}
                key={category}
              >
                {category}
              </button>
            ))}
          </div>

          {warning && (
            <Alert className="mt-4" tone="warning">{warning}</Alert>
          )}

          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h3 className="text-xl font-black uppercase">{activeCategory}</h3>
              <span className="text-sm text-white/45">Invalid combos are disabled.</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {activeTraits.map((file) => {
                const conflict = ruleConflict({ category: activeCategory, file }, selection);
                const isSelected = selection[activeCategory] === file;
                return (
                  <button
                    className={`rounded border p-3 text-left transition ${
                      isSelected
                        ? "border-dyoor-cyan bg-dyoor-cyan/10 shadow-[0_0_20px_rgba(57,255,226,.10)]"
                        : conflict
                          ? "border-white/10 bg-white/[0.02] opacity-45"
                          : "border-dyoor-purple/18 bg-black/20 hover:-translate-y-0.5 hover:border-dyoor-cyan/35 hover:bg-dyoor-cyan/[0.055]"
                    }`}
                    type="button"
                    disabled={Boolean(conflict) && !isSelected}
                    title={conflict || fileLabel(file)}
                    onClick={() => toggleTrait(activeCategory, file)}
                    key={file}
                  >
                    <span className="block font-black">{fileLabel(file)}</span>
                    <span className="mt-1 block text-xs text-white/42">{file}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
