// netlify/functions/quote.js
// Kuru Flow quote + transaction normalizer for Monad (chainId 143).

import { decodeFunctionResult, encodeFunctionData } from "viem";

const DEFAULT_KURU_API_URL = "https://ws.kuru.io";
const DEFAULT_KURU_FLOW_ROUTER = "0x0d3a1BE29E9dEd63c7a5678b31e847D68F71FFa2";
const DEFAULT_MONAD_RPC_URL = "https://rpc.monad.xyz";
const NATIVE = "0x0000000000000000000000000000000000000000";
const UI_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
const PAMPAM = "0x44812436147d162ce0a6b573dbcc7492ef117777";
const NAD_FUN_V2_ROUTER = "0x8986C8fD44eb85294A725a7e61AF35E76bA26F91";
const QUOTE_CACHE_TTL_MS = 10000;
const quoteCache = new Map();

const nadFunRouterAbi = [
  {
    type: "function",
    name: "getAmountOut",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "isBuy", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "buyWithNative",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "amountOutMin", type: "uint256" },
          { name: "token", type: "address" },
          { name: "to", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "sellToNative",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMin", type: "uint256" },
          { name: "token", type: "address" },
          { name: "to", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable",
  },
];

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

function isAddr(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || "");
}

function normalizeToken(value) {
  const token = String(value || "").trim();
  return token.toLowerCase() === UI_NATIVE ? NATIVE : token;
}

function parseBps(value, fallback) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(10000, Math.floor(n)));
}

function isSameToken(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

function isMonadToken(token) {
  return isSameToken(token, NATIVE) || isSameToken(token, WMON);
}

function minAmountOut(amount, slippageBps) {
  return (amount * BigInt(10000 - slippageBps)) / 10000n;
}

function hexValue(value) {
  return "0x" + BigInt(value || 0).toString(16);
}

async function rpcCall(to, data) {
  const rpcUrl = env("MONAD_RPC_URL", env("VITE_MONAD_RPC_URL", DEFAULT_MONAD_RPC_URL));
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) throw new Error(json?.error?.message || `Monad RPC HTTP ${res.status}`);
  return json?.result;
}

