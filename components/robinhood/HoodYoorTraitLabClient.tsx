"use client";

import Image from "next/image";
import Link from "next/link";
import { ethers } from "ethers";
import { useEffect, useMemo, useState } from "react";
import {
  hoodYoorPreviewRequestMessage,
  hoodYoorWalletTypedDataPayload,
  HOODYOOR_ALL_LAYERS,
  HOODYOOR_MAX_SUPPLY,
  HOODYOOR_PAYMENT_ENERGY,
  HOODYOOR_PAYMENT_ETH,
  HOODYOOR_PAYMENT_USDG,
  normalizeHoodYoorWallet,
  type HoodYoorRerollAction,
  type HoodYoorRerollAuthorization,
  type HoodYoorRerollPayment,
} from "@/lib/hoodyoor-reroll";
import {
  useWalletService,
  type Eip1193Provider,
} from "@/providers/WalletServiceProvider";

type LayerDefinition = {
  layer: number;
  name: string;
  mutable: boolean;
  energyCost: number;
};

type TraitSnapshot = {
  layer: number;
  slot: string;
  traitId: number;
  name: string;
  mutable: boolean;
};

type TokenState = {
  tokenId: number;
  owner: string;
  ownedByWallet: boolean;
  packedTraits: string;
  nonce: string;
  energyBalance: string;
  traits: TraitSnapshot[];
  imageUrl: string;
  rerollableLayers: number[];
};

type TraitLabConfig = {
  ok?: boolean;
  enabled?: boolean;
  ready?: boolean;
  setupIssue?: string;
  collection?: string;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  collectionAddress: string;
  controllerAddress: string;
  maxSupply: number;
  previewTtlMs: number;
  rerollAllCost: number;
  usdgAddress?: string;
  weiPerEnergy?: string;
  usdgUnitsPerEnergy?: string;
  energyRelayerReady?: boolean;
  layers: LayerDefinition[];
  settlement?: string;
  collectionFrozen?: boolean;
  token?: TokenState | null;
  error?: string;
};

type RerollPreview = {
  id: string;
  status: string;
  tokenId: number;
  wallet: string;
  action: HoodYoorRerollAction;
  layer: number;
  layerName: string;
  payment: HoodYoorRerollPayment;
  createdAt: string;
  expiresAt: string;
  energyCost: string;
  energyBalance: string;
  paymentToken: string;
  paymentAmount: string;
  resultSignature: string;
  authorization: HoodYoorRerollAuthorization;
  before: {
    packedTraits: string;
    traits: TraitSnapshot[];
    imageUrl: string;
  };
  after: {
    packedTraits: string;
    traits: TraitSnapshot[];
    imageUrl: string;
  };
};

type PreviewResponse = {
  ok?: boolean;
  preview?: RerollPreview;
  error?: string;
};

type Confirmation = {
  ok?: boolean;
  previewId?: string;
  status?: string;
  pending?: boolean;
  tokenId?: number;
  transactionHash?: string;
  transactionUrl?: string;
  energyBalance?: string;
  imageUrl?: string;
  confirmedAt?: string;
  error?: string;
};

type FlowState = "idle" | "connecting" | "loading" | "signing-preview" | "generating" | "switching" | "signing-reroll" | "approving" | "submitting" | "relaying" | "success" | "error";

const REROLL_CONTROLLER_INTERFACE = new ethers.Interface([
  "function confirmRerollETH((uint256 tokenId,address tokenOwner,uint256 expectedTraits,uint256 nextTraits,uint8 action,uint8 layer,uint8 paymentMethod,address paymentToken,uint256 paymentAmount,uint256 nonce,uint256 deadline) authorization,bytes ownerSignature,bytes resultSignature)",
  "function confirmRerollUSDG((uint256 tokenId,address tokenOwner,uint256 expectedTraits,uint256 nextTraits,uint8 action,uint8 layer,uint8 paymentMethod,address paymentToken,uint256 paymentAmount,uint256 nonce,uint256 deadline) authorization,bytes ownerSignature,bytes resultSignature)",
]);

const USDG_INTERFACE = new ethers.Interface([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/rejected|denied|cancel|closed/i.test(message)) return "The wallet request was cancelled. Nothing was changed or spent.";
  return message || "The HoodYØØR Trait Lab request failed. Try again.";
}

function formatEnergy(value: string | number | undefined) {
  try {
    return BigInt(value || 0).toLocaleString("en-US");
  } catch {
    return String(value || 0);
  }
}

