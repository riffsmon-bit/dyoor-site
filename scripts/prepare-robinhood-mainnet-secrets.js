import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { Wallet, getAddress, hexlify, keccak256 } from "ethers";
import {
  HOODYOOR_CHAIN_ID,
  HOODYOOR_MAINNET_ACK,
  normalizePrivateKey,
  readJson,
} from "./lib/hoodyoor-mainnet.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateRoot = path.join(projectRoot, "data", "game", "private");
const environmentPath = path.join(privateRoot, "hoodyoor-mainnet.env");
const revealPath = path.join(privateRoot, "hoodyoor-reveal-secret-4663.json");
const rootEnvironment = parseEnv(fs.readFileSync(path.join(projectRoot, ".env"), "utf8"));
const config = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
));

function privateWrite(filePath, contents) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, contents, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

function validateDistinct(deployer, resultSigner, relayer) {
  const values = [deployer, resultSigner, relayer].map((address) => address.toLowerCase());
  if (new Set(values).size !== values.length) {
    throw new Error("Deployer, result signer, and relayer must be distinct wallets.");
  }
}

const deployerKey = normalizePrivateKey(rootEnvironment.DEPLOYER_PRIVATE_KEY || "");
if (!deployerKey) throw new Error("DEPLOYER_PRIVATE_KEY is missing from .env.");
const deployer = new Wallet(deployerKey);
if (deployer.address !== getAddress(config.owner) || config.treasury !== config.owner) {
  throw new Error("The local deployer must match the unified HoodYØØR owner/treasury.");
}

fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(privateRoot, 0o700);

let resultSignerAddress;
let relayerAddress;
let revealCommitment;
let created = false;

if (fs.existsSync(environmentPath) || fs.existsSync(revealPath)) {
  if (!fs.existsSync(environmentPath) || !fs.existsSync(revealPath)) {
    throw new Error("Private launch files are incomplete; refusing to replace either one.");
  }
  const prepared = parseEnv(fs.readFileSync(environmentPath, "utf8"));
  const reveal = readJson(revealPath);
  const resultSigner = new Wallet(normalizePrivateKey(
    prepared.HOODYOOR_RESULT_SIGNER_PRIVATE_KEY || "",
  ));
  const relayer = new Wallet(normalizePrivateKey(
    prepared.HOODYOOR_RELAYER_PRIVATE_KEY || "",
  ));
  resultSignerAddress = resultSigner.address;
  relayerAddress = relayer.address;
  revealCommitment = keccak256(reveal.secret);
  validateDistinct(deployer.address, resultSignerAddress, relayerAddress);
  if (
    getAddress(prepared.HOODYOOR_RESULT_SIGNER) !== resultSignerAddress
    || getAddress(prepared.HOODYOOR_RELAYER_ADDRESS) !== relayerAddress
    || prepared.HOODYOOR_REVEAL_COMMITMENT.toLowerCase() !== revealCommitment.toLowerCase()
    || reveal.commitment.toLowerCase() !== revealCommitment.toLowerCase()
  ) throw new Error("Existing private launch files failed their consistency check.");
} else {
  const resultSigner = Wallet.createRandom();
  const relayer = Wallet.createRandom();
  const revealSecret = hexlify(randomBytes(32));
  resultSignerAddress = resultSigner.address;
  relayerAddress = relayer.address;
  revealCommitment = keccak256(revealSecret);
  validateDistinct(deployer.address, resultSignerAddress, relayerAddress);

  const environment = [
    "# HoodYØØR chain-4663 private launch environment. Never commit or share.",
    "HOODYOOR_RPC_URL=https://rpc.mainnet.chain.robinhood.com",
    `HOODYOOR_RESULT_SIGNER=${resultSignerAddress}`,
    `HOODYOOR_RESULT_SIGNER_PRIVATE_KEY=${resultSigner.privateKey}`,
    `HOODYOOR_RELAYER_ADDRESS=${relayerAddress}`,
    `HOODYOOR_RELAYER_PRIVATE_KEY=${relayer.privateKey}`,
    `HOODYOOR_REVEAL_COMMITMENT=${revealCommitment}`,
    "HOODYOOR_OWNER_TREASURY_CONTROL_VERIFIED=1",
    "HOODYOOR_ENERGY_LEDGER_FROZEN=",
    "HOODYOOR_REVEAL_BLOCKHASH_VALIDATED=",
    "HOODYOOR_REVEAL_BACKUP_CONFIRMED=",
    "HOODYOOR_SECURITY_REVIEW_APPROVED=",
    "HOODYOOR_SECURITY_REVIEW_WAIVER=",
    "HOODYOOR_MINT_ENERGY_REWARD_APPROVED=",
    "ALLOW_HOODYOOR_MAINNET=1",
    `HOODYOOR_MAINNET_ACK=${HOODYOOR_MAINNET_ACK}`,
    "",
  ].join("\n");
  privateWrite(environmentPath, environment);
  privateWrite(revealPath, `${JSON.stringify({
    schema: "dyoor-hoodyoor-reveal-secret-v1",
    chainId: HOODYOOR_CHAIN_ID,
    collection: config.name,
    secret: revealSecret,
    commitment: revealCommitment,
    createdAt: new Date().toISOString(),
    offlineBackupConfirmed: false,
  }, null, 2)}\n`);
  created = true;
}

console.log(JSON.stringify({
  created,
  chainId: HOODYOOR_CHAIN_ID,
  deployer: deployer.address,
  resultSigner: resultSignerAddress,
  relayer: relayerAddress,
  revealCommitment,
  privateEnvironment: path.relative(projectRoot, environmentPath),
  revealSecretBackup: path.relative(projectRoot, revealPath),
  privateFilesMode: "0600",
  next: "Back up the reveal-secret file offline before freezing its commitment onchain.",
}, null, 2));
