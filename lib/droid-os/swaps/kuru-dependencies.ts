import { Interface, keccak256, toUtf8Bytes, type JsonRpcProvider } from "ethers";

// Observed public deployment identities, NOT a venue approval or a trust oracle.
// No transaction, key, secret, signing method, or configurable RPC is exposed here.
export const KURU_DEPENDENCIES = Object.freeze({
  margin: "0x2a68ba1833cdf93fa9da1eebd7f46242ad8e90c5",
  marginImplementation: "0x351525073afa933720329756716fcf7d741e7ff0",
  marginHash: "0xf0a5b851422041d98b1ae329b5a609c2c8aec1ad1f76816217a7b6047f154121",
  vault: "0x838c2d3fd4db5eb2f185cbe7697fbaace52b34d7",
  vaultImplementation: "0x17eccb57f292d8e41ccf40432f91b6b8dcfe7a3c",
  vaultHash: "0xafedf5d85a507c422f1383767b8d91753c1d4268181008a75d216b0e7ee967ff",
  forwarder: "0x974e61bba9c4704e8bcc1923fdc3527b41323faa",
  forwarderImplementation: "0xbf6cc109c6ebca4b28e3e51fd8798294599cfe2a",
  forwarderHash: "0x4ae0a59ed728a926ba0eba2c9010978e4bc90ebed388286326e62cfcb203b694",
  owner: "0x8b736dce2071783fd9db0a423dad17cc8ed5788b",
  ownerProxyHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  ownerImplementation: "0x29fcb43b46531bca003ddc8fcb67ffe91900c762",
  ownerImplementationHash: "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff",
  ownerFallback: "0xfd0732dc9e303f09fcef3a7388ad10a83459ec99",
  usdcOwner: "0xf62c8e636d61840ec9f8c3ab518aa65306af26e0",
  usdcAdmin: "0xc66bf3ef02d30e942bbab7f871d07b14d0ccc619",
  usdcPauser: "0xa5fa8efd52bf10d259b13ff9bb12503a49f6e8ea",
  usdcBlacklister: "0x17864246c1edb4a5da2e2ca891564e3dff01d6cd",
  usdcMasterMinter: "0x872890112d164a4ff4f09f5ede2ed8771f77cbd1",
});
type Route = { router: string; market: string; usdc: string; proxyHash: string; marketImplementation: string };
type Read = { key: string; kind: "code" | "storage" | "call"; address: string; data?: string; expected: string };
const ZERO = "0x" + "0".repeat(40);
const word = (address: string) => "0x" + "0".repeat(24) + address.slice(2);
const SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** Fixed read plan. Exact ABI bytes also reject malformed/extra return data. */
export function kuruDependencyReadPlan(route: Route): Read[] {
  const d = KURU_DEPENDENCIES; const reads: Read[] = [];
  const code = (key: string, address: string, expected: string) => reads.push({ key, kind: "code", address, expected });
  const storage = (key: string, address: string, data: string, expected: string) => reads.push({ key, kind: "storage", address, data, expected });
  const call = (key: string, address: string, declaration: string, args: unknown[], result: unknown[]) => {
    const abi = new Interface([`function ${declaration}`]); const fn = declaration.slice(0, declaration.indexOf("("));
    reads.push({ key, kind: "call", address, data: abi.encodeFunctionData(fn, args), expected: abi.encodeFunctionResult(fn, result).toLowerCase() });
  };
  for (const [label, address, implementation, hash] of [
    ["margin", d.margin, d.marginImplementation, d.marginHash], ["vault", d.vault, d.vaultImplementation, d.vaultHash],
    ["forwarder", d.forwarder, d.forwarderImplementation, d.forwarderHash],
  ]) {
    code(`${label}.proxyCode`, address, route.proxyHash); code(`${label}.implementationCode`, implementation, hash);
    storage(`${label}.implementationSlot`, address, SLOT, word(implementation));
  }
  code("owner.proxyCode", d.owner, d.ownerProxyHash);
  code("owner.implementationCode", d.ownerImplementation, d.ownerImplementationHash);
  call("owner.implementation", d.owner, "masterCopy() view returns(address)", [], [d.ownerImplementation]);
  call("owner.threshold", d.owner, "getThreshold() view returns(uint256)", [], [3]);
  call("owner.signers", d.owner, "getOwners() view returns(address[])", [], [[
    "0xba0c215d77ab01015ea0bed931b412028157fe4b", "0x32e00e1fe4c15803c65d4b3a10cb631e9e6d4b49",
    "0xbf5657e6de2445b3f200bcfc54a1d489ae3d0b56", "0x58af027eca44c810d714abd5bb087104e7c822cc", "0x830b71f0481445392376acd6cfc7c35dc5db4a5a",
  ]]);
  call("owner.modules", d.owner, "getModulesPaginated(address,uint256) view returns(address[],address)", ["0x" + "0".repeat(39) + "1", 100], [[], "0x" + "0".repeat(39) + "1"]);
  storage("owner.guard", d.owner, keccak256(toUtf8Bytes("guard_manager.guard.address")), word(ZERO));
  storage("owner.fallback", d.owner, keccak256(toUtf8Bytes("fallback_manager.handler.address")), word(d.ownerFallback));
  const addressReads = [
    ["router.owner", route.router, "owner", d.owner], ["router.margin", route.router, "marginAccountAddress", d.margin],
    ["router.forwarder", route.router, "TRUSTED_FORWARDER", d.forwarder],
    ["router.marketImplementation", route.router, "orderBookImplementation", route.marketImplementation],
    ["router.vaultImplementation", route.router, "kuruAmmVaultImplementation", d.vaultImplementation],
    ["market.vault", route.market, "kuruAmmVault", d.vault], ["margin.owner", d.margin, "owner", d.owner],
    ["vault.owner", d.vault, "owner", route.router], ["vault.market", d.vault, "market", route.market],
    ["vault.margin", d.vault, "marginAccount", d.margin], ["vault.base", d.vault, "token1", ZERO], ["vault.quote", d.vault, "token2", route.usdc],
    ["forwarder.owner", d.forwarder, "owner", d.owner], ["usdc.owner", route.usdc, "owner", d.usdcOwner],
    ["usdc.admin", route.usdc, "admin", d.usdcAdmin], ["usdc.pauser", route.usdc, "pauser", d.usdcPauser],
    ["usdc.blacklister", route.usdc, "blacklister", d.usdcBlacklister], ["usdc.masterMinter", route.usdc, "masterMinter", d.usdcMasterMinter],
    ["usdc.rescuer", route.usdc, "rescuer", ZERO],
  ];
  for (const [key, address, fn, expected] of addressReads) call(key, address, `${fn}() view returns(address)`, [], [expected]);
  call("market.state", route.market, "marketState() view returns(uint8)", [], [0]);
  call("market.parameters", route.market,
    "getMarketParams() view returns(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)",
    [], [100000000, 10000000000, ZERO, 18, route.usdc, 6, 100, 2_000_000_000_000n, 2_000_000_000_000_000_000n, 0, 0]);
  call("margin.marketRegistered", d.margin, "verifiedMarket(address) view returns(bool)", [route.market], [true]);
  call("margin.trustedForwarder", d.margin, "isTrustedForwarder(address) view returns(bool)", [d.forwarder], [true]);
  call("market.trustedForwarder", route.market, "isTrustedForwarder(address) view returns(bool)", [d.forwarder], [true]);
  call("usdc.paused", route.usdc, "paused() view returns(bool)", [], [false]);
  call("usdc.decimals", route.usdc, "decimals() view returns(uint8)", [], [6]);
  for (const [label, address] of [["router", route.router], ["market", route.market], ["margin", d.margin], ["vault", d.vault]])
    call(`usdc.blacklisted.${label}`, route.usdc, "isBlacklisted(address) view returns(bool)", [address], [false]);
  return reads;
}

