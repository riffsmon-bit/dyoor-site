// netlify/functions/quote.js
// PancakeSwap V2 quote + calldata builder for Monad (chainId 143)

const RPC_URL = process.env.RPC_URL || "https://rpc.monad.xyz";

// PancakeSwap V2 on Monad (from PancakeSwap dev docs)
const PANCAKE_V2_ROUTER =
  process.env.PANCAKE_V2_ROUTER ||
  "0xB1Bc24c34e88f7D43D5923034E3a14B24DaACfF9";

// Wrapped MON (your site already uses this)
const WMON =
  process.env.WMON ||
  "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";

// Native sentinel your UI uses
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

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

function toLower(a) {
  return String(a || "").toLowerCase();
}

function isAddr(a) {
  return /^0x[a-fA-F0-9]{40}$/.test(a || "");
}

function hexPad32(bi) {
  let h = BigInt(bi).toString(16);
  if (h.length % 2) h = "0" + h;
  return h.padStart(64, "0");
}

function addrPad32(addr) {
  return toLower(addr).replace(/^0x/, "").padStart(64, "0");
}

// keccak selector for getAmountsOut(uint256,address[]) is 0xd06ca61f
function encodeGetAmountsOut(amountIn, path) {
  // ABI encoding:
  // 4 bytes selector
  // amountIn (32)
  // offset to path (32) = 0x40
  // path dynamic:
  //   length (32)
  //   addresses (32 each)
  const selector = "0xd06ca61f";
  const amountHex = hexPad32(amountIn);
  const offsetHex = hexPad32(64n);

  const lenHex = hexPad32(BigInt(path.length));
  const addrsHex = path.map((a) => addrPad32(a)).join("");

  return selector + amountHex + offsetHex + lenHex + addrsHex;
}

// swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline)
// selector = 0x7ff36ab5
function encodeSwapExactETHForTokens(amountOutMin, path, to, deadline) {
  const selector = "0x7ff36ab5";
  const outMinHex = hexPad32(amountOutMin);
  const offsetHex = hexPad32(128n); // 4 args before path: outMin, offset, to, deadline => offset points after them
  const toHex = addrPad32(to);
  const dlHex = hexPad32(deadline);

  const lenHex = hexPad32(BigInt(path.length));
  const addrsHex = path.map((a) => addrPad32(a)).join("");

  return selector + outMinHex + offsetHex + toHex + dlHex + lenHex + addrsHex;
}

// swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)
// selector = 0x38ed1739
function encodeSwapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline) {
  const selector = "0x38ed1739";
  const inHex = hexPad32(amountIn);
  const outMinHex = hexPad32(amountOutMin);
  const offsetHex = hexPad32(160n); // 5 args before path: in, outMin, offset, to, deadline
  const toHex = addrPad32(to);
  const dlHex = hexPad32(deadline);

  const lenHex = hexPad32(BigInt(path.length));
  const addrsHex = path.map((a) => addrPad32(a)).join("");

  return selector + inHex + outMinHex + offsetHex + toHex + dlHex + lenHex + addrsHex;
}

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  if (!data || data.error) throw new Error(data?.error?.message || "RPC error");
  return data.result;
}

function minOutWithSlippage(out, slippageBps) {
  const bps = BigInt(slippageBps);
  const outBn = BigInt(out);
  // minOut = out * (10000 - bps)/10000
  return (outBn * (10000n - bps)) / 10000n;
}

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return json(204, { ok: true });

    const url = new URL(request.url);
    const q = url.searchParams;

    // health check
    if (!q.get("sellToken") && !q.get("buyToken")) {
      return json(200, { ok: true, msg: "quote function online" });
    }

    const sellTokenRaw = q.get("sellToken");
    const buyTokenRaw = q.get("buyToken");
    const sellAmountRaw = q.get("sellAmount");
    const slippageBps = Number(q.get("slippageBps") || "50"); // default 0.50%
    const taker = q.get("taker"); // wallet addr

    if (!sellTokenRaw || !buyTokenRaw || !sellAmountRaw) {
      return json(400, { error: "Missing sellToken, buyToken, sellAmount" });
    }

    let sellToken = toLower(sellTokenRaw);
    let buyToken = toLower(buyTokenRaw);

    const sellAmount = BigInt(sellAmountRaw);

    // normalize native sentinel to WMON for routing
    const sellIsNative = sellToken === NATIVE;
    const buyIsNative = buyToken === NATIVE;

    if (sellIsNative) sellToken = toLower(WMON);
    if (buyIsNative) buyToken = toLower(WMON);

    if (!isAddr(sellToken) || !isAddr(buyToken)) {
      return json(400, { error: "Invalid token address" });
    }

    const router = toLower(PANCAKE_V2_ROUTER);
    if (!isAddr(router)) {
      return json(500, { error: "Bad router address config" });
    }

    // build a simple path:
    // - direct if either side is WMON or same token
    // - otherwise go through WMON
    let path;
    if (sellToken === buyToken) {
      path = [sellToken, buyToken];
    } else if (sellToken === toLower(WMON) || buyToken === toLower(WMON)) {
      path = [sellToken, buyToken];
    } else {
      path = [sellToken, toLower(WMON), buyToken];
    }

    // call getAmountsOut
    const callData = encodeGetAmountsOut(sellAmount, path);
    const raw = await rpcCall("eth_call", [{ to: router, data: callData }, "latest"]);

    // decode: dynamic uint[] => offset(32) + length(32) + values...
    // raw is hex string
    const hex = String(raw || "");
    if (!hex.startsWith("0x") || hex.length < 2 + 64 * 3) {
      return json(500, { error: "Bad getAmountsOut response" });
    }

    const buf = hex.slice(2);
    const offset = BigInt("0x" + buf.slice(0, 64));
    const lenPos = Number(offset) * 2; // bytes->hex chars
    const len = BigInt("0x" + buf.slice(lenPos, lenPos + 64));
    const n = Number(len);

    if (n < 2) return json(500, { error: "Bad amountsOut length" });

    // last element = amountOut
    const lastPos = lenPos + 64 + (n - 1) * 64;
    const amountOut = BigInt("0x" + buf.slice(lastPos, lastPos + 64));

    const amountOutMin = minOutWithSlippage(amountOut, slippageBps);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60); // +20 minutes

    // Build tx calldata for router
    let tx = { to: PANCAKE_V2_ROUTER, data: "0x", value: "0x0" };

    const toAddr = isAddr(taker) ? taker : "0x0000000000000000000000000000000000000000";

    if (sellIsNative) {
      // swapExactETHForTokens(outMin, path, to, deadline)
      const data = encodeSwapExactETHForTokens(amountOutMin, path, toAddr, deadline);
      tx = {
        to: PANCAKE_V2_ROUTER,
        data,
        value: "0x" + sellAmount.toString(16),
      };
    } else {
      // swapExactTokensForTokens(amountIn, outMin, path, to, deadline)
      const data = encodeSwapExactTokensForTokens(sellAmount, amountOutMin, path, toAddr, deadline);
      tx = {
        to: PANCAKE_V2_ROUTER,
        data,
        value: "0x0",
      };
    }

    // Return shape your UI already expects
    return json(200, {
      ok: true,
      buyAmount: amountOut.toString(),
      minBuyAmount: amountOutMin.toString(),
      route: { label: "PancakeSwap V2" },
      issues: { allowance: { spender: PANCAKE_V2_ROUTER } },
      transaction: tx,
      // UI convenience
      path,
    });
  } catch (e) {
    return json(500, { error: e?.message || "quote crashed" });
  }
};