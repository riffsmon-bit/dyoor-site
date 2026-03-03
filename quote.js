// Netlify Function: /.netlify/functions/quote
// PancakeSwap v3 (Smart Router) quoting + tx building on Monad (chainId 143).
//
// The frontend expects fields: buyAmount, issues.allowance (optional), transaction {to,data,value}.
//
// Implementation highlights:
// - Quotes with PancakeSwap QuoterV2
// - Tries common V3 fee tiers and (if needed) routes through WMON in 2 hops
// - Builds swap calldata for Smart Router exactInputSingle/exactInput
// - If output is native MON, uses multicall to unwrap WMON -> MON

import { ethers } from 'ethers';

// Monad RPC (official)
const RPC_URL = 'https://rpc.monad.xyz';

// PancakeSwap v3 SwapRouter (Periphery)
// IMPORTANT: Use the chain-specific SwapRouter (v3) address for Monad.
// (Not the BSC/ETH Smart Router address.)
const PCS_V3_ROUTER = '0x1b81D678ffb9C0263b24A97847620C99d213eB14';

// PancakeSwap QuoterV2 (V3)
const PCS_V3_QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';

// PancakeSwap v3 Factory (Core)
const PCS_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';

// PancakeSwap v2 Router (Monad)
const PCS_V2_ROUTER = '0xB1Bc24c34e88f7D43D5923034E3a14B24DaACfF9';

// Wrapped MON (WMON)
const WMON = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';

// Native sentinel used by many swap UIs
const NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
// Treasury support fee (taken from input amount; collected as separate tx on frontend)
const TREASURY_ADDRESS = '0x4D540f7D0Eb841c839334655C9f88313D750c6d5';
const TREASURY_FEE_BPS = 20; // 0.20%


// Common Pancake/Uni V3 fee tiers
const FEE_TIERS = [100, 500, 2500, 10000];

// --- ABIs (minimal) ---

// Smart Router (ISwapRouter-style)
const ROUTER_ABI = [
  // Single hop
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
  // Multi hop
  'function exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)',
  // Payments
  'function unwrapWETH9(uint256 amountMinimum,address recipient) payable',
  // Multicall variants (some deployments expose both)
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)'
];

// QuoterV2 has an overload that takes a struct; keep both to be robust.
const QUOTER_ABI = [
  // V2 (struct param) – PancakeSwap uses this on many chains
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
  // Older style (some forks)
  'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
  // Multi hop quote
  'function quoteExactInput(bytes path,uint256 amountIn) external returns (uint256 amountOut)'
];

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)'
];

const V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'
];

const V3_POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)',
  'function liquidity() view returns (uint128)'
];

const V2_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
];

// WMON wrap/unwrap (WETH9-compatible)
const WMON_ABI = [
  'function deposit() payable',
  'function withdraw(uint256)'
];

// --- helpers ---

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

function toAddr(a) {
  if (!a) return null;
  const s = String(a).trim();
  if (s.toLowerCase() === NATIVE_TOKEN) return NATIVE_TOKEN;
  return ethers.getAddress(s);
}

function mapNative(token) {
  return token === NATIVE_TOKEN ? WMON : token;
}

function packV3Path(tokens, fees) {
  // tokens length = fees length + 1
  // path = tokenIn (20) + fee (3) + tokenMid (20) + fee (3) + tokenOut (20)
  let hex = tokens[0].toLowerCase();
  for (let i = 0; i < fees.length; i++) {
    const feeHex = ethers.toBeHex(fees[i], 3).slice(2); // 3 bytes
    hex += feeHex + tokens[i + 1].toLowerCase().slice(2);
  }
  return hex;
}

async function quoteExactInputSingle(quoter, tokenIn, tokenOut, fee, amountIn) {
  // Try struct form first, then fallback.
  try {
    const res = await quoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0
    });
    return {
      amountOut: BigInt(res[0].toString()),
      ticksCrossed: Number(res[2]?.toString?.() ?? res[2] ?? 0),
      gasEstimate: BigInt(res[3]?.toString?.() ?? res[3] ?? 0)
    };
  } catch (_) {
    // fallback
  }

  const out = await quoter.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amountIn, 0);
  return { amountOut: BigInt(out.toString()), ticksCrossed: 0, gasEstimate: 0n };
}