function formatPaymentCost(
  payment: HoodYoorRerollPayment,
  energyUnits: string | number,
  config: TraitLabConfig | null,
) {
  const units = BigInt(energyUnits || 0);
  if (payment === "energy") return `${formatEnergy(units.toString())} Energy`;
  if (payment === "eth") {
    const amount = units * BigInt(config?.weiPerEnergy || 0);
    return `${ethers.formatEther(amount)} ETH`;
  }
  const amount = units * BigInt(config?.usdgUnitsPerEnergy || 0);
  return `${ethers.formatUnits(amount, 6)} USDG`;
}

function formatPreviewCost(preview: RerollPreview) {
  if (preview.payment === "energy") return `${formatEnergy(preview.paymentAmount)} Energy`;
  if (preview.payment === "eth") return `${ethers.formatEther(preview.paymentAmount)} ETH`;
  return `${ethers.formatUnits(preview.paymentAmount, 6)} USDG`;
}

async function waitForReceipt(
  provider: Eip1193Provider,
  transactionHash: string,
) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    }).catch(() => null) as { status?: string } | null;
    if (receipt) {
      if (String(receipt.status || "").toLowerCase() === "0x0") {
        throw new Error("The reroll transaction reverted onchain.");
      }
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  throw new Error("The transaction is still pending. Check the explorer before trying again.");
}