async function tryNadFunQuote({ sellToken, buyToken, sellAmount, taker, slippageBps, supportOn }) {
  const isBuy = isMonadToken(sellToken) && isSameToken(buyToken, PAMPAM);
  const isSell = isSameToken(sellToken, PAMPAM) && isMonadToken(buyToken);
  if (!isBuy && !isSell) return null;
  if ((isBuy && !isSameToken(sellToken, NATIVE)) || (isSell && !isSameToken(buyToken, NATIVE))) return null;

  const amountIn = BigInt(sellAmount);
  const quoteData = encodeFunctionData({
    abi: nadFunRouterAbi,
    functionName: "getAmountOut",
    args: [PAMPAM, amountIn, isBuy],
  });
  const quoteResult = await rpcCall(NAD_FUN_V2_ROUTER, quoteData);
  const amountOut = decodeFunctionResult({
    abi: nadFunRouterAbi,
    functionName: "getAmountOut",
    data: quoteResult,
  });
  if (amountOut <= 0n) return null;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const amountOutMin = minAmountOut(amountOut, slippageBps);
  const data = encodeFunctionData({
    abi: nadFunRouterAbi,
    functionName: isBuy ? "buyWithNative" : "sellToNative",
    args: isBuy
      ? [{ amountOutMin, token: PAMPAM, to: taker, deadline }]
      : [{ amountIn, amountOutMin, token: PAMPAM, to: taker, deadline }],
  });
  const warnings = [];
  if (supportOn) warnings.push("DYOOR support fee is not applied on Nad.fun routes.");

  return {
    ok: true,
    source: "nad-fun",
    buyAmount: amountOut.toString(),
    minBuyAmount: amountOutMin.toString(),
    priceImpactBps: null,
    route: {
      label: "Nad.fun",
      path: [NAD_FUN_V2_ROUTER],
      raw: { router: NAD_FUN_V2_ROUTER, token: PAMPAM, version: "V2", side: isBuy ? "buy" : "sell" },
    },
    issues: {
      allowance: { spender: isBuy ? "" : NAD_FUN_V2_ROUTER },
    },
    warnings,
    fee: null,
    transaction: {
      to: NAD_FUN_V2_ROUTER,
      data,
      value: isBuy ? hexValue(amountIn) : "0x0",
    },
    nadFun: {
      router: NAD_FUN_V2_ROUTER,
      token: PAMPAM,
      version: "V2",
      side: isBuy ? "buy" : "sell",
    },
  };
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `Kuru API HTTP ${res.status}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function findStringDeep(value, keys) {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].startsWith("0x")) return value[key];
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findStringDeep(child, keys);
      if (found) return found;
    }
  }
  return "";
}

function findTxDeep(value) {
  if (!value || typeof value !== "object") return null;
  const to = value.to || value.toAddress || value.target || value.router;
  const data = value.data || value.calldata || value.callData || value.txData;
  const normalizedData = typeof data === "string"
    ? (data.startsWith("0x") ? data : `0x${data}`)
    : "";
  if (isAddr(to) && /^0x[a-fA-F0-9]*$/.test(normalizedData)) {
    const rawValue = value.value ?? value.ethValue ?? value.nativeValue ?? "0";
    return {
      to,
      data: normalizedData,
      value: typeof rawValue === "string" && rawValue.startsWith("0x")
        ? rawValue
        : "0x" + BigInt(rawValue || 0).toString(16),
    };
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findTxDeep(child);
      if (found) return found;
    }
  }
  return null;
}

function extractMarketPath(path) {
  if (!path || typeof path !== "object") return [];
  const candidates = [
    path.marketAddresses,
    path.markets,
    path.marketPath,
    path.route?.marketAddresses,
    path.route?.markets,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => typeof item === "string" ? item : (item?.address || item?.market || ""))
        .filter(isAddr);
    }
  }
  return [];
}

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return json(204, { ok: true });

    const url = new URL(request.url);
    const q = url.searchParams;
    if (!q.get("sellToken") && !q.get("buyToken")) {
      const feeBps = parseBps(env("DYOOR_SWAP_FEE_BPS", env("VITE_DYOOR_SWAP_FEE_BPS", "20")), 20);
      const treasury = env("DYOOR_TREASURY", env("VITE_DYOOR_TREASURY"));
      return json(200, {
        ok: true,
        msg: "Kuru Flow quote function online",
        source: "kuru-flow",
        feeBps,
        treasury: isAddr(treasury) ? treasury : "",
        kuruApiUrlConfigured: !!env("KURU_API_URL", env("VITE_KURU_API_URL")),
        routerAddress: env("KURU_ROUTER_ADDRESS", env("VITE_KURU_ROUTER_ADDRESS", DEFAULT_KURU_FLOW_ROUTER)),
      });
    }

    const chainId = Number(q.get("chainId") || "143");
    if (chainId !== 143) return json(400, { error: "Wrong network. Switch to Monad." });

    const sellToken = normalizeToken(q.get("sellToken"));
    const buyToken = normalizeToken(q.get("buyToken"));
    const sellAmount = String(q.get("sellAmount") || "");
    const taker = q.get("taker");
    const slippageBps = parseBps(q.get("slippageBps"), 50);
    const supportOn = q.get("support") === "1";
    const treasury = env("DYOOR_TREASURY", env("VITE_DYOOR_TREASURY"));
    const feeBps = parseBps(env("DYOOR_SWAP_FEE_BPS", env("VITE_DYOOR_SWAP_FEE_BPS", "20")), 20);

    if (!isAddr(sellToken) || !isAddr(buyToken)) return json(400, { error: "Invalid token address" });
    if (!isAddr(taker)) return json(400, { error: "Connect wallet before quoting." });
    if (!/^\d+$/.test(sellAmount) || BigInt(sellAmount) <= 0n) {
      return json(400, { error: "Enter a valid amount." });
    }
    if (supportOn && !isAddr(treasury)) {
      return json(400, { error: "Support DYOOR treasury is not configured." });
    }

    const base = env("KURU_API_URL", env("VITE_KURU_API_URL", DEFAULT_KURU_API_URL)).replace(/\/+$/, "");
    const cacheKey = JSON.stringify({ base, sellToken, buyToken, sellAmount, taker, slippageBps, supportOn, treasury, feeBps });
    const cached = quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < QUOTE_CACHE_TTL_MS) {
      return json(200, { ...cached.body, cached: true });
    }

    try {
      const nadFun = await tryNadFunQuote({ sellToken, buyToken, sellAmount, taker, slippageBps, supportOn });
      if (nadFun) {
        quoteCache.set(cacheKey, { ts: Date.now(), body: nadFun });
        return json(200, nadFun);
      }
    } catch (_err) {}

    const tokenResponse = await postJson(`${base}/api/generate-token`, { user_address: taker });
    const jwt = tokenResponse?.token;
    if (!jwt) throw new Error("Kuru API unavailable: token response missing JWT");

    const quoteBody = {
      userAddress: taker,
      tokenIn: sellToken,
      tokenOut: buyToken,
      amount: sellAmount,
      slippageTolerance: Math.max(1, slippageBps),
      autoSlippage: false,
    };
    if (supportOn && feeBps > 0) {
      quoteBody.referrerAddress = treasury;
      quoteBody.referrerFeeBps = feeBps;
    }

    const kuru = await postJson(`${base}/api/quote`, quoteBody, { authorization: `Bearer ${jwt}` });
    if (kuru?.status === "error") {
      const message = kuru?.message || kuru?.error || "No route found on Kuru Flow.";
      const status = /rate/i.test(message) ? 429 : 502;
      return json(status, { error: message });
    }

    const output = kuru?.output || kuru?.amountOut || kuru?.quote?.output;
    if (!output || !/^\d+$/.test(String(output))) {
      return json(502, { error: kuru?.message || "Kuru Flow returned no executable route." });
    }

    const tx = findTxDeep(kuru?.buildResponse) || findTxDeep(kuru);
    if (!tx) {
      return json(502, {
        error: "Kuru Flow quote loaded, but transaction data was not returned. Set VITE_KURU_ROUTER_ADDRESS only after confirming the current Kuru buildResponse schema.",
        buyAmount: String(output),
        route: { label: "Kuru Flow", path: extractMarketPath(kuru?.path), raw: kuru?.path || null },
      });
    }

    const spender = findStringDeep(kuru?.buildResponse || kuru, ["spender", "approvalAddress", "allowanceTarget"])
      || env("KURU_ROUTER_ADDRESS", env("VITE_KURU_ROUTER_ADDRESS", DEFAULT_KURU_FLOW_ROUTER));
    const warnings = [];
    if (supportOn && feeBps > 0) {
      warnings.push("Support DYOOR fee is included through Kuru Flow referrer fee support");
    }

    const body = {
      ok: true,
      source: "kuru-flow",
      buyAmount: String(output),
      minBuyAmount: String(kuru?.minOut || kuru?.minOutput || kuru?.amountOutMin || ""),
      priceImpactBps: kuru?.priceImpactBps ?? kuru?.priceImpact ?? null,
      route: {
        label: "Kuru Flow",
        path: extractMarketPath(kuru?.path),
        raw: kuru?.path || null,
      },
      issues: {
        allowance: { spender },
      },
      warnings,
      fee: supportOn && feeBps > 0
        ? { enabled: true, mode: "kuru-referrer", bps: feeBps, recipient: treasury, token: sellToken, amount: "0" }
        : null,
      transaction: tx,
      kuru,
    };
    quoteCache.set(cacheKey, { ts: Date.now(), body });
    return json(200, body);
  } catch (e) {
    const message = e?.message || "Kuru Flow quote failed";
    const status = e?.status || (/rate/i.test(message) ? 429 : 500);
    return json(status, { error: message, details: e?.details || null });
  }
};
