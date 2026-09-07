import { Interface, keccak256, type JsonRpcProvider } from "ethers";
import { inspectKuruDependencies } from "./kuru-dependencies.ts";

// Operator-reviewed route identity, not an AI-selected token, market or aggregator.
export const KURU_ROUTE = Object.freeze({
  chainId: 143, router: "0xd651346d7c789536ebf06dc72ae3c8502cd695cc",
  market: "0x065c9d28e428a0db40191a54d33d5b7c71a9c394", usdc: "0x754704bc059f8c67012fed69bc8a327a5aafb603",
  routerImplementation: "0xf1635175914acf4db170395d524323225e1f1a04",
  marketImplementation: "0x5e3446c600524be453bbcefd46a9e4c9be8899a0",
  usdcImplementation: "0xbd520ea8cbb4f81b62aff3c3ffe7affd69800b6d",
  proxyHash: "0xb3fcfca704395c210e969b841f35fff7483f99721de8d65b219615dd5e03f43b",
  routerImplementationHash: "0xee2c47d70994c70feea9e7ae98ce9810e0f1893f377b7d949f2b6ec6f0cc53dc",
  marketImplementationHash: "0x6576ced90ca537c9aa058ea4a54ab5edd802ab78b834168b21fcc6d9ac392c0c",
  usdcHash: "0xbb3557cf62a26950fb58073e6ce8e130af371e5aa13e5584856a1ce2ca47dc89",
  usdcImplementationHash: "0xe96489833045c42bacced6259e6a6372290706ed665e79457aa2fe4d46bc3559",
});
export const KURU_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export type KuruSwapIntentV1 = { version: 1; direction: "MON_TO_USDC" | "USDC_TO_MON"; amountIn: string; minimumOut: string };
const router = new Interface(["function anyToAnySwap(address[],bool[],bool[],address,address,uint256,uint256) payable returns(uint256)"]);
const implementation = new Interface(["function implementation() view returns(address)"]);
const ZERO = "0x0000000000000000000000000000000000000000";
const uint = (value: unknown) => typeof value === "string" && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;

export function parseKuruIntent(value: unknown): KuruSwapIntentV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid swap intent");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 4 || Object.keys(v).some(k => !["version", "direction", "amountIn", "minimumOut"].includes(k))
    || v.version !== 1 || (v.direction !== "MON_TO_USDC" && v.direction !== "USDC_TO_MON") || !uint(v.amountIn) || !uint(v.minimumOut)) throw Error("Invalid swap intent");
  const intent = v as KuruSwapIntentV1;
  if (BigInt(intent.amountIn) > (intent.direction === "MON_TO_USDC" ? 1_000_000_000_000_000n : 1000n)) throw Error("Swap cap exceeded");
  return { version: 1, direction: intent.direction, amountIn: intent.amountIn, minimumOut: intent.minimumOut };
}

/** Exact route description for simulation/validation only, never a broadcast API. */
export function buildKuruRoute(input: unknown) {
  const intent = parseKuruIntent(input); const buy = intent.direction === "USDC_TO_MON";
  return { chainId: 143, to: KURU_ROUTE.router, value: buy ? "0" : intent.amountIn,
    data: router.encodeFunctionData("anyToAnySwap", [[KURU_ROUTE.market], [buy], [!buy], buy ? KURU_ROUTE.usdc : ZERO,
      buy ? ZERO : KURU_ROUTE.usdc, intent.amountIn, intent.minimumOut]) };
}
export function validateKuruRoute(candidate: unknown, intent: unknown): void {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw Error("Unapproved transaction");
  const value = candidate as Record<string, unknown>; const expected = buildKuruRoute(intent);
  if (Object.keys(value).length !== 4 || Object.keys(value).some(k => !["chainId", "to", "value", "data"].includes(k))
    || value.chainId !== expected.chainId || value.to !== expected.to || value.value !== expected.value || value.data !== expected.data)
    throw Error("Unapproved transaction: route, selector, recipient, value or limits changed");
}
export function minimumAfterSlippage(quotedOutput: string, bps: number): string {
  if (!uint(quotedOutput) || !Number.isSafeInteger(bps) || bps < 1 || bps > 100) throw Error("Invalid slippage evidence");
  // Round UP: flooring tiny outputs can silently exceed the requested tolerance.
  return ((BigInt(quotedOutput) * BigInt(10000 - bps) + 9999n) / 10000n).toString();
}

