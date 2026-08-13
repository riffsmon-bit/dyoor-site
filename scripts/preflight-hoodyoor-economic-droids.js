import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, ZeroHash, getAddress, keccak256 } from "ethers";
import { assertReadOnlyReleaseEnvironment } from "./lib/release-safety.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_CHAIN_ID = 4663;
const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const ZERO_CODE = "0x";

const existingContracts = {
  canonicalSeaDrop: "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5",
  collection: "0x8277F8126722B11D7b44C5C453bcF62A78AAFa25",
  energyBank: "0x9bA9aa6c6A1CB04bc0477E90f4D93214c6b1D7c3",
  rerollV2: "0x6cf24a0119b7286ad88855Baa9CB220DF628FD11",
  droidImplementationV1: "0x0FFDc6ACb41D39ee7b535026202AA8fe0054F52A",
  droidResolverV1: "0x190602Aa70199ec3623ad3bc97a10B534b26fE48",
  canonicalErc6551Registry: "0x000000006551c19487814612e58FE06813775758",
};

const artifacts = [
  "HoodYoorDroidRegistry",
  "HoodYoorAssetRegistry",
  "HoodYoorRewardsDistributor",
  "HoodYoorRevenueVault",
  "HoodYoorStrategyRegistry",
  "HoodYoorAchievementRegistry",
];

const newAddressVariables = {
  droidRegistry: "HOODYOOR_ECONOMY_DROID_REGISTRY_ADDRESS",
  assetRegistry: "HOODYOOR_ASSET_REGISTRY_ADDRESS",
  rewardsDistributor: "HOODYOOR_REWARDS_DISTRIBUTOR_ADDRESS",
  revenueVault: "HOODYOOR_REVENUE_VAULT_ADDRESS",
  strategyRegistry: "HOODYOOR_STRATEGY_REGISTRY_ADDRESS",
  achievementRegistry: "HOODYOOR_ACHIEVEMENT_REGISTRY_ADDRESS",
};

function outputPath() {
  const inline = process.argv.find((value) => value.startsWith("--output="));
  if (inline) return inline.slice("--output=".length);
  const index = process.argv.indexOf("--output");
  return index >= 0 ? process.argv[index + 1] : "";
}