function remainingLabel(expiresAt: string, now: number) {
  const remaining = Math.max(0, Date.parse(expiresAt) - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function changedTraits(preview: RerollPreview) {
  return preview.before.traits.flatMap((before, index) => {
    const after = preview.after.traits[index];
    return after && before.traitId !== after.traitId ? [{ before, after }] : [];
  });
}

export function HoodYoorTraitLabClient() {
  const wallet = useWalletService();
  const walletAddress = normalizeHoodYoorWallet(wallet.address);
  return (
    <HoodYoorTraitLabSession
      key={walletAddress || "disconnected"}
      wallet={wallet}
      walletAddress={walletAddress}
    />
  );
}

function HoodYoorTraitLabSession({
  wallet,
  walletAddress,
}: {
  wallet: ReturnType<typeof useWalletService>;
  walletAddress: string;
}) {
  const [config, setConfig] = useState<TraitLabConfig | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState<TokenState | null>(null);
  const [action, setAction] = useState<HoodYoorRerollAction>("single");
  const [layer, setLayer] = useState<number | null>(null);
  const [payment, setPayment] = useState<HoodYoorRerollPayment>("energy");
  const [preview, setPreview] = useState<RerollPreview | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [flow, setFlow] = useState<FlowState>("idle");
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/robinhood/trait-lab", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as TraitLabConfig;
        if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load HoodYØØR Trait Lab.");
        return data;
      })
      .then(setConfig)
      .catch((caught) => {
        if (!controller.signal.aborted) setError(friendlyError(caught));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!preview) return;
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [preview]);

  const previewExpired = Boolean(preview && Date.parse(preview.expiresAt) <= clock);
  const changes = useMemo(() => preview ? changedTraits(preview) : [], [preview]);
  const selectedCost = action === "all"
    ? config?.rerollAllCost || 0
    : config?.layers.find((candidate) => candidate.layer === layer)?.energyCost || 0;
  const energyBalance = BigInt(token?.energyBalance || 0);
  const energyAvailable = selectedCost > 0
    && Boolean(config?.energyRelayerReady)
    && energyBalance >= BigInt(selectedCost);
  const selectedPayment = token && payment === "energy" && !energyAvailable
    ? "eth"
    : payment;
  const busy = ["connecting", "loading", "signing-preview", "generating", "switching", "signing-reroll", "approving", "submitting", "relaying"].includes(flow);

  async function connectWallet() {
    setError("");
    setFlow("connecting");
    try {
      await wallet.connect();
      setFlow("idle");
    } catch (caught) {
      setError(friendlyError(caught));
      setFlow("error");
    }
  }

  async function loadToken() {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    const tokenId = Number(tokenInput);
    if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > HOODYOOR_MAX_SUPPLY) {
      setError(`Enter a HoodYØØR token ID from 1 to ${HOODYOOR_MAX_SUPPLY}.`);
      setFlow("error");
      return;
    }
    setError("");
    setFlow("loading");
    setPreview(null);
    setConfirmation(null);
    try {
      const query = new URLSearchParams({ wallet: walletAddress, tokenId: String(tokenId) });
      const response = await fetch(`/api/robinhood/trait-lab?${query}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as TraitLabConfig;
      if (!response.ok || data.ok === false || !data.token) {
        throw new Error(data.error || "Could not load that HoodYØØR token.");
      }
      setConfig(data);
      setToken(data.token);
      setAction("single");
      const initialLayer = data.token.rerollableLayers[0] ?? null;
      const initialCost = data.layers.find((candidate) => candidate.layer === initialLayer)?.energyCost || 0;
      setLayer(initialLayer);
      setPayment(
        data.energyRelayerReady && initialCost > 0
          && BigInt(data.token.energyBalance) >= BigInt(initialCost)
          ? "energy"
          : "eth",
      );
      if (!data.token.ownedByWallet) throw new Error(`The connected wallet does not own HoodYØØR #${tokenId}.`);
      setFlow("idle");
    } catch (caught) {
      setToken(null);
      setError(friendlyError(caught));
      setFlow("error");
    }
  }

  async function generatePreview() {
    if (!walletAddress || !token || !config?.ready) return;
    if (action === "single" && layer === null) {
      setError("Choose a filled trait layer to reroll.");
      return;
    }
    setError("");
    setConfirmation(null);
    setFlow("signing-preview");
    try {
      const issuedAt = new Date().toISOString();
      const nonce = globalThis.crypto.randomUUID();
      const message = hoodYoorPreviewRequestMessage({
        wallet: walletAddress,
        tokenId: token.tokenId,
        action,
        layer: action === "all" ? null : layer,
        payment: selectedPayment,
        issuedAt,
        nonce,
      });
      const signature = await wallet.signMessage(message);
      setFlow("generating");
      const response = await fetch("/api/robinhood/trait-lab/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          tokenId: token.tokenId,
          action,
          layer: action === "all" ? HOODYOOR_ALL_LAYERS : layer,
          payment: selectedPayment,
          issuedAt,
          nonce,
          message,
          signature,
        }),
      });
      const data = await response.json().catch(() => ({})) as PreviewResponse;
      if (!response.ok || data.ok === false || !data.preview) {
        throw new Error(data.error || "Could not generate a compatibility-checked preview.");
      }
      setPreview(data.preview);
      setClock(Date.parse(data.preview.createdAt));
      setFlow("idle");
    } catch (caught) {
      setError(friendlyError(caught));
      setFlow("error");
    }
  }

  async function acceptPreview() {
    if (!walletAddress || !preview || !config?.controllerAddress || previewExpired) return;
    setError("");
    try {
      const provider = await wallet.getProvider();
      if (preview.payment !== "energy") {
        setFlow("switching");
        const chainHex = `0x${config.chainId.toString(16)}`;
        const currentChain = String(
          await provider.request({ method: "eth_chainId" }).catch(() => ""),
        ).toLowerCase();
        if (currentChain !== chainHex.toLowerCase()) {
          try {
            await provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: chainHex }],
            });
          } catch (switchError) {
            const errorCode = switchError && typeof switchError === "object" && "code" in switchError
              ? Number(switchError.code)
              : 0;
            if (errorCode === 4001) throw switchError;
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: chainHex,
                chainName: config.chainName || "Robinhood Chain",
                rpcUrls: [config.rpcUrl],
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                blockExplorerUrls: config.explorerUrl ? [config.explorerUrl] : [],
              }],
            });
            await provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: chainHex }],
            });
          }
        }
      }

      setFlow("signing-reroll");
      const payload = hoodYoorWalletTypedDataPayload({
        chainId: config.chainId,
        controller: config.controllerAddress,
        authorization: preview.authorization,
      });
      const ownerSignature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [walletAddress, payload],
      }) as string;

      if (preview.payment === "energy") {
        if (preview.authorization.paymentMethod !== HOODYOOR_PAYMENT_ENERGY) {
          throw new Error("The preview payment method does not match Energy.");
        }
        setFlow("relaying");
        const response = await fetch("/api/robinhood/trait-lab/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: walletAddress, previewId: preview.id, ownerSignature }),
        });
        const data = await response.json().catch(() => ({})) as Confirmation;
        if (!response.ok || data.ok === false) {
          throw new Error(data.error || "The gasless Energy reroll could not be submitted.");
        }
        setConfirmation(data);
        setFlow("success");
        if (!data.pending) {
          setToken((current) => current ? {
            ...current,
            packedTraits: preview.after.packedTraits,
            traits: preview.after.traits,
            imageUrl: preview.after.imageUrl,
            energyBalance: data.energyBalance || current.energyBalance,
            nonce: (BigInt(current.nonce) + 1n).toString(),
          } : current);
        }
        return;
      }

      const accounts = await provider.request({ method: "eth_accounts" }) as string[];
      const activeAccount = normalizeHoodYoorWallet(accounts?.[0]);
      if (activeAccount !== walletAddress) {
        throw new Error("The active wallet account changed. Reconnect the NFT owner wallet.");
      }
      if (!preview.resultSignature) throw new Error("The signed reroll result is missing.");

      if (preview.payment === "usdg") {
        if (preview.authorization.paymentMethod !== HOODYOOR_PAYMENT_USDG) {
          throw new Error("The preview payment method does not match USDG.");
        }
        if (
          !config.usdgAddress
          || ethers.getAddress(preview.paymentToken) !== ethers.getAddress(config.usdgAddress)
        ) {
          throw new Error("The preview is not using the configured USDG contract.");
        }
        const allowanceData = USDG_INTERFACE.encodeFunctionData("allowance", [
          walletAddress,
          config.controllerAddress,
        ]);
        const allowanceResult = await provider.request({
          method: "eth_call",
          params: [{ to: preview.paymentToken, data: allowanceData }, "latest"],
        }) as string;
        const [allowance] = USDG_INTERFACE.decodeFunctionResult("allowance", allowanceResult);
        if (BigInt(allowance) < BigInt(preview.paymentAmount)) {
          setFlow("approving");
          const approvalData = USDG_INTERFACE.encodeFunctionData("approve", [
            config.controllerAddress,
            preview.paymentAmount,
          ]);
          const approvalHash = await provider.request({
            method: "eth_sendTransaction",
            params: [{ from: walletAddress, to: preview.paymentToken, data: approvalData, value: "0x0" }],
          }) as string;
          await waitForReceipt(provider, approvalHash);
        }
      } else if (preview.authorization.paymentMethod !== HOODYOOR_PAYMENT_ETH) {
        throw new Error("The preview payment method does not match ETH.");
      }

      const functionName = preview.payment === "eth" ? "confirmRerollETH" : "confirmRerollUSDG";
      const transactionData = REROLL_CONTROLLER_INTERFACE.encodeFunctionData(functionName, [
        preview.authorization,
        ownerSignature,
        preview.resultSignature,
      ]);
      setFlow("submitting");
      const transactionHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: walletAddress,
          to: config.controllerAddress,
          data: transactionData,
          value: preview.payment === "eth"
            ? ethers.toQuantity(BigInt(preview.paymentAmount))
            : "0x0",
        }],
      }) as string;
      const transactionUrl = config.explorerUrl
        ? `${config.explorerUrl.replace(/\/$/, "")}/tx/${transactionHash}`
        : "";
      setConfirmation({
        ok: true,
        previewId: preview.id,
        status: "submitted",
        pending: true,
        tokenId: preview.tokenId,
        transactionHash,
        transactionUrl,
      });
      await waitForReceipt(provider, transactionHash);
      setConfirmation({
        ok: true,
        previewId: preview.id,
        status: "confirmed",
        pending: false,
        tokenId: preview.tokenId,
        transactionHash,
        transactionUrl,
        confirmedAt: new Date().toISOString(),
      });
      setFlow("success");
      setToken((current) => current ? {
        ...current,
        packedTraits: preview.after.packedTraits,
        traits: preview.after.traits,
        imageUrl: preview.after.imageUrl,
        nonce: (BigInt(current.nonce) + 1n).toString(),
      } : current);
    } catch (caught) {
      setError(friendlyError(caught));
      setFlow("error");
    }
  }

  function chooseSingleLayer(nextLayer: number) {
    if (preview) return;
    setAction("single");
    setLayer(nextLayer);
    setError("");
  }

  function chooseRerollAll() {
    if (preview) return;
    setAction("all");
    setLayer(null);
    setError("");
  }

  const primaryLabel = !walletAddress
    ? "Connect wallet"
    : flow === "loading"
      ? "Loading token…"
      : "Load HoodYØØR";
  const acceptanceLabel = !preview
    ? "Accept reroll"
    : flow === "switching"
      ? `Switch to ${config?.chainName || "Robinhood Chain"}…`
      : flow === "signing-reroll"
        ? "Sign exact reroll…"
        : flow === "approving"
          ? "Approve USDG…"
          : flow === "submitting"
            ? "Submitting onchain…"
            : flow === "relaying"
              ? "Relaying gaslessly…"
              : `Accept for ${formatPreviewCost(preview)}`;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050805] text-white selection:bg-[#c7ff00]/40">
      <div className="pointer-events-none fixed inset-0 opacity-30 [background-image:linear-gradient(rgba(199,255,0,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(199,255,0,.055)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="pointer-events-none fixed -left-40 top-24 h-96 w-96 rounded-full bg-[#c7ff00]/[0.06] blur-[100px]" />
      <div className="pointer-events-none fixed -right-48 top-1/2 h-[32rem] w-[32rem] rounded-full bg-emerald-500/[0.05] blur-[120px]" />

      <header className="relative z-30 border-b border-[#c7ff00]/15 bg-[#050805]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-5">
          <Link href="/robinhood" className="flex min-w-0 items-center gap-3" aria-label="Back to HoodYØØR">
            <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#c7ff00] shadow-[0_0_28px_rgba(199,255,0,.18)]">
              <Image src="/assets/robinhood/hoodyoor-robinhood-feather-logo.png" alt="" fill sizes="44px" className="object-cover" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-black uppercase tracking-[-0.03em]">HoodYØØR</span>
              <span className="block truncate text-[0.58rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/70">Onchain Trait Lab</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/robinhood/droids" className="rounded-full border border-[#c7ff00]/25 bg-[#c7ff00]/[0.06] px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.12em] text-[#c7ff00] transition hover:bg-[#c7ff00] hover:text-black">
              Droid OS
            </Link>
            <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.14em] text-white/55 lg:block">
              {config?.chainName || "Robinhood Chain"}
            </span>
            {walletAddress ? (
              <span className="rounded-full border border-[#c7ff00]/30 bg-[#c7ff00]/10 px-3 py-2 font-mono text-xs font-bold text-[#c7ff00]">
                {shortAddress(walletAddress)}
              </span>
            ) : (
              <button
                className="rounded-full border border-[#c7ff00]/35 bg-[#c7ff00]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.08em] text-[#c7ff00] transition hover:bg-[#c7ff00] hover:text-black disabled:opacity-50"
                type="button"
                disabled={flow === "connecting"}
                onClick={() => void connectWallet()}
              >
                Connect
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-8 pt-12 sm:pt-16">
        <div className="max-w-4xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#c7ff00]/25 bg-[#c7ff00]/[0.06] px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#c7ff00] shadow-[0_0_12px_#c7ff00]" />
            Contract-connected prototype
          </p>
          <h1 className="mt-6 text-5xl font-black uppercase leading-[0.86] tracking-[-0.07em] sm:text-7xl lg:text-8xl">
            Roll the trait.<br /><span className="text-[#c7ff00]">Keep the droid.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base font-semibold leading-7 text-white/55 sm:text-lg sm:leading-8">
            Preview an exact compatibility-checked onchain result, then accept it with Energy, ETH, or USDG. Energy is gasless; ETH and USDG submit directly from the NFT owner wallet.
          </p>
        </div>

        <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3">
          {[
            ["01", "Free signed preview", "Nothing is spent while looking."],
            ["02", "Exact onchain art", "The preview decodes the committed pixels."],
            ["03", "Choose how to pay", "Use gasless Energy or pay directly in ETH or USDG."],
          ].map(([number, title, copy]) => (
            <div className="bg-[#0a0f09] p-5" key={number}>
              <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]">{number}</p>
              <p className="mt-2 text-sm font-black uppercase text-white">{title}</p>
              <p className="mt-2 text-xs font-semibold leading-5 text-white/38">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-24">
        {config && !config.ready ? (
          <div className="mb-6 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] p-5 text-amber-50" role="status">
            <p className="text-[0.62rem] font-black uppercase tracking-[0.17em] text-amber-300">Safe setup mode</p>
            <p className="mt-2 text-sm font-bold leading-6">{config.setupIssue || "The contract-connected test is not configured yet."}</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-amber-100/50">The interface is visible, but preview and acceptance stay locked until the collection, signer, payment rates, and contract wiring pass their checks.</p>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="self-start rounded-[1.6rem] border border-white/10 bg-[#0b100a]/95 p-5 shadow-[0_25px_80px_rgba(0,0,0,.42)] lg:sticky lg:top-6">
            <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]">Your droid</p>
            <h2 className="mt-2 text-2xl font-black uppercase tracking-[-0.04em]">Load a token</h2>
            <div className="mt-5 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-xl border border-white/12 bg-black/35 px-4 py-3 font-mono text-sm font-bold text-white outline-none transition placeholder:text-white/20 focus:border-[#c7ff00]/55"
                inputMode="numeric"
                min={1}
                max={HOODYOOR_MAX_SUPPLY}
                placeholder="Token ID"
                type="number"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void loadToken();
                }}
              />
              <button
                className="rounded-xl border border-[#c7ff00] bg-[#c7ff00] px-4 py-3 text-xs font-black uppercase text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.06] disabled:text-white/25"
                type="button"
                disabled={busy || config?.ready === false}
                onClick={() => void loadToken()}
              >
                {primaryLabel}
              </button>
            </div>
            <p className="mt-2 text-[0.68rem] font-semibold text-white/28">Collection is non-enumerable here, so enter one of your token IDs.</p>

            {token ? (
              <>
                <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                  {/* This route returns the exact generated SVG, so the native image element avoids raster optimization. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={token.imageUrl} alt={`HoodYØØR #${token.tokenId}`} className="aspect-square w-full bg-black object-contain [image-rendering:pixelated]" />
                  <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
                    <div>
                      <p className="text-sm font-black uppercase">HoodYØØR #{token.tokenId}</p>
                      <p className="mt-1 font-mono text-[0.62rem] text-white/35">{shortAddress(token.owner)}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[0.58rem] font-black uppercase ${token.ownedByWallet ? "border-[#c7ff00]/30 bg-[#c7ff00]/10 text-[#c7ff00]" : "border-red-300/25 bg-red-300/10 text-red-200"}`}>
                      {token.ownedByWallet ? "Owned" : "Not owned"}
                    </span>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
                    <p className="text-[0.56rem] font-black uppercase tracking-[0.14em] text-white/30">Energy</p>
                    <p className="mt-1 text-lg font-black text-[#c7ff00]">{formatEnergy(token.energyBalance)}</p>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
                    <p className="text-[0.56rem] font-black uppercase tracking-[0.14em] text-white/30">Reroll nonce</p>
                    <p className="mt-1 text-lg font-black text-white">{token.nonce}</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-5 grid aspect-square place-items-center rounded-2xl border border-dashed border-white/10 bg-black/20 p-8 text-center">
                <div>
                  <p className="text-4xl text-[#c7ff00]/35" aria-hidden="true">◇</p>
                  <p className="mt-3 text-sm font-black uppercase text-white/45">No token loaded</p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-white/25">Connect the owner wallet and load a minted HoodYØØR.</p>
                </div>
              </div>
            )}
          </aside>

          <div className="min-w-0 rounded-[1.6rem] border border-white/10 bg-[#0b100a]/95 p-5 shadow-[0_25px_80px_rgba(0,0,0,.42)] sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 pb-6">
              <div>
                <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]">Reroll console</p>
                <h2 className="mt-2 text-3xl font-black uppercase tracking-[-0.045em]">Choose what changes</h2>
              </div>
              {token ? (
                <span className="rounded-full border border-[#c7ff00]/20 bg-[#c7ff00]/[0.06] px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.12em] text-[#c7ff00]">
                  {formatPaymentCost(selectedPayment, selectedCost, config)}
                </span>
              ) : null}
            </div>

            {!token ? (
              <div className="grid min-h-[28rem] place-items-center py-12 text-center">
                <div className="max-w-sm">
                  <p className="text-5xl text-white/10" aria-hidden="true">↳</p>
                  <h3 className="mt-4 text-xl font-black uppercase text-white/55">Load your droid first</h3>
                  <p className="mt-3 text-sm font-semibold leading-6 text-white/28">Its live packed traits, Energy balance, and reroll nonce will be read directly from the configured chain.</p>
                </div>
              </div>
            ) : !preview ? (
              <>
                <div className="mt-6">
                  <button
                    className={`flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition ${action === "all" ? "border-[#c7ff00]/45 bg-[#c7ff00]/10" : "border-white/10 bg-white/[0.025] hover:border-white/20"}`}
                    type="button"
                    onClick={chooseRerollAll}
                  >
                    <span>
                      <span className="block text-sm font-black uppercase text-white">Reroll all filled traits</span>
                      <span className="mt-1 block text-xs font-semibold leading-5 text-white/38">Background and Droid stay locked; every filled mutable layer gets a different compatible trait.</span>
                    </span>
                    <span className="shrink-0 text-sm font-black text-[#c7ff00]">{formatEnergy(config?.rerollAllCost)} E</span>
                  </button>
                </div>

                <div className="mt-5">
                  <p className="text-[0.6rem] font-black uppercase tracking-[0.16em] text-white/32">Or reroll one filled layer</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {token.traits.filter((trait) => trait.mutable).map((trait) => {
                      const definition = config?.layers.find((item) => item.layer === trait.layer);
                      const empty = trait.traitId === 0;
                      const selected = action === "single" && layer === trait.layer;
                      return (
                        <button
                          className={`rounded-xl border p-3 text-left transition ${selected ? "border-[#c7ff00]/45 bg-[#c7ff00]/10" : "border-white/9 bg-black/20 hover:border-white/20"} disabled:cursor-not-allowed disabled:opacity-35`}
                          type="button"
                          disabled={empty}
                          onClick={() => chooseSingleLayer(trait.layer)}
                          key={trait.layer}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[0.58rem] font-black uppercase tracking-[0.12em] text-[#c7ff00]/75">{trait.slot}</span>
                            <span className="text-[0.58rem] font-black text-white/30">{definition?.energyCost || 0} E</span>
                          </span>
                          <span className="mt-2 block truncate text-xs font-bold text-white/75">{empty ? "Empty · locked" : trait.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-7">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-[0.6rem] font-black uppercase tracking-[0.16em] text-white/32">Choose payment</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-white/32">Your preview and final signatures lock this choice and exact amount.</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {([
                      {
                        id: "energy",
                        label: "Energy",
                        note: !config?.energyRelayerReady
                          ? "Relayer unavailable"
                          : energyBalance < BigInt(selectedCost)
                            ? "Insufficient balance"
                            : "Gasless",
                        disabled: !energyAvailable,
                      },
                      { id: "eth", label: "ETH", note: "Wallet pays gas", disabled: false },
                      { id: "usdg", label: "USDG", note: "Approval may be needed", disabled: false },
                    ] as Array<{ id: HoodYoorRerollPayment; label: string; note: string; disabled: boolean }>).map((option) => {
                      const selected = selectedPayment === option.id;
                      return (
                        <button
                          aria-pressed={selected}
                          className={`rounded-xl border p-3 text-left transition ${selected ? "border-[#c7ff00]/50 bg-[#c7ff00]/10" : "border-white/9 bg-black/20 hover:border-white/20"} disabled:cursor-not-allowed disabled:opacity-35`}
                          disabled={option.disabled}
                          key={option.id}
                          onClick={() => {
                            setPayment(option.id);
                            setError("");
                          }}
                          type="button"
                        >
                          <span className="block text-xs font-black uppercase text-white">{option.label}</span>
                          <span className="mt-1 block text-sm font-black text-[#c7ff00]">{formatPaymentCost(option.id, selectedCost, config)}</span>
                          <span className="mt-1 block text-[0.62rem] font-semibold text-white/32">{option.note}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-7 rounded-2xl border border-white/8 bg-black/25 p-4">
                  <div className="flex gap-3">
                    <span className="mt-0.5 text-[#c7ff00]" aria-hidden="true">◇</span>
                    <div>
                      <p className="text-sm font-black uppercase">Preview is free</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-white/38">Your first signature only proves ownership and requests one result. No Energy, ETH, or USDG moves until you accept the exact EIP-712 authorization.</p>
                    </div>
                  </div>
                </div>

                <button
                  className="mt-5 flex min-h-14 w-full items-center justify-center rounded-xl border border-[#c7ff00] bg-[#c7ff00] px-5 py-4 text-sm font-black uppercase tracking-[0.08em] text-black transition hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.06] disabled:text-white/25"
                  type="button"
                  disabled={busy || !token.ownedByWallet || !config?.ready || (action === "single" && layer === null)}
                  onClick={() => void generatePreview()}
                >
                  {flow === "signing-preview" ? "Sign free preview…" : flow === "generating" ? "Building exact preview…" : "Generate free preview"}
                </button>
              </>
            ) : (
              <>
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.6rem] font-black uppercase tracking-[0.16em] text-white/32">Compatibility-checked result</p>
                    <p className="mt-1 text-sm font-black uppercase text-white">{preview.layerName}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-2 font-mono text-xs font-bold ${previewExpired ? "border-red-300/25 bg-red-300/10 text-red-200" : "border-[#c7ff00]/25 bg-[#c7ff00]/10 text-[#c7ff00]"}`}>
                    {previewExpired ? "Expired" : `${remainingLabel(preview.expiresAt, clock)} left`}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {[
                    ["Current", preview.before.imageUrl],
                    ["Preview", preview.after.imageUrl],
                  ].map(([labelText, imageUrl]) => (
                    <figure className="overflow-hidden rounded-2xl border border-white/10 bg-black/35" key={labelText}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl} alt={`${labelText} HoodYØØR #${preview.tokenId}`} className="aspect-square w-full object-contain [image-rendering:pixelated]" />
                      <figcaption className="border-t border-white/8 px-4 py-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-white/38">{labelText}</figcaption>
                    </figure>
                  ))}
                </div>

                <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
                  <div className="grid grid-cols-[0.7fr_1fr_1fr] gap-2 border-b border-white/8 bg-white/[0.035] px-4 py-3 text-[0.56rem] font-black uppercase tracking-[0.13em] text-white/30">
                    <span>Layer</span><span>Before</span><span>After</span>
                  </div>
                  {changes.map(({ before, after }) => (
                    <div className="grid grid-cols-[0.7fr_1fr_1fr] gap-2 border-b border-white/[0.06] px-4 py-3 text-xs last:border-b-0" key={before.layer}>
                      <span className="font-black uppercase text-[#c7ff00]/70">{before.slot}</span>
                      <span className="truncate font-semibold text-white/42">{before.name}</span>
                      <span className="truncate font-bold text-white">{after.name}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#c7ff00]/20 bg-[#c7ff00]/[0.055] p-4">
                  <div>
                    <p className="text-[0.58rem] font-black uppercase tracking-[0.14em] text-[#c7ff00]/70">Exact acceptance cost</p>
                    <p className="mt-1 text-2xl font-black text-[#c7ff00]">{formatPreviewCost(preview)}</p>
                  </div>
                  <div className="text-right text-xs font-semibold leading-5 text-white/38">
                    {preview.payment === "energy" ? <p>Balance: {formatEnergy(preview.energyBalance)} E</p> : null}
                    <p>{preview.payment === "energy" ? "Gas: covered by relayer" : "Gas: paid by owner wallet"}</p>
                    {preview.payment === "usdg" ? <p>USDG approval may be requested first</p> : null}
                  </div>
                </div>

                {confirmation ? (
                  <div className="mt-5 rounded-2xl border border-[#c7ff00]/35 bg-[#c7ff00]/10 p-5" role="status" aria-live="polite">
                    <div className="flex gap-4">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#c7ff00] text-xl font-black text-black">✓</span>
                      <div>
                        <h3 className="text-lg font-black uppercase text-[#c7ff00]">{confirmation.pending ? "Reroll submitted" : "Reroll confirmed"}</h3>
                        <p className="mt-1 text-sm font-semibold leading-6 text-white/60">
                          {confirmation.pending ? "The reroll transaction is pending onchain." : `HoodYØØR #${preview.tokenId} now uses the previewed traits.`}
                        </p>
                        {confirmation.transactionUrl ? (
                          <a className="mt-2 inline-flex text-xs font-black uppercase tracking-[0.12em] text-[#c7ff00] underline underline-offset-4" href={confirmation.transactionUrl} target="_blank" rel="noreferrer">
                            View transaction ↗
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : previewExpired ? (
                  <button
                    className="mt-5 min-h-14 w-full rounded-xl border border-white/15 bg-white/[0.06] px-5 py-4 text-sm font-black uppercase tracking-[0.08em] text-white transition hover:border-[#c7ff00]/35"
                    type="button"
                    onClick={() => {
                      setPreview(null);
                      setError("");
                    }}
                  >
                    Start a new preview
                  </button>
                ) : (
                  <button
                    className="mt-5 flex min-h-14 w-full items-center justify-center rounded-xl border border-[#c7ff00] bg-[#c7ff00] px-5 py-4 text-sm font-black uppercase tracking-[0.08em] text-black transition hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                    disabled={busy}
                    onClick={() => void acceptPreview()}
                  >
                    {acceptanceLabel}
                  </button>
                )}
                {!confirmation ? (
                  <p className="mt-3 text-center text-[0.68rem] font-semibold leading-5 text-white/28">Acceptance authorizes only these packed traits, this token nonce, this payment method and exact amount, and this deadline.</p>
                ) : null}
              </>
            )}

            {error ? (
              <div className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm font-bold leading-6 text-red-100" role="alert" aria-live="assertive">
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-6 text-[0.6rem] font-black uppercase tracking-[0.13em] text-white/25">
          <span>Chain ID {config?.chainId || "—"}</span>
          <span>201 onchain traits · 329 frozen compatibility pairs</span>
          <span>No trait or payment change without acceptance</span>
        </div>
      </section>
    </main>
  );
}