export function assertKuruImplementationBindings(routerSlot: string, marketSlot: string, usdcImplementation: string): void {
  const slotMatches = (slot: string, address: string) => slot.toLowerCase() === `0x${"0".repeat(24)}${address.slice(2)}`;
  if (!slotMatches(routerSlot, KURU_ROUTE.routerImplementation) || !slotMatches(marketSlot, KURU_ROUTE.marketImplementation)
    || usdcImplementation.toLowerCase() !== KURU_ROUTE.usdcImplementation) throw Error("Proxy implementation changed");
}

/** Fresh public read, no keys or sending methods. Pins observed proxy slots too.
 * This CANNOT guarantee those slots remain unchanged at later EVM execution. */
export async function inspectKuruVenue(rpc: JsonRpcProvider) {
  if (BigInt(await rpc.send("eth_chainId", [])) !== 143n) throw Error("Wrong chain");
  const block = await rpc.getBlock("latest"); const now = Date.now() / 1000;
  if (!block?.hash || now - block.timestamp > 30 || block.timestamp > now + 10) throw Error("Stale venue snapshot");
  const tag = block.number;
  const identities = [[KURU_ROUTE.router, KURU_ROUTE.proxyHash], [KURU_ROUTE.market, KURU_ROUTE.proxyHash],
    [KURU_ROUTE.usdc, KURU_ROUTE.usdcHash], [KURU_ROUTE.routerImplementation, KURU_ROUTE.routerImplementationHash],
    [KURU_ROUTE.marketImplementation, KURU_ROUTE.marketImplementationHash], [KURU_ROUTE.usdcImplementation, KURU_ROUTE.usdcImplementationHash]];
  await Promise.all(identities.map(async ([address, hash]) => {
    const code = await rpc.getCode(address, tag);
    if (code === "0x" || keccak256(code) !== hash) throw Error("Venue bytecode changed or missing");
  }));
  const [routerSlot, marketSlot, usdcResult] = await Promise.all([
    rpc.getStorage(KURU_ROUTE.router, KURU_IMPLEMENTATION_SLOT, tag), rpc.getStorage(KURU_ROUTE.market, KURU_IMPLEMENTATION_SLOT, tag),
    rpc.call({ to: KURU_ROUTE.usdc, data: implementation.encodeFunctionData("implementation"), blockTag: tag }),
  ]);
  assertKuruImplementationBindings(routerSlot, marketSlot, String(implementation.decodeFunctionResult("implementation", usdcResult)[0]));
  const dependencies = await inspectKuruDependencies(rpc, tag, KURU_ROUTE);
  if ((await rpc.getBlock(tag))?.hash !== block.hash) throw Error("Venue snapshot reorganized");
  if (Date.now() / 1000 - block.timestamp > 30) throw Error("Venue snapshot expired during inspection");
  return { version: 1, status: "OBSERVED_IDENTITY_MATCH" as const, chainId: 143, block: tag, blockHash: block.hash,
    timestamp: block.timestamp, executionAllowed: false as const,
    blockers: ["PROXY_UPGRADE_RACE_UNRESOLVED", "EXACT_KURU_IMPLEMENTATION_SOURCE_UNVERIFIED",
      "TRANSITIVE_DEPENDENCY_REVIEW_INCOMPLETE", "ACCOUNT_SPECIFIC_SIMULATION_AND_AUTHORIZATION_NOT_CONNECTED"],
    dependencies, route: KURU_ROUTE };
}