function writeReport(report) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const requested = outputPath();
  if (requested) {
    const target = path.isAbsolute(requested) ? requested : path.resolve(ROOT, requested);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, serialized);
  }
  process.stdout.write(serialized);
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function artifactRecord(contractName) {
  const artifactPath = path.join(
    ROOT,
    "contracts",
    "hoodyoor",
    "out",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing ${contractName} artifact. Run npm run build:hoodyoor:economy first.`);
  }
  const artifactBytes = fs.readFileSync(artifactPath);
  const artifact = JSON.parse(artifactBytes);
  const creation = String(artifact?.bytecode?.object || "");
  const runtime = String(artifact?.deployedBytecode?.object || "");
  if (!/^0x[0-9a-f]*$/i.test(creation) || !/^0x[0-9a-f]*$/i.test(runtime)) {
    throw new Error(`Invalid ${contractName} artifact bytecode.`);
  }
  const runtimeBytes = (runtime.length - 2) / 2;
  const sourceName = artifact?.metadata?.settings?.compilationTarget
    ? Object.keys(artifact.metadata.settings.compilationTarget)[0]
    : `src/economic/${contractName}.sol`;
  const sourcePath = path.join(ROOT, "contracts", "hoodyoor", sourceName);
  const sourceBytes = fs.readFileSync(sourcePath);
  return {
    contractName,
    sourceName,
    artifactPath: path.relative(ROOT, artifactPath),
    artifactSha256: `0x${createHash("sha256").update(artifactBytes).digest("hex")}`,
    sourceSha256: `0x${createHash("sha256").update(sourceBytes).digest("hex")}`,
    compilerVersion: artifact?.metadata?.compiler?.version || "unknown",
    optimizer: artifact?.metadata?.settings?.optimizer || null,
    viaIR: artifact?.metadata?.settings?.viaIR === true,
    evmVersion: artifact?.metadata?.settings?.evmVersion || "unknown",
    creationBytes: (creation.length - 2) / 2,
    runtimeBytes,
    creationCodeHash: keccak256(creation),
    runtimeCodeHash: keccak256(runtime),
    eip170WithinLimit: runtimeBytes <= 24_576,
  };
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  assertReadOnlyReleaseEnvironment();
  if (truthy(process.env.EXECUTE_HOODYOOR_ECONOMIC_DEPLOYMENT)) {
    throw new Error("Refused: this preflight has no broadcast mode. Review the deployment report first.");
  }
  const hardDisabled = {
    rewards: !truthy(process.env.DROID_REWARDS_ENABLED)
      && !truthy(process.env.NEXT_PUBLIC_DROID_REWARDS_ENABLED),
    strategies: !truthy(process.env.DROID_STRATEGIES_ENABLED)
      && !truthy(process.env.NEXT_PUBLIC_DROID_STRATEGIES_ENABLED),
    sharedTreasury: !truthy(process.env.SHARED_TREASURY_ENABLED)
      && !truthy(process.env.NEXT_PUBLIC_SHARED_TREASURY_ENABLED),
    crossChainBridge: !truthy(process.env.CROSS_CHAIN_BRIDGE_ENABLED)
      && !truthy(process.env.NEXT_PUBLIC_CROSS_CHAIN_BRIDGE_ENABLED),
    droidAgent: !truthy(process.env.DROID_AGENT_ENABLED)
      && !truthy(process.env.NEXT_PUBLIC_DROID_AGENT_ENABLED),
  };
  if (Object.values(hardDisabled).some((disabled) => !disabled)) {
    throw new Error(
      "Refused: rewards, strategies, shared treasury, bridge, and agent flags must remain disabled for this release.",
    );
  }

  const compiled = artifacts.map(artifactRecord);
  if (compiled.some((record) => !record.eip170WithinLimit)) {
    throw new Error("At least one economic contract exceeds the EIP-170 runtime size limit.");
  }

  const rpcUrl = String(
    process.env.HOODYOOR_DROID_RPC_URL
      || process.env.HOODYOOR_RPC_URL
      || PUBLIC_RPC,
  ).trim();
  const provider = new JsonRpcProvider(rpcUrl, EXPECTED_CHAIN_ID, { staticNetwork: true });
  const network = await withTimeout(provider.getNetwork(), 12_000, "Robinhood network read");
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong chain: expected ${EXPECTED_CHAIN_ID}, received ${network.chainId}.`);
  }
  const collection = new Contract(existingContracts.collection, [
    "function owner() view returns (address)",
    "function treasury() view returns (address)",
    "function royaltyReceiver() view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function ownerReserveMinted() view returns (bool)",
    "function revealed() view returns (bool)",
    "function secondaryTradingEnabled() view returns (bool)",
    "function allowedSeaDropFrozen() view returns (bool)",
    "function mintingFinalized() view returns (bool)",
  ], provider);
  const seaDrop = new Contract(existingContracts.canonicalSeaDrop, [
    "function getPublicDrop(address) view returns (tuple(uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))",
    "function getAllowListMerkleRoot(address) view returns (bytes32)",
    "function getCreatorPayoutAddress(address) view returns (address)",
  ], provider);
  const droidResolver = new Contract(existingContracts.droidResolverV1, [
    "function canonicalRegistry() view returns (address)",
    "function implementation() view returns (address)",
    "function tokenContract() view returns (address)",
    "function tokenChainId() view returns (uint256)",
    "function accountSalt() view returns (bytes32)",
  ], provider);
  const [
    blockNumber,
    feeData,
    existingCode,
    collectionValues,
    seaDropValues,
    resolverValues,
  ] = await Promise.all([
    withTimeout(provider.getBlockNumber(), 12_000, "latest block read"),
    withTimeout(provider.getFeeData(), 12_000, "fee data read"),
    Promise.all(Object.entries(existingContracts).map(async ([name, address]) => {
      const code = await withTimeout(provider.getCode(address), 12_000, `${name} code read`);
      return [name, {
        address: getAddress(address),
        hasCode: code !== ZERO_CODE,
        runtimeCodeHash: code === ZERO_CODE ? "" : keccak256(code),
      }];
    })),
    Promise.all([
      collection.owner(),
      collection.treasury(),
      collection.royaltyReceiver(),
      collection.totalSupply(),
      collection.ownerReserveMinted(),
      collection.revealed(),
      collection.secondaryTradingEnabled(),
      collection.allowedSeaDropFrozen(),
      collection.mintingFinalized(),
    ]),
    Promise.all([
      seaDrop.getPublicDrop(existingContracts.collection),
      seaDrop.getAllowListMerkleRoot(existingContracts.collection),
      seaDrop.getCreatorPayoutAddress(existingContracts.collection),
    ]),
    Promise.all([
      droidResolver.canonicalRegistry(),
      droidResolver.implementation(),
      droidResolver.tokenContract(),
      droidResolver.tokenChainId(),
      droidResolver.accountSalt(),
    ]),
  ]);
  const existing = Object.fromEntries(existingCode);
  if (Object.values(existing).some((record) => !record.hasCode)) {
    throw new Error("An existing production dependency has no code. Deployment preflight failed.");
  }
  const droidAccountWiring = {
    canonicalRegistry: getAddress(resolverValues[0]),
    implementation: getAddress(resolverValues[1]),
    tokenContract: getAddress(resolverValues[2]),
    tokenChainId: Number(resolverValues[3]),
    accountSalt: resolverValues[4],
  };
  const publicDrop = seaDropValues[0];
  const publicDropConfigured = BigInt(publicDrop.mintPrice) !== 0n
    || BigInt(publicDrop.startTime) !== 0n
    || BigInt(publicDrop.endTime) !== 0n
    || BigInt(publicDrop.maxTotalMintableByWallet) !== 0n
    || BigInt(publicDrop.feeBps) !== 0n
    || publicDrop.restrictFeeRecipients;
  if (
    droidAccountWiring.canonicalRegistry !== getAddress(existingContracts.canonicalErc6551Registry)
    || droidAccountWiring.implementation !== getAddress(existingContracts.droidImplementationV1)
    || droidAccountWiring.tokenContract !== getAddress(existingContracts.collection)
    || droidAccountWiring.tokenChainId !== EXPECTED_CHAIN_ID
    || droidAccountWiring.accountSalt !== `0x${"00".repeat(32)}`
  ) {
    throw new Error("The deployed Robinhood Droid Account V1 resolver wiring changed.");
  }

  const configuredNewAddresses = {};
  for (const [name, variable] of Object.entries(newAddressVariables)) {
    const raw = String(process.env[variable] || "").trim();
    configuredNewAddresses[name] = raw
      ? { variable, address: getAddress(raw), status: "configured" }
      : { variable, address: "", status: "not-deployed" };
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "read-only-preflight",
    chainId: EXPECTED_CHAIN_ID,
    latestBlock: blockNumber,
    feeData: {
      gasPriceWei: feeData.gasPrice?.toString() || null,
      maxFeePerGasWei: feeData.maxFeePerGas?.toString() || null,
      maxPriorityFeePerGasWei: feeData.maxPriorityFeePerGas?.toString() || null,
    },
    existingContractsUntouched: existing,
    collectionState: {
      address: getAddress(existingContracts.collection),
      owner: getAddress(collectionValues[0]),
      treasury: getAddress(collectionValues[1]),
      royaltyReceiver: getAddress(collectionValues[2]),
      totalSupply: Number(collectionValues[3]),
      ownerReserveMinted: collectionValues[4],
      revealed: collectionValues[5],
      secondaryTradingEnabled: collectionValues[6],
      allowedSeaDropFrozen: collectionValues[7],
      mintingFinalized: collectionValues[8],
      publicDropConfigured,
      allowListRoot: seaDropValues[1],
      creatorPayout: getAddress(seaDropValues[2]),
      saleClosed: !collectionValues[4]
        && !publicDropConfigured
        && seaDropValues[1] === ZeroHash,
      lifecycle: Number(collectionValues[3]) === 0 ? "deployed-pre-mint" : "minted",
    },
    droidAccountWiring,
    compiledContracts: compiled,
    configuredNewAddresses,
    hardDisabled,
    deploymentSequence: [
      "HoodYoorDroidRegistry(initialAdminSafe)",
      "HoodYoorAssetRegistry(initialAdminSafe)",
      "HoodYoorRewardsDistributor(initialAdminSafe, droidRegistry, assetRegistry)",
      "HoodYoorRevenueVault(initialAdminSafe, assetRegistry, treasurySafe, rewardsDistributor, otherAllocationSafe, treasuryBps, rewardBps, otherBps)",
      "Safe: rewardsDistributor.configureFundingVault(revenueVault)",
      "HoodYoorStrategyRegistry(initialAdminSafe, droidRegistry, assetRegistry)",
      "HoodYoorAchievementRegistry(initialAdminSafe, droidRegistry)",
      "Safe: register native collection and immutable account resolver V1",
      "Safe: allowlist reviewed settlement assets and revenue sources",
      "Independent verification and funded test epoch",
      "Enable rewards/strategies flags only after explicit approval",
    ],
    broadcastCapability: false,
    broadcastAttempted: false,
    privateKeyRead: false,
    nextAction: "Review docs/hoodyoor-economic-droid-deployment-report.md. No deployment is authorized.",
  };
  writeReport(report);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
