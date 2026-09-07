import "server-only";

import {
  Contract,
  Interface,
  JsonRpcProvider,
  formatEther,
  getAddress,
  parseEther,
} from "ethers";
import {
  DROID_COLLECTION_ABI,
  DROID_REGISTRY_ABI,
} from "@/lib/droid-accounts/abis";
import {
  checkedDroidProtocolConfig,
  parseDroidTokenId,
} from "@/lib/droid-accounts/server";
import { droidServerRpcUrl } from "@/lib/droid-accounts/config";
import {
  MONAD_DROID_TRADING_CANARY_TOKEN_ID,
  MONAD_DROID_TRADING_DEADLINE_SECONDS,
  MONAD_DROID_TRADING_DEFAULT_SLIPPAGE_BPS,
  MONAD_DROID_TRADING_MAX_INPUT_WEI,
  MONAD_DROID_TRADING_MAX_SLIPPAGE_BPS,
  MONAD_KURU_MON_USDC_MARKET_ADDRESS,
  MONAD_KURU_ROUTER_ADDRESS,
  MONAD_USDC_ADDRESS,
} from "@/lib/droid-trading/constants";
import { MONAD_MAINNET_CHAIN_ID } from "@/lib/monad";
import { minimumAfterSlippage } from "@/lib/droid-os/swaps/kuru-route";

const NATIVE = "0x0000000000000000000000000000000000000000";
const routerInterface = new Interface([
  "function anyToAnySwap(address[] marketAddresses,bool[] isBuy,bool[] nativeSend,address debitToken,address creditToken,uint256 amount,uint256 minimumAmountOut) payable returns (uint256 amountOut)",
]);
const erc20Interface = new Interface([
  "function balanceOf(address owner) view returns (uint256)",
]);

function enabled(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function slippageBps(value: unknown) {
  const parsed = Number(value ?? MONAD_DROID_TRADING_DEFAULT_SLIPPAGE_BPS);
  return Number.isSafeInteger(parsed) && parsed >= 1
    && parsed <= MONAD_DROID_TRADING_MAX_SLIPPAGE_BPS
    ? parsed
    : 0;
}

/** Keyless direct-router simulation. It never builds or signs a production transaction. */
export async function quoteMonadDroidTradingCanary(input: {
  tokenId: unknown;
  amount: unknown;
  slippageBps?: unknown;
}) {
  const tokenId = parseDroidTokenId(input.tokenId);
  if (tokenId !== MONAD_DROID_TRADING_CANARY_TOKEN_ID) {
    throw new Error("Owner trading quotes are limited to the approved Droid #11 canary.");
  }
  const amountText = String(input.amount || "").trim();
  let amountIn: bigint;
  try {
    amountIn = parseEther(amountText);
  } catch {
    throw new Error("Enter a valid MON amount.");
  }
  if (amountIn <= 0n || amountIn > MONAD_DROID_TRADING_MAX_INPUT_WEI) {
    throw new Error("Canary quote amount must be greater than zero and no more than 0.001 MON.");
  }
  const selectedSlippageBps = slippageBps(input.slippageBps);
  if (!selectedSlippageBps) throw new Error("Canary slippage must be between 0.01% and 1.00%.");

  const config = await checkedDroidProtocolConfig(MONAD_MAINNET_CHAIN_ID);
  if (!config.configured) throw new Error(config.setupIssue || "Monad Droid infrastructure unavailable.");
  const provider = new JsonRpcProvider(
    droidServerRpcUrl(MONAD_MAINNET_CHAIN_ID),
    MONAD_MAINNET_CHAIN_ID,
    { staticNetwork: true },
  );
  const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, provider);
  const registry = new Contract(config.registryAddress, DROID_REGISTRY_ABI, provider);
  const [owner, droidAccount] = await Promise.all([
    collection.ownerOf(tokenId) as Promise<string>,
    registry.account(tokenId) as Promise<string>,
  ]);
  const account = getAddress(droidAccount);
  const tokenOut = new Contract(MONAD_USDC_ADDRESS, erc20Interface, provider);
  const [code, balance, latestBlock, tokenOutBalanceBefore] = await Promise.all([
    provider.getCode(account),
    provider.getBalance(account),
    provider.getBlock("latest"),
    tokenOut.balanceOf(account) as Promise<bigint>,
  ]);
  if (code === "0x") throw new Error("The trading canary Droid Account is not active.");
  if (balance < amountIn) throw new Error("The Droid does not have enough MON for this quote.");

  const data = routerInterface.encodeFunctionData("anyToAnySwap", [
    [MONAD_KURU_MON_USDC_MARKET_ADDRESS],
    [false],
    [true],
    NATIVE,
    MONAD_USDC_ADDRESS,
    amountIn,
    0n,
  ]);
  const call = {
    from: account,
    to: MONAD_KURU_ROUTER_ADDRESS,
    value: amountIn,
    data,
  };
  const [result, routeGasEstimate] = await Promise.all([
    provider.call(call),
    provider.estimateGas(call),
  ]);
  const [expectedAmountOut] = routerInterface.decodeFunctionResult("anyToAnySwap", result);
  const expectedOutput = BigInt(expectedAmountOut);
  if (expectedOutput <= 0n) throw new Error("The approved MON/USDC route returned no output.");
  const minimumAmountOut = BigInt(minimumAfterSlippage(expectedOutput.toString(), selectedSlippageBps));

  const ownerTradingEnabled = Boolean(
    config.ownerTradingAddress
    && enabled(process.env.MONAD_DROID_OWNER_TRADING_ENABLED)
    && enabled(process.env.NEXT_PUBLIC_MONAD_DROID_OWNER_TRADING_ENABLED),
  );
  return {
    ok: true as const,
    mode: "SIMULATION_ONLY" as const,
    chainId: MONAD_MAINNET_CHAIN_ID,
    blockNumber: latestBlock?.number || 0,
    tokenId,
    droidAccount: account,
    owner: getAddress(owner),
    balanceBeforeWei: balance.toString(),
    balanceBeforeMon: formatEther(balance),
    tokenIn: { address: NATIVE, symbol: "MON", decimals: 18 },
    tokenOut: { address: MONAD_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    amountIn: amountIn.toString(),
    amountInMon: formatEther(amountIn),
    expectedAmountOut: expectedOutput.toString(),
    minimumAmountOut: minimumAmountOut.toString(),
    slippageBps: selectedSlippageBps,
    deadline: (latestBlock?.timestamp || Math.floor(Date.now() / 1_000))
      + MONAD_DROID_TRADING_DEADLINE_SECONDS,
    router: MONAD_KURU_ROUTER_ADDRESS,
    market: MONAD_KURU_MON_USDC_MARKET_ADDRESS,
    venue: "Kuru",
    routeGasEstimate: routeGasEstimate.toString(),
    routeGasEstimateScope: "DIRECT_ROUTER_LEG_ONLY" as const,
    calldataTarget: config.ownerTradingAddress || null,
    calldataTargetStatus: config.ownerTradingAddress ? "CONFIGURED" as const : "UNDEPLOYED" as const,
    expectedBalanceAfterWei: (balance - amountIn).toString(),
    tokenOutBalanceBefore: tokenOutBalanceBefore.toString(),
    tokenOutBalanceAfter: (tokenOutBalanceBefore + expectedOutput).toString(),
    ownerTradingEnabled,
    autonomousTradingEnabled: false as const,
    broadcastEnabled: false as const,
  };
}
