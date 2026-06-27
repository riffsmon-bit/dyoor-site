"use client";

/* eslint-disable @next/next/no-img-element */

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import swapBrand from "@/assets/swap_brand.jpg";
import { useWalletService } from "@/providers/WalletServiceProvider";
import {
  Eip1193Provider,
  SWAP_CHAIN_ID_DEC,
  SWAP_CHAIN_ID_HEX,
  SWAP_MONAD_RPC,
  TOKEN_CACHE_KEY,
  SwapQuote,
  SwapToken,
  baseSwapTokens,
  fetchTokenList,
  formatUnits,
  hexAmount,
  isAddress,
  isNativeToken,
  mergeTokenLists,
  normalizeLogo,
  normalizeSwapError,
  pad32,
  parseUnits,
  shortAddress,
  tokenBadge,
} from "@/lib/swap";

type StatusTone = "idle" | "ok" | "warn" | "err";
type Action = "locked" | "approve" | "swap";

const LOCAL_TOKENS = "/tokenlist.monad.json";
const COMMUNITY_TOKENS = "https://raw.githubusercontent.com/monad-crypto/token-list/main/tokenlist.json";
const QUOTE_ENDPOINTS = ["/api/quote", "/.netlify/functions/quote"];
const QUICK_SYMBOLS = ["MON", "WMON", "USDC", "BOB", "PamPam", "shramp", "BCHOG", "CHOG", "emo", "AUSD", "WETH", "sMON"];
const MAX_UINT256 = (1n << 256n) - 1n;

function slippageToBps(value: string) {
  const pct = Math.max(0.01, Math.min(50, Number(value || "0.5")));
  return Math.floor(pct * 100);
}

function statusClass(tone: StatusTone) {
  if (tone === "ok") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (tone === "warn") return "border-yellow-300/35 bg-yellow-300/10 text-yellow-100";
  if (tone === "err") return "border-red-400/35 bg-red-400/10 text-red-100";
  return "border-white/15 bg-white/[0.04] text-white/72";
}