function bigIntToFloat(bi, decimals = 18) {
  // Converts an integer scaled by `decimals` into a JS number.
  // This is best-effort and only used for UI hints (price impact), not execution.
  const s = bi.toString();
  if (decimals === 0) return Number(s);
  const neg = s.startsWith('-');
  const str = neg ? s.slice(1) : s;
  const pad = str.length <= decimals ? '0'.repeat(decimals - str.length + 1) + str : str;
  const i = pad.length - decimals;
  const whole = pad.slice(0, i);
  const frac = pad.slice(i).slice(0, 18); // cap precision
  const out = Number(`${whole}.${frac}`);
  return neg ? -out : out;
}

function sqrtPriceX96ToPrice(sqrtPriceX96, token0Decimals, token1Decimals) {
  // price( token1 per token0 ) = (sqrtP^2 / 2^192) * 10^(dec0-dec1)
  // IMPORTANT: avoid Number(BigInt) overflow. We compute a 1e18-scaled integer then convert.
  const sp = BigInt(sqrtPriceX96.toString());
  const num = sp * sp;                 // Q192
  const denom = 1n << 192n;

  const dec0 = BigInt(token0Decimals);
  const dec1 = BigInt(token1Decimals);
  const scale = 10n ** 18n;

  // scaled = num * 10^dec0 * 1e18 / (denom * 10^dec1)
  // (do multiplication first; BigInt is fine)
  const scaledNum = num * (10n ** dec0) * scale;
  const scaledDen = denom * (10n ** dec1);
  if (scaledDen === 0n) return 0;
  const scaled = scaledNum / scaledDen;
  return bigIntToFloat(scaled, 18);
}

function calcPriceImpactBps(spotOutPerIn, execOutPerIn) {
  if (!isFinite(spotOutPerIn) || !isFinite(execOutPerIn) || spotOutPerIn <= 0) return null;
  const impact = Math.max(0, (spotOutPerIn - execOutPerIn) / spotOutPerIn);
  return Math.round(impact * 10000);
}

async function getV3SpotAndLiquidity(provider, tokenA, tokenB, fee, decA, decB) {
  try {
    const factory = new ethers.Contract(PCS_V3_FACTORY, V3_FACTORY_ABI, provider);
    const poolAddr = await factory.getPool(tokenA, tokenB, fee);
    if (!poolAddr || poolAddr === ethers.ZeroAddress) return null;

    const pool = new ethers.Contract(poolAddr, V3_POOL_ABI, provider);
    const [slot0, liq] = await Promise.all([pool.slot0(), pool.liquidity()]);
    const sqrtPriceX96 = slot0[0];

    // Determine token0/token1 by address ordering (same rule V3 uses).
    const a = BigInt(tokenA.toLowerCase());
    const b = BigInt(tokenB.toLowerCase());
    const token0IsA = a < b;
    const token0 = token0IsA ? tokenA : tokenB;
    const token1 = token0IsA ? tokenB : tokenA;
    const dec0 = token0IsA ? decA : decB;
    const dec1 = token0IsA ? decB : decA;

    const price1Per0 = sqrtPriceX96ToPrice(sqrtPriceX96, dec0, dec1);
    // We want spot out per in for direction tokenA -> tokenB
    const spot = (tokenA.toLowerCase() === token0.toLowerCase())
      ? price1Per0
      : (price1Per0 > 0 ? (1 / price1Per0) : 0);

    return { pool: poolAddr, spotOutPerIn: spot, liquidity: BigInt(liq.toString()) };
  } catch {
    return null;
  }
}

