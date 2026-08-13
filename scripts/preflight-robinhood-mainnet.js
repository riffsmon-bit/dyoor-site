import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JsonRpcProvider,
  formatEther,
  getAddress,
  keccak256,
} from "ethers";
import {
  HOODYOOR_CHAIN_ID,
  mainnetGateReport,
  readJson,
  verifyFrozenEnergyMigrationLedger,
} from "./lib/hoodyoor-mainnet.js";
import { assertReadOnlyReleaseEnvironment } from "./lib/release-safety.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assertReadOnlyReleaseEnvironment();
const generatedRoot = path.join(projectRoot, "data", "robinhood", "onchain-128");
const deploymentRoot = path.join(projectRoot, "deployments", "robinhood");
const config = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
));
const launchManifest = readJson(path.join(
  generatedRoot,
  "hoodyoor-mainnet-launch-manifest.json",
));
const brandingManifest = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "branding",
  "opensea",
  "opensea-branding-manifest.json",
));
const offline = process.env.HOODYOOR_PREFLIGHT_OFFLINE === "1";
const strict = process.env.REQUIRE_HOODYOOR_READY === "1";
const finalizationCheckpointPath = path.join(
  deploymentRoot,
  `hoodyoor-launch-finalization-${HOODYOOR_CHAIN_ID}.json`,
);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function verifyPayloads() {
  const checks = [];
  for (const [id, payload] of Object.entries(launchManifest.payloads)) {
    const bytes = fs.readFileSync(path.join(projectRoot, payload.binary.path));
    checks.push({
      id,
      path: payload.binary.path,
      bytes: bytes.length,
      passed: bytes.length === payload.binary.bytes
        && sha256(bytes) === payload.binary.sha256
        && keccak256(bytes).toLowerCase() === payload.binaryHash.toLowerCase(),
    });
  }
  return checks;
}

function verifyBranding() {
  return brandingManifest.assets.map((asset) => {
    const bytes = fs.readFileSync(path.join(projectRoot, asset.path));
    return {
      id: asset.id,
      width: asset.width,
      height: asset.height,
      bytes: bytes.length,
      passed: bytes.length === asset.bytes && sha256(bytes) === asset.sha256,
    };
  });
}

function checkpointStatus(name) {
  const filePath = path.join(deploymentRoot, `${name}-${HOODYOOR_CHAIN_ID}.json`);
  if (!fs.existsSync(filePath)) {
    return { name, exists: false, path: path.relative(projectRoot, filePath) };
  }
  const checkpoint = readJson(filePath);
  return {
    name,
    exists: true,
    path: path.relative(projectRoot, filePath),
    schema: checkpoint.schema,
    chainId: checkpoint.chainId,
    addresses: Object.fromEntries(
      ["store", "renderer", "collection", "energyBank", "rules", "controller"]
        .filter((key) => checkpoint[key])
        .map((key) => [key, checkpoint[key]]),
    ),
    transactions: checkpoint.transactions?.length || 0,
  };
}

async function inspectAddress(provider, address, label) {
  const normalized = getAddress(address);
  const [balance, code] = await Promise.all([
    provider.getBalance(normalized),
    provider.getCode(normalized),
  ]);
  return {
    label,
    address: normalized,
    balanceEth: formatEther(balance),
    accountType: code === "0x" ? "eoa-or-undeployed" : "contract",
  };
}

async function inspectNetwork(gates) {
  if (offline) return { status: "skipped-offline" };
  const rpcUrl = process.env.HOODYOOR_RPC_URL
    || launchManifest.targetChain.publicRpc;
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    const candidates = [
      [config.owner, "configured-owner"],
      [config.treasury, "configured-treasury"],
      [gates.deployer, "deployer"],
      [gates.resultSigner, "result-signer"],
      [gates.relayer, "relayer"],
    ].filter(([address]) => address);
    const unique = new Map(candidates.map(([address, label]) => [
      getAddress(address).toLowerCase(),
      [address, label],
    ]));
    const accounts = [];
    for (const [address, label] of unique.values()) {
      accounts.push(await inspectAddress(provider, address, label));
    }
    return {
      status: Number(network.chainId) === HOODYOOR_CHAIN_ID ? "pass" : "wrong-chain",
      chainId: Number(network.chainId),
      blockNumber: await provider.getBlockNumber(),
      rpcSource: process.env.HOODYOOR_RPC_URL ? "configured" : "official-public-fallback",
      accounts,
    };
  } catch (error) {
    return { status: "unavailable", error: error.message };
  }
}