export function assertKuruDependencySnapshot(observed: Record<string, string>, route: Route): void {
  const plan = kuruDependencyReadPlan(route);
  if (Object.keys(observed).length !== plan.length) throw Error("Incomplete or unknown dependency evidence");
  for (const check of plan) if (typeof observed[check.key] !== "string" || observed[check.key].toLowerCase() !== check.expected)
    throw Error(`Venue dependency changed or unknown: ${check.key}`);
}

/** Caller owns fresh chain/block/reorg verification. Every read uses that one block.
 * These observations neither certify all transitive dependencies nor prevent upgrades. */
export async function inspectKuruDependencies(rpc: JsonRpcProvider, blockTag: number, route: Route) {
  const plan = kuruDependencyReadPlan(route); const observations: Record<string, string> = {};
  for (let offset = 0; offset < plan.length; offset += 6) {
    await Promise.all(plan.slice(offset, offset + 6).map(async check => {
      let value: string;
      if (check.kind === "code") {
        const code = await rpc.getCode(check.address, blockTag);
        if (code === "0x") throw Error(`Missing dependency code: ${check.key}`);
        value = keccak256(code);
      } else if (check.kind === "storage") value = await rpc.getStorage(check.address, check.data!, blockTag);
      else value = await rpc.call({ to: check.address, data: check.data!, blockTag });
      observations[check.key] = value;
    }));
  }
  assertKuruDependencySnapshot(observations, route);
  return { status: "OBSERVED_DEPENDENCY_MATCH" as const, observations };
}