function safeDiv(a, b) {
  if (b === 0n) return 0;
  return Number(a) / Number(b);
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: ''
    };
  }

  try {
    const q = event.queryStringParameters || {};

    const sellTokenIn = toAddr(q.sellToken);
    const buyTokenIn = toAddr(q.buyToken);
    const sellAmountStr = String(q.sellAmount || '').trim();
    const taker = q.taker ? ethers.getAddress(String(q.taker)) : null;

    if (!sellTokenIn || !buyTokenIn || !sellAmountStr) {
      return json(400, { error: 'Missing required params: sellToken, buyToken, sellAmount' });
    }
    if (!taker) {
      return json(400, { error: 'Missing required param: taker' });
    }

    const chainId = Number(q.chainId || 143);
    if (chainId !== 143) {
      return json(400, { error: `Unsupported chainId ${chainId}. This endpoint is configured for Monad (143).` });
    }

    const slippageBps = Math.max(0, Math.min(5000, Number(q.slippageBps || 100))); // default 1%

    const support = String(q.support || '1').trim();
    const supportOn = support !== '0' && support.toLowerCase() !== 'false';

    const amountInGross = BigInt(sellAmountStr);
    if (amountInGross <= 0n) return json(400, { error: 'sellAmount must be > 0' });

    const feeAmount = supportOn ? (amountInGross * BigInt(TREASURY_FEE_BPS)) / 10000n : 0n;
    const amountIn = amountInGross - feeAmount;
    if (amountIn <= 0n) return json(400, { error: supportOn ? 'sellAmount too small after fee' : 'sellAmount too small' });

    const sellIsNative = sellTokenIn === NATIVE_TOKEN;
    const buyIsNative = buyTokenIn === NATIVE_TOKEN;

    const tokenIn = mapNative(sellTokenIn);
    const tokenOut = mapNative(buyTokenIn);

    // --- Handle native wrapping/unwrapping (MON <-> WMON) ---
    // MON -> WMON is a wrap (deposit). WMON -> MON is an unwrap (withdraw).
    if (tokenIn.toLowerCase() === WMON.toLowerCase() && tokenOut.toLowerCase() === WMON.toLowerCase()) {
      const wmonIface = new ethers.Interface(WMON_ABI);
      // Wrap
      if (sellIsNative && !buyIsNative) {
        return json(200, {
          buyAmount: amountIn.toString(),
          price: '1',
          gas: null,
          priceImpactBps: 0,
          warnings: ['Wrap: MON → WMON (1:1)'],
          issues: {},
          route: { version: 'wrap', fallback: null, twoHop: false, tokens: [NATIVE_TOKEN, WMON], fees: [], pools: [] },
          transaction: { to: WMON, data: wmonIface.encodeFunctionData('deposit', []), value: amountIn.toString() }
        });
      }
      // Unwrap
      if (!sellIsNative && buyIsNative) {
        return json(200, {
          buyAmount: amountIn.toString(),
          price: '1',
          gas: null,
          priceImpactBps: 0,
          warnings: ['Unwrap: WMON → MON (1:1)'],
          issues: {},
          route: { version: 'unwrap', fallback: null, twoHop: false, tokens: [WMON, NATIVE_TOKEN], fees: [], pools: [] },
          transaction: { to: WMON, data: wmonIface.encodeFunctionData('withdraw', [amountIn.toString()]), value: '0' }
        });
      }
      // If both sides are WMON (should not happen), fall through.
    }

    // Optional decimals (for price-impact estimation only)
    const sellDecimals = Number(q.sellDecimals || q.sellTokenDecimals || 18);
    const buyDecimals = Number(q.buyDecimals || q.buyTokenDecimals || 18);

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const quoter = new ethers.Contract(PCS_V3_QUOTER, QUOTER_ABI, provider);
    const v3Factory = new ethers.Contract(PCS_V3_FACTORY, V3_FACTORY_ABI, provider);
    const v2Router = new ethers.Contract(PCS_V2_ROUTER, V2_ROUTER_ABI, provider);

    // --- find best route ---
    let bestDirect = { amountOut: 0n, isTwoHop: false, fees: [], tokens: [], ticksCrossed: 0, gasEstimate: 0n };
    let bestViaWmon = { amountOut: 0n, isTwoHop: true, fees: [], tokens: [], ticksCrossed: 0, gasEstimate: 0n };

    // Direct route across fee tiers
    for (const fee of FEE_TIERS) {
      try {
        const r = await quoteExactInputSingle(quoter, tokenIn, tokenOut, fee, amountIn);
        if (r.amountOut > bestDirect.amountOut) {
          bestDirect = { amountOut: r.amountOut, isTwoHop: false, fees: [fee], tokens: [tokenIn, tokenOut], ticksCrossed: r.ticksCrossed, gasEstimate: r.gasEstimate };
        }
      } catch (_) {
        // ignore missing pools
      }
    }

    // Two-hop via WMON (if not already involving it)
    if (tokenIn.toLowerCase() !== WMON.toLowerCase() && tokenOut.toLowerCase() !== WMON.toLowerCase()) {
      for (const fee1 of FEE_TIERS) {
        let mid;
        try {
          const r1 = await quoteExactInputSingle(quoter, tokenIn, WMON, fee1, amountIn);
          mid = r1.amountOut;
          var ticks1 = r1.ticksCrossed;
          var gas1 = r1.gasEstimate;
        } catch (_) {
          continue;
        }
        if (mid <= 0n) continue;

        for (const fee2 of FEE_TIERS) {
          try {
            const r2 = await quoteExactInputSingle(quoter, WMON, tokenOut, fee2, mid);
            if (r2.amountOut > bestViaWmon.amountOut) {
              bestViaWmon = {
                amountOut: r2.amountOut,
                isTwoHop: true,
                fees: [fee1, fee2],
                tokens: [tokenIn, WMON, tokenOut],
                ticksCrossed: Number(ticks1 || 0) + Number(r2.ticksCrossed || 0),
                gasEstimate: (gas1 || 0n) + (r2.gasEstimate || 0n)
              };
            }
          } catch (_) {
            // ignore
          }
        }
      }
    }

    // Choose route: prefer WMON two-hop if it exists and is within 0.5% of best direct
    let best = bestDirect.amountOut > 0n ? bestDirect : bestViaWmon;
    if (bestViaWmon.amountOut > 0n && bestDirect.amountOut > 0n) {
      const within = bestViaWmon.amountOut * 10000n >= bestDirect.amountOut * 9950n; // within 0.5%
      best = within ? bestViaWmon : (bestDirect.amountOut >= bestViaWmon.amountOut ? bestDirect : bestViaWmon);
    } else if (bestViaWmon.amountOut > 0n) {
      best = bestViaWmon;
    }

    let usedFallback = null;
    const warnings = [];

    // If V3 route doesn't exist, attempt PancakeSwap V2 fallback (WMON-routed)
    if (best.amountOut <= 0n) {
      // V2 fallback: if user asked for native MON out, we route to WMON and let the UI offer an unwrap.
      const v2NeedsUnwrap = buyIsNative;
      const v2EffectiveBuy = v2NeedsUnwrap ? WMON : tokenOut;
      if (v2NeedsUnwrap) warnings.push('No V3 pool found; using PancakeSwap V2 fallback to WMON — tap Unwrap to receive MON.');
      try {
        const v2 = new ethers.Contract(PCS_V2_ROUTER, V2_ROUTER_ABI, provider);
        const path = (tokenIn.toLowerCase() === WMON.toLowerCase() || v2EffectiveBuy.toLowerCase() === WMON.toLowerCase())
          ? [tokenIn, v2EffectiveBuy]
          : [tokenIn, WMON, v2EffectiveBuy];
        const amounts = await v2.getAmountsOut(amountIn.toString(), path);
        const out = BigInt(amounts[amounts.length - 1].toString());
        if (out <= 0n) throw new Error('V2 quote empty');
        best = { amountOut: out, isTwoHop: path.length === 3, fees: [], tokens: path, ticksCrossed: 0, gasEstimate: 0n, v2: true };
        usedFallback = 'v2';
        warnings.push('No V3 pool found; using PancakeSwap V2 fallback.');
      } catch {
        return json(502, { error: 'No PancakeSwap v3 or v2 route found (no pool / insufficient liquidity / RPC issue).' });
      }
    }

    // --- price impact + liquidity hints (best-effort) ---
    let priceImpactBps = null;
    const pools = [];
    try {
      const execOutPerIn = (bigIntToFloat(best.amountOut, buyDecimals) / Math.max(1e-30, bigIntToFloat(amountIn, sellDecimals)));
      if (usedFallback !== 'v2') {
        if (!best.isTwoHop) {
          const info = await getV3SpotAndLiquidity(provider, best.tokens[0], best.tokens[1], best.fees[0], sellDecimals, buyDecimals);
          if (info) {
            pools.push({ pool: info.pool, liquidity: info.liquidity.toString() });
            priceImpactBps = calcPriceImpactBps(info.spotOutPerIn, execOutPerIn);
            if (best.ticksCrossed >= 250) warnings.push('Low-liquidity route detected (many initialized ticks crossed).');
          }
        } else {
          // two-hop via WMON
          const hop1 = await getV3SpotAndLiquidity(provider, best.tokens[0], best.tokens[1], best.fees[0], sellDecimals, 18);
          const hop2 = await getV3SpotAndLiquidity(provider, best.tokens[1], best.tokens[2], best.fees[1], 18, buyDecimals);
          if (hop1 && hop2) {
            pools.push({ pool: hop1.pool, liquidity: hop1.liquidity.toString() });
            pools.push({ pool: hop2.pool, liquidity: hop2.liquidity.toString() });
            const spot = hop1.spotOutPerIn * hop2.spotOutPerIn;
            priceImpactBps = calcPriceImpactBps(spot, execOutPerIn);
            if (best.ticksCrossed >= 350) warnings.push('Low-liquidity multi-hop route detected (many initialized ticks crossed).');
          }
        }
      }
    } catch {
      // ignore
    }

    // Slippage
    const amountOutMin = (best.amountOut * BigInt(10000 - slippageBps)) / 10000n;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

    // Allowance check if selling ERC20
    const issues = {};
    const spenderForAllowance = usedFallback === 'v2' ? PCS_V2_ROUTER : PCS_V3_ROUTER;
    if (!sellIsNative) {
      try {
        const erc20 = new ethers.Contract(tokenIn, ERC20_ABI, provider);
        const allowance = BigInt((await erc20.allowance(taker, spenderForAllowance)).toString());
        if (allowance < amountIn) {
          // Frontend uses this to send an approve() tx before swapping.
          issues.allowance = {
            token: tokenIn,
            spender: spenderForAllowance,
            amount: amountIn.toString()
          };
        }
      } catch (_) {
        // non-fatal
      }
    }

    // --- build tx ---
    let data;
    let value = '0';

    if (usedFallback === 'v2') {
      const v2Iface = new ethers.Interface(V2_ROUTER_ABI);
      const path = best.tokens;
      if (sellIsNative) {
        value = amountIn.toString();
        data = v2Iface.encodeFunctionData('swapExactETHForTokens', [
          amountOutMin.toString(),
          path,
          taker,
          deadline
        ]);
      } else {
        // token->token (or token->WMON)
        data = v2Iface.encodeFunctionData(
          'swapExactTokensForTokens',
          [amountIn.toString(), amountOutMin.toString(), path, taker, deadline]
        );
      }
    } else {
      const routerIface = new ethers.Interface(ROUTER_ABI);
      const needsUnwrap = buyIsNative; // UI expects native MON if user chose MON
      // For unwrap flow, we set swap recipient to the router itself so it holds WMON.
      const swapRecipient = needsUnwrap ? PCS_V3_ROUTER : taker;

      let swapCalldata;
      if (!best.isTwoHop) {
        swapCalldata = routerIface.encodeFunctionData('exactInputSingle', [
          {
            tokenIn: best.tokens[0],
            tokenOut: best.tokens[1],
            fee: best.fees[0],
            recipient: swapRecipient,
            deadline,
            amountIn: amountIn.toString(),
            amountOutMinimum: amountOutMin.toString(),
            sqrtPriceLimitX96: 0
          }
        ]);
      } else {
        const path = packV3Path(best.tokens, best.fees);
        swapCalldata = routerIface.encodeFunctionData('exactInput', [
          {
            path,
            recipient: swapRecipient,
            deadline,
            amountIn: amountIn.toString(),
            amountOutMinimum: amountOutMin.toString()
          }
        ]);
      }

      if (sellIsNative) value = amountIn.toString();

      if (!needsUnwrap) {
        data = swapCalldata;
      } else {
        const unwrapCall = routerIface.encodeFunctionData('unwrapWETH9', [amountOutMin.toString(), taker]);
        try {
          data = routerIface.encodeFunctionData('multicall(uint256,bytes[])', [deadline, [swapCalldata, unwrapCall]]);
        } catch (_) {
          data = routerIface.encodeFunctionData('multicall(bytes[])', [[swapCalldata, unwrapCall]]);
        }
      }
    }

    const price = best.amountOut > 0n ? String(bigIntToFloat(best.amountOut, buyDecimals) / Math.max(1e-30, bigIntToFloat(amountIn, sellDecimals))) : '0';

    return json(200, {
      buyAmount: best.amountOut.toString(),
      price,
      gas: null,
      priceImpactBps,
      warnings,
      issues,
      effectiveBuyToken: (usedFallback === 'v2' && buyIsNative) ? WMON : buyTokenIn,
      unwrapToNative: (usedFallback === 'v2' && buyIsNative),
      fee: {
        bps: TREASURY_FEE_BPS,
        recipient: TREASURY_ADDRESS,
        token: sellTokenIn,
        amount: feeAmount.toString(),
        amountGross: amountInGross.toString(),
        amountNet: amountIn.toString()
      },
      route: {
        version: usedFallback === 'v2' ? 'pancakeswap-v2' : 'pancakeswap-v3',
        fallback: usedFallback,
        twoHop: best.isTwoHop,
        tokens: best.tokens,
        fees: best.fees,
        pools
      },
      transaction: {
        to: usedFallback === 'v2' ? PCS_V2_ROUTER : PCS_V3_ROUTER,
        data,
        value
      }
    });
  } catch (e) {
    return json(500, { error: 'Function error', details: String(e?.shortMessage || e?.message || e) });
  }
};