async function inspectOpenSea() {
  if (offline) return { status: "skipped-offline" };
  try {
    const response = await fetch("https://api.opensea.io/api/v2/chains", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { status: "unavailable", httpStatus: response.status };
    const payload = await response.json();
    const supported = payload.chains?.some(({ chain }) => chain === "robinhood") || false;
    return { status: supported ? "pass" : "unsupported", chainSlug: "robinhood" };
  } catch (error) {
    return { status: "unavailable", error: error.message };
  }
}

if (launchManifest.targetChain.chainId !== HOODYOOR_CHAIN_ID) {
  throw new Error("Launch manifest targets an unexpected chain.");
}
if (launchManifest.economics.configuredOwner.toLowerCase() !== config.owner.toLowerCase()) {
  throw new Error("Configured owner differs from the frozen launch manifest.");
}
if (launchManifest.economics.configuredTreasury.toLowerCase() !== config.treasury.toLowerCase()) {
  throw new Error("Configured treasury differs from the frozen launch manifest.");
}

const publicGateEnvironment = Object.fromEntries([
  "HOODYOOR_DEPLOYER_ADDRESS",
  "HOODYOOR_RESULT_SIGNER",
  "HOODYOOR_RELAYER_ADDRESS",
  "HOODYOOR_REVEAL_COMMITMENT",
  "HOODYOOR_OWNER_TREASURY_CONTROL_VERIFIED",
  "HOODYOOR_ENERGY_LEDGER_FROZEN",
  "HOODYOOR_REVEAL_BLOCKHASH_VALIDATED",
  "HOODYOOR_REVEAL_BACKUP_CONFIRMED",
  "HOODYOOR_SECURITY_REVIEW_APPROVED",
  "HOODYOOR_SECURITY_REVIEW_WAIVER",
  "HOODYOOR_MINT_ENERGY_REWARD_APPROVED",
  "ALLOW_HOODYOOR_MAINNET",
  "HOODYOOR_MAINNET_ACK",
].filter((name) => Object.hasOwn(process.env, name)).map((name) => [name, process.env[name]]));
const gates = mainnetGateReport(
  config.owner,
  publicGateEnvironment,
  { allowPrivateKeyDerivation: false },
);
const energyMigration = verifyFrozenEnergyMigrationLedger(projectRoot);
const revealBackup = {
  passed: false,
  status: "not-read-in-keyless-preflight",
  path: "data/game/private/hoodyoor-reveal-secret-4663.json",
};
const payloads = verifyPayloads();
const branding = verifyBranding();
const [network, openSea] = await Promise.all([
  inspectNetwork(gates),
  inspectOpenSea(),
]);
const finalizationCheckpoint = fs.existsSync(finalizationCheckpointPath)
  ? readJson(finalizationCheckpointPath)
  : null;
const deploymentComplete = finalizationCheckpoint?.schema
  === "dyoor-hoodyoor-launch-finalization-v1"
  && finalizationCheckpoint.chainId === HOODYOOR_CHAIN_ID
  && finalizationCheckpoint.status === "staged-sale-closed";
const localIntegrity = payloads.every(({ passed }) => passed)
  && branding.every(({ passed }) => passed);
const ready = gates.ready
  && energyMigration.passed
  && revealBackup.passed
  && localIntegrity
  && network.status === "pass"
  && openSea.status === "pass";

const report = {
  schema: "dyoor-hoodyoor-mainnet-preflight-v1",
  mode: offline ? "offline" : "read-only-live",
  ready,
  broadcastCapability: false,
  broadcastAttempted: false,
  privateKeyRead: false,
  privateRevealSecretRead: false,
  collection: launchManifest.collection,
  chainId: HOODYOOR_CHAIN_ID,
  configuredOwner: getAddress(config.owner),
  configuredTreasury: getAddress(config.treasury),
  operationalWallets: {
    deployer: gates.deployer,
    resultSigner: gates.resultSigner,
    relayer: gates.relayer,
  },
  securityReview: gates.securityReview,
  mintEnergyRewardApproved: gates.mintEnergyRewardApproved,
  launchGates: gates.gates,
  blockers: [...new Set([
    ...gates.blockers,
    ...(!energyMigration.passed ? ["energy-migration-ledger-integrity"] : []),
    ...(!revealBackup.passed ? ["reveal-secret-offline-backup"] : []),
    ...(!localIntegrity ? ["local-payload-or-branding-integrity"] : []),
    ...(network.status !== "pass" ? [`robinhood-rpc-${network.status}`] : []),
    ...(openSea.status !== "pass" ? [`opensea-robinhood-${openSea.status}`] : []),
  ])],
  payloads,
  energyMigration,
  revealBackup,
  branding,
  network,
  openSea,
  deployment: {
    complete: deploymentComplete,
    status: finalizationCheckpoint?.status || "not-finalized",
    collection: finalizationCheckpoint?.collection || null,
    completedAtBlock: finalizationCheckpoint?.completedAtBlock || null,
  },
  deploymentCheckpoints: [
    checkpointStatus("hoodyoor-onchain-art"),
    checkpointStatus("hoodyoor-core"),
    checkpointStatus("hoodyoor-energy-migration"),
    checkpointStatus("hoodyoor-reroll"),
    checkpointStatus("hoodyoor-launch-finalization"),
  ],
  nextCommand: deploymentComplete
    ? "Choose and announce the GTD schedule, then separately authorize the owner transaction that opens GTD and atomically mints the 150-token reserve."
    : ready
      ? "EXECUTE_HOODYOOR_MAINNET_DEPLOYMENT=1 npm run deploy:robinhood:mainnet"
      : "Resolve every blocker, then rerun npm run preflight:robinhood:mainnet",
};

console.log(JSON.stringify(report, null, 2));
if (strict && !ready) process.exitCode = 1;