function TokenLogo({ token, className = "h-8 w-8" }: { token: SwapToken; className?: string }) {
  const fallback = tokenBadge(token.symbol);
  return (
    <img
      alt=""
      className={`${className} rounded-full bg-white/10 object-cover`}
      src={normalizeLogo(token.logoURI) || fallback}
      onError={(event) => {
        event.currentTarget.src = fallback;
      }}
    />
  );
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data?.ok === false) {
    const error = new Error(typeof data?.error === "string" ? data.error : `Request failed (${response.status})`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return data as T;
}

async function fetchQuoteJson<T>(query = "", options?: RequestInit): Promise<T> {
  let lastError: unknown;
  for (const endpoint of QUOTE_ENDPOINTS) {
    try {
      return await fetchJson<T>(`${endpoint}${query}`, options);
    } catch (error) {
      lastError = error;
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
      if (status && status !== 404 && status !== 405) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Quote API unavailable.");
}

export function SwapCard() {
  const walletService = useWalletService();
  const authenticated = walletService.connected;
  const walletAddress = walletService.address || "";

  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [tokens, setTokens] = useState<SwapToken[]>(baseSwapTokens);
  const [fromToken, setFromToken] = useState<SwapToken>(baseSwapTokens[0]);
  const [toToken, setToToken] = useState<SwapToken>(baseSwapTokens[2]);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("-");
  const [slippage, setSlippage] = useState("0.5");
  const [fromBalanceRaw, setFromBalanceRaw] = useState<bigint | null>(null);
  const [fromBalance, setFromBalance] = useState("Balance: -");
  const [toBalance, setToBalance] = useState("Balance: -");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [routeLine, setRouteLine] = useState("Route: -");
  const [priceImpactLine, setPriceImpactLine] = useState("Price impact: unavailable");
  const [approvalLine, setApprovalLine] = useState("Approval: connect wallet");
  const [quoteDebug, setQuoteDebug] = useState("Quote API: waiting");
  const [supportFeeBps, setSupportFeeBps] = useState(20);
  const [treasury, setTreasury] = useState("");
  const [status, setStatus] = useState("Enter an amount. Quotes update automatically.");
  const [tone, setTone] = useState<StatusTone>("idle");
  const [action, setAction] = useState<Action>("locked");
  const [busy, setBusy] = useState(false);
  const [modalTarget, setModalTarget] = useState<"from" | "to" | null>(null);
  const [tokenQuery, setTokenQuery] = useState("");
  const [tokenTab, setTokenTab] = useState<"popular" | "all">("popular");

  const accountLine = walletAddress ? `Monad - ${shortAddress(walletAddress)}` : "Not connected";
  const supportCopy = `Fee: ${(supportFeeBps / 100).toFixed(2)}% ${isAddress(treasury) && supportFeeBps > 0 ? "included" : "not configured"} | Treasury: ${treasury ? shortAddress(treasury) : "not configured"}`;

  const visibleTokens = useMemo(() => {
    const base = tokenTab === "all"
      ? tokens
      : QUICK_SYMBOLS.map((symbol) => tokens.find((token) => token.symbol === symbol)).filter(Boolean) as SwapToken[];
    const query = tokenQuery.trim().toLowerCase();
    if (!query || isAddress(query)) return base;
    return base.filter((token) => [token.symbol, token.name, token.address].some((part) => String(part || "").toLowerCase().includes(query)));
  }, [tokenQuery, tokenTab, tokens]);

  const getProvider = useCallback(async () => {
    return await walletService.getProvider() as Eip1193Provider;
  }, [walletService]);

  const call = useCallback(async (to: string, data: string) => {
    const active = provider || await getProvider();
    return await active.request({ method: "eth_call", params: [{ to, data }, "latest"] }) as string;
  }, [getProvider, provider]);

  const ensureChain = useCallback(async () => {
    const active = provider || await getProvider();
    const chainId = await active.request({ method: "eth_chainId" }).catch(() => "");
    if (String(chainId).toLowerCase() === SWAP_CHAIN_ID_HEX) return true;
    try {
      await active.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SWAP_CHAIN_ID_HEX }] });
      return true;
    } catch {
      await active.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: SWAP_CHAIN_ID_HEX,
          chainName: "Monad",
          rpcUrls: [SWAP_MONAD_RPC],
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          blockExplorerUrls: ["https://monadscan.com"],
        }],
      });
      return true;
    }
  }, [getProvider, provider]);

  const readBalance = useCallback(async (token: SwapToken, owner: string) => {
    const active = provider || await getProvider();
    if (isNativeToken(token)) {
      const result = await active.request({ method: "eth_getBalance", params: [owner, "latest"] }) as string;
      return BigInt(result || "0x0");
    }
    const result = await active.request({ method: "eth_call", params: [{ to: token.address, data: `0x70a08231${pad32(owner)}` }, "latest"] }) as string;
    return BigInt(result || "0x0");
  }, [getProvider, provider]);

  const readAllowance = useCallback(async (token: SwapToken, owner: string, spender: string) => {
    const result = await call(token.address, `0xdd62ed3e${pad32(owner)}${pad32(spender)}`);
    return BigInt(result || "0x0");
  }, [call]);

  const refreshBalances = useCallback(async () => {
    if (!walletAddress) {
      setFromBalanceRaw(null);
      setFromBalance("Balance: -");
      setToBalance("Balance: -");
      return;
    }
    try {
      const [from, to] = await Promise.all([readBalance(fromToken, walletAddress), readBalance(toToken, walletAddress)]);
      setFromBalanceRaw(from);
      setFromBalance(`Balance: ${formatUnits(from, fromToken.decimals)} ${fromToken.symbol}`);
      setToBalance(`Balance: ${formatUnits(to, toToken.decimals)} ${toToken.symbol}`);
    } catch {
      setFromBalanceRaw(null);
      setFromBalance("Balance: -");
      setToBalance("Balance: -");
    }
  }, [fromToken, readBalance, toToken, walletAddress]);

  const updateAction = useCallback(async (nextQuote: SwapQuote | null) => {
    if (!walletAddress) {
      setAction("locked");
      setApprovalLine("Approval: connect wallet");
      return;
    }
    if (!nextQuote) {
      setAction("swap");
      setApprovalLine("Approval: waiting for quote");
      return;
    }
    if (isNativeToken(fromToken)) {
      setAction("swap");
      setApprovalLine("Approval: native MON does not need approval");
      return;
    }
    const spender = nextQuote.issues?.allowance?.spender || nextQuote.transaction?.to;
    const needed = parseUnits(fromAmount, fromToken.decimals) || 0n;
    try {
      if (!isAddress(spender)) throw new Error("Missing spender");
      const allowance = await readAllowance(fromToken, walletAddress, spender);
      if (allowance < needed) {
        setAction("approve");
        setApprovalLine("Approval: required");
        return;
      }
      setAction("swap");
      setApprovalLine("Approval: ready");
    } catch {
      setAction("approve");
      setApprovalLine("Approval: required");
    }
  }, [fromAmount, fromToken, readAllowance, walletAddress]);

  const loadQuote = useCallback(async () => {
    setQuote(null);
    setToAmount("-");
    if (!walletAddress) {
      setStatus("Connect wallet from the header to fetch Kuru Flow routes.");
      setTone("warn");
      setQuoteDebug("Quote API: waiting for wallet");
      await updateAction(null);
      return;
    }
    const amount = parseUnits(fromAmount, fromToken.decimals);
    if (!amount || amount <= 0n) {
      setStatus("Enter an amount. Quotes update automatically.");
      setTone("idle");
      setRouteLine("Route: -");
      setQuoteDebug("Quote API: waiting for amount");
      await updateAction(null);
      return;
    }
    try {
      await ensureChain();
      await refreshBalances();
      if (fromBalanceRaw != null && amount > fromBalanceRaw) {
        setStatus("Insufficient balance.");
        setTone("err");
        setQuoteDebug("Quote API: blocked by balance check");
        await updateAction(null);
        return;
      }
      setStatus("Fetching Kuru Flow quote...");
      setTone("idle");
      setQuoteDebug("Quote API: requesting route");
      const params = new URLSearchParams({
        sellToken: fromToken.address,
        buyToken: toToken.address,
        sellAmount: amount.toString(),
        chainId: String(SWAP_CHAIN_ID_DEC),
        slippageBps: String(slippageToBps(slippage)),
        taker: walletAddress,
        support: isAddress(treasury) && supportFeeBps > 0 ? "1" : "0",
      });
      const data = await fetchQuoteJson<SwapQuote>(`?${params.toString()}`, { cache: "no-cache" });
      if (!data.transaction) throw new Error("No executable route returned by Kuru Flow.");
      setQuote(data);
      if (data.fee?.bps != null) setSupportFeeBps(Number(data.fee.bps));
      if (data.fee?.recipient) setTreasury(data.fee.recipient);
      setToAmount(formatUnits(data.buyAmount, toToken.decimals));
      const hops = Array.isArray(data.route?.path) ? data.route.path.length : 0;
      setRouteLine(`Route: ${data.route?.label || "Kuru Flow"}${hops ? ` - ${hops} market hop${hops === 1 ? "" : "s"}` : ""}`);
      const impact = Number(data.priceImpactBps);
      setPriceImpactLine(Number.isFinite(impact) ? `Price impact: ${(impact / 100).toFixed(2)}%` : "Price impact: unavailable");
      setQuoteDebug(`Quote API: ok (${data.source || "local"})`);
      setStatus(data.warnings?.length ? data.warnings.join(" | ") : "Quote loaded.");
      setTone(data.warnings?.length ? "warn" : "ok");
      await updateAction(data);
    } catch (error) {
      setRouteLine("Route: -");
      setQuoteDebug(`Quote API: ${normalizeSwapError(error).slice(0, 140)}`);
      setStatus(normalizeSwapError(error));
      setTone("err");
      await updateAction(null);
    }
  }, [ensureChain, fromAmount, fromBalanceRaw, fromToken, refreshBalances, slippage, supportFeeBps, toToken, treasury, updateAction, walletAddress]);

  useEffect(() => {
    async function loadProvider() {
      if (!walletAddress) {
        setProvider(null);
        return;
      }
      try {
        setProvider(await getProvider());
      } catch {
        setProvider(null);
      }
    }
    void loadProvider();
  }, [getProvider, walletAddress]);

  useEffect(() => {
    async function loadInitialConfig() {
      try {
        const config = await fetchQuoteJson<{ feeBps?: number; treasury?: string }>("", { cache: "no-cache" });
        if (config.feeBps != null) setSupportFeeBps(Number(config.feeBps));
        if (config.treasury) setTreasury(config.treasury);
      } catch {}
    }
    void loadInitialConfig();
  }, []);

  useEffect(() => {
    async function loadTokens() {
      try {
        const cached = JSON.parse(localStorage.getItem(TOKEN_CACHE_KEY) || "null") as { ts?: number; tokens?: SwapToken[] } | null;
        if (cached?.ts && Date.now() - cached.ts < 86_400_000 && Array.isArray(cached.tokens)) {
          setTokens(mergeTokenLists([cached.tokens]));
          return;
        }
      } catch {}
      const lists = await Promise.allSettled([fetchTokenList(LOCAL_TOKENS), fetchTokenList(COMMUNITY_TOKENS)]);
      const next = mergeTokenLists(lists.map((result) => result.status === "fulfilled" ? result.value : undefined));
      setTokens(next);
      setFromToken(next.find((token) => token.symbol === "MON") || baseSwapTokens[0]);
      setToToken(next.find((token) => token.symbol === "USDC") || baseSwapTokens[2]);
      try {
        localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ ts: Date.now(), tokens: next }));
      } catch {}
    }
    void loadTokens();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshBalances();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshBalances]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadQuote();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [loadQuote]);

  useEffect(() => {
    if (!modalTarget) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalTarget]);

  function chooseToken(token: SwapToken) {
    if (!modalTarget) return;
    setQuote(null);
    setToAmount("-");
    if (modalTarget === "from") {
      setFromToken(token);
      if (token.address.toLowerCase() === toToken.address.toLowerCase()) {
        setToToken(tokens.find((item) => item.symbol === "USDC") || baseSwapTokens[2]);
      }
    } else {
      setToToken(token);
      if (token.address.toLowerCase() === fromToken.address.toLowerCase()) {
        setFromToken(baseSwapTokens[0]);
      }
    }
    setModalTarget(null);
    setTokenQuery("");
  }

  function flipTokens() {
    setFromToken(toToken);
    setToToken(fromToken);
    setQuote(null);
    setToAmount("-");
  }

  function setMax() {
    if (fromBalanceRaw == null) return;
    let amount = fromBalanceRaw;
    if (isNativeToken(fromToken)) {
      const buffer = 5n * 10n ** 16n;
      amount = amount > buffer ? amount - buffer : 0n;
    }
    setFromAmount(formatUnits(amount, fromToken.decimals, 8));
  }

  async function sendTx(tx: SwapQuote["transaction"]) {
    const active = provider || await getProvider();
    const request: Record<string, string> = { from: walletAddress, to: tx.to, data: tx.data || "0x" };
    if (tx.value && BigInt(tx.value) > 0n) request.value = `0x${BigInt(tx.value).toString(16)}`;
    return await active.request({ method: "eth_sendTransaction", params: [request] }) as string;
  }

  async function waitReceipt(hash: string) {
    const active = provider || await getProvider();
    const started = Date.now();
    while (Date.now() - started < 120_000) {
      const receipt = await active.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null) as { blockNumber?: string } | null;
      if (receipt?.blockNumber) return receipt;
      await new Promise((resolve) => window.setTimeout(resolve, 1800));
    }
    throw new Error("RPC failure: timed out waiting for confirmation");
  }

  async function approve() {
    if (!quote || busy) return;
    try {
      setBusy(true);
      await ensureChain();
      const spender = quote.issues?.allowance?.spender || quote.transaction?.to;
      if (!isAddress(spender)) throw new Error("Approval spender unavailable.");
      setStatus(`Approving ${fromToken.symbol}...`);
      setTone("warn");
      const data = `0x095ea7b3${pad32(spender)}${hexAmount(MAX_UINT256)}`;
      const hash = await sendTx({ to: fromToken.address, data, value: "0" });
      setStatus("Approval submitted. Waiting for confirmation...");
      await waitReceipt(hash);
      setStatus("Approval confirmed. Swap is ready.");
      setTone("ok");
      await updateAction(quote);
    } catch (error) {
      setStatus(/rejected|denied/i.test(normalizeSwapError(error)) ? "User rejected approval." : "Approval failed.");
      setTone("err");
    } finally {
      setBusy(false);
    }
  }

  async function swap() {
    if (!quote || busy) return;
    try {
      setBusy(true);
      await ensureChain();
      setStatus("Open wallet and confirm swap...");
      setTone("idle");
      const hash = await sendTx(quote.transaction);
      setStatus("Swap submitted. Waiting for confirmation...");
      await waitReceipt(hash);
      setStatus("Swap confirmed.");
      setTone("ok");
      setFromAmount("");
      setToAmount("-");
      setQuote(null);
      setRouteLine("Route: -");
      await refreshBalances();
      await updateAction(null);
    } catch (error) {
      setStatus(/rejected|denied/i.test(normalizeSwapError(error)) ? "User rejected swap." : normalizeSwapError(error));
      setTone("err");
      await updateAction(quote);
    } finally {
      setBusy(false);
    }
  }

  async function primaryAction() {
    if (!authenticated || !walletAddress) {
      await walletService.connect();
      return;
    }
    if (action === "approve") {
      await approve();
      return;
    }
    await swap();
  }

  const ctaLabel = !walletAddress ? "Connect wallet to swap" : action === "approve" ? `Approve ${fromToken.symbol}` : "Swap";
  const ctaDisabled = busy || (Boolean(walletAddress) && action === "swap" && !quote);

  return (
    <div id="swap" className="rounded-[26px] border border-dyoor-purple/30 bg-[radial-gradient(900px_360px_at_12%_8%,rgba(57,255,226,.16),transparent_58%),radial-gradient(900px_360px_at_88%_0%,rgba(131,110,249,.30),transparent_58%),linear-gradient(135deg,rgba(7,7,22,.92),rgba(13,8,36,.78))] p-4 shadow-[0_0_60px_rgba(131,110,249,.18)] md:p-6">
      <div className="mx-auto mb-5 max-w-3xl text-center">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-dyoor-cyan">Kuru Flow Router</p>
        <h2 className="mt-3 bg-gradient-to-r from-white via-dyoor-cyan to-dyoor-monad bg-clip-text text-4xl font-black uppercase leading-none text-transparent md:text-5xl">Swap DYOOR Tewkens</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-white/62 md:text-base">
          Powered by Kuru Flow. Routes and liquidity are provided by Kuru Flow and third-party Monad liquidity sources.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.02fr)_minmax(300px,.78fr)]">
        <section className="rounded-[22px] border border-dyoor-purple/25 bg-black/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.06)] md:p-5" aria-label="Swap DYOOR Tewkens">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-2xl font-black uppercase leading-none tracking-tight text-white">Swap DYOOR Tewkens</h3>
              <p className="mt-1 text-sm font-bold text-white/62">Powered by Kuru Flow</p>
            </div>
            {!walletAddress && (
              <button className="rounded border border-white/18 px-3 py-2 text-xs font-black uppercase text-white/78" type="button" onClick={() => void walletService.connect()}>
                Connect Wallet
              </button>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-white/48">Network</div>
              <div className="text-sm font-bold text-white/72">Monad (143)</div>
            </div>
            <div className="text-sm font-bold text-white/72">{accountLine}</div>
          </div>

          <TokenAmountBlock
            balance={fromBalance}
            token={fromToken}
            title="Token input"
            onPick={() => setModalTarget("from")}
          >
            <div className="relative">
              <input
                className="field-control rounded-2xl py-4 pr-16 text-lg font-black"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.0"
                value={fromAmount}
                onChange={(event) => {
                  setFromAmount(event.target.value);
                  setQuote(null);
                  setToAmount("-");
                }}
              />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-dyoor-purple/24 bg-white/[0.045] px-3 py-1.5 text-xs font-black text-white/75 transition hover:border-dyoor-cyan/40 hover:text-dyoor-cyan" type="button" onClick={setMax}>
                MAX
              </button>
            </div>
          </TokenAmountBlock>

          <div className="relative my-2 h-9">
            <div className="absolute inset-x-0 top-1/2 h-px bg-white/12" />
            <button className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dyoor-purple/40 bg-black/85 text-2xl font-black text-dyoor-cyan" type="button" onClick={flipTokens} aria-label="Flip tokens">
              ⇅
            </button>
          </div>

          <TokenAmountBlock
            balance={toBalance}
            token={toToken}
            title="Token output"
            onPick={() => setModalTarget("to")}
          >
            <div className="flex min-h-[58px] items-center rounded-2xl border border-white/10 bg-black/35 px-4 text-2xl font-black tracking-tight text-white">
              {toAmount}
            </div>
          </TokenAmountBlock>

          <div className="my-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-black text-white/80">
              <span>Slippage</span>
              <input
                className="w-20 rounded-full border border-white/14 bg-black/35 px-3 py-1.5 text-sm font-black text-white outline-none"
                type="number"
                min="0.01"
                max="50"
                step="0.1"
                value={slippage}
                onChange={(event) => setSlippage(event.target.value)}
              />
              <span>%</span>
            </label>
            <div className="rounded-full border border-dyoor-cyan/25 bg-dyoor-cyan/10 px-3 py-2 text-sm font-black text-white shadow-[0_0_18px_rgba(57,255,226,.10)]">DYOOR support built in</div>
          </div>

          <div className="mb-3 grid gap-1 rounded-2xl border border-dyoor-purple/25 bg-[linear-gradient(135deg,rgba(57,255,226,.08),rgba(131,110,249,.10))] p-3 text-sm leading-6 text-white/78">
            <strong className="text-white">Support DYOOR</strong>
            <span>By using the DYOOR swap, you support DYOOR and the Monad ecosystem through a transparent treasury fee when configured.</span>
            <span>{supportCopy}</span>
          </div>

          <div className="mb-3 grid gap-1 text-sm font-bold text-white/64">
            <div>{routeLine}</div>
            <div>{priceImpactLine}</div>
            <div>{approvalLine}</div>
            <div>{quoteDebug}</div>
          </div>

          <div className={`mb-3 min-h-11 rounded-2xl border px-4 py-3 text-sm font-black leading-6 ${statusClass(tone)}`}>
            {status}
          </div>
          <button
            className="btn-primary w-full py-4 disabled:opacity-50"
            type="button"
            disabled={ctaDisabled}
            onClick={() => void primaryAction()}
          >
            {busy ? "Working..." : ctaLabel}
          </button>

          <p className="mt-3 text-xs leading-5 text-white/52">Not financial advice. Always verify token addresses before swapping.</p>
        </section>

        <aside className="relative min-h-[340px] overflow-hidden rounded-[22px] border border-dyoor-purple/25 bg-black shadow-[0_0_30px_rgba(131,110,249,.12)] lg:min-h-full">
          <Image src={swapBrand} alt="DYOOR swap artwork" fill sizes="(max-width: 1024px) 100vw, 420px" className="object-cover opacity-80" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,8,12,.05),rgba(5,8,12,.92)),radial-gradient(420px_220px_at_72%_20%,rgba(131,110,249,.28),transparent_60%),radial-gradient(360px_220px_at_20%_70%,rgba(57,255,226,.14),transparent_60%)]" />
          <div className="relative z-10 flex min-h-full flex-col justify-end p-6">
            <h3 className="text-4xl font-black uppercase leading-none tracking-tight text-white">Native flow, less noise.</h3>
            <p className="mt-3 max-w-sm text-sm font-semibold leading-6 text-white/76">
              Kuru Flow aggregates Monad liquidity for any-token-to-any-token routes. DYOOR support is transparent and shown before you sign.
            </p>
          </div>
        </aside>
      </div>

      {modalTarget && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5">
          <button className="absolute inset-0 bg-black/75 backdrop-blur" type="button" aria-label="Close token picker" onClick={() => setModalTarget(null)} />
          <div className="relative flex max-h-[80dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-[24px] border border-dyoor-purple/30 bg-[#0b0a1a] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_0_60px_rgba(131,110,249,.24)] sm:p-5" role="dialog" aria-modal="true" aria-label="Select token">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-black text-white">Select token</h3>
                <p className="mt-1 text-sm text-white/62">Search by symbol, name, or Monad token address.</p>
              </div>
              <button className="h-10 w-10 rounded-xl bg-white/10 text-white" type="button" onClick={() => setModalTarget(null)}>×</button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <input
                className="w-full rounded-2xl border border-white/12 bg-black/45 px-4 py-3 text-sm font-bold text-white outline-none focus:border-dyoor-cyan"
                placeholder="Search token"
                value={tokenQuery}
                onChange={(event) => setTokenQuery(event.target.value)}
              />
              <div className="my-3 flex flex-wrap gap-2">
                <button className={`rounded-full border px-3 py-2 text-xs font-black uppercase ${tokenTab === "popular" ? "border-dyoor-purple/40 bg-dyoor-purple/20 text-white" : "border-white/12 bg-white/[0.04] text-white/72"}`} type="button" onClick={() => setTokenTab("popular")}>Popular</button>
                <button className={`rounded-full border px-3 py-2 text-xs font-black uppercase ${tokenTab === "all" ? "border-dyoor-purple/40 bg-dyoor-purple/20 text-white" : "border-white/12 bg-white/[0.04] text-white/72"}`} type="button" onClick={() => setTokenTab("all")}>All tokens</button>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {QUICK_SYMBOLS.map((symbol) => {
                  const token = tokens.find((item) => item.symbol === symbol);
                  if (!token) return null;
                  return (
                    <button key={symbol} className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-black text-white/78" type="button" onClick={() => chooseToken(token)}>
                      {symbol}
                    </button>
                  );
                })}
              </div>
              <div className="grid min-h-0 flex-1 gap-2 overflow-auto overscroll-contain pr-1">
                {visibleTokens.map((token) => (
                  <button key={token.address.toLowerCase()} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-white hover:border-dyoor-purple/40 hover:bg-dyoor-purple/10" type="button" onClick={() => chooseToken(token)}>
                    <TokenLogo token={token} className="h-9 w-9" />
                    <span className="min-w-0">
                      <span className="block text-base font-black leading-none">{token.symbol}</span>
                      <span className="mt-1 block truncate text-sm text-white/58">{token.name}</span>
                    </span>
                    <span className="text-xs font-bold text-white/46">{shortAddress(token.address)}</span>
                  </button>
                ))}
                {!visibleTokens.length && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm font-bold text-white/62">No token found.</div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function TokenAmountBlock({
  balance,
  children,
  onPick,
  title,
  token,
}: {
  balance: string;
  children: React.ReactNode;
  onPick: () => void;
  title: string;
  token: SwapToken;
}) {
  return (
    <div className="rounded-[20px] border border-dyoor-purple/20 bg-black/35 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-black text-white/68">{title}</div>
        <div className="text-right text-xs font-black text-white/58">{balance}</div>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(145px,.82fr)_minmax(0,1.18fr)]">
        <button className="flex w-full items-center justify-between gap-3 rounded-2xl border border-dyoor-purple/24 bg-black/50 p-3 text-white transition hover:border-dyoor-cyan/40" type="button" onClick={onPick} aria-haspopup="dialog">
          <span className="flex min-w-0 items-center gap-3">
            <TokenLogo token={token} />
            <span className="min-w-0 text-left">
              <span className="block text-xl font-black leading-none">{token.symbol}</span>
              <span className="mt-1 block max-w-40 truncate text-xs font-bold text-white/52">{token.name}</span>
            </span>
          </span>
          <span className="font-black text-white/60">▾</span>
        </button>
        {children}
      </div>
    </div>
  );
}
