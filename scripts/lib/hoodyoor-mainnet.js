import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  Wallet,
  getAddress,
  getBytes,
  isAddress,
  isHexString,
  keccak256,
  toBeHex,
  zeroPadValue,
} from "ethers";

export const HOODYOOR_CHAIN_ID = 4_663;
export const HOODYOOR_MAINNET_ACK = "HOODYOOR-4663-IRREVERSIBLE";
export const HOODYOOR_SECURITY_REVIEW_WAIVER_ACK =
  "HOODYOOR-OWNER-ACCEPTS-UNAUDITED-MAINNET-RISK";
export const HOODYOOR_APPROVED_MINT_ENERGY_REWARD = 1_000;
export const HOODYOOR_ENERGY_LEDGER_PATH = path.join(
  "data",
  "robinhood",
  "onchain-128",
  "hoodyoor-energy-migration-ledger.json",
);
export const HOODYOOR_REVEAL_BACKUP_PATH = path.join(
  "data",
  "game",
  "private",
  "hoodyoor-reveal-secret-4663.json",
);

export function loadHoodyoorLocalEnvironment(projectRoot, environment = process.env) {
  const local = {};
  for (const filePath of [
    path.join(projectRoot, ".env"),
    path.join(projectRoot, "data", "game", "private", "hoodyoor-mainnet.env"),
  ]) {
    if (!fs.existsSync(filePath)) continue;
    Object.assign(local, parseEnv(fs.readFileSync(filePath, "utf8")));
  }

  for (const [name, value] of Object.entries(local)) {
    if (!environment[name] && value) environment[name] = value;
  }
  if (!environment.HOODYOOR_DEPLOYER_PRIVATE_KEY && local.DEPLOYER_PRIVATE_KEY) {
    environment.HOODYOOR_DEPLOYER_PRIVATE_KEY = local.DEPLOYER_PRIVATE_KEY;
  }
  return environment;
}

export function normalizePrivateKey(value = "") {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

export function walletAddressFromPrivateKey(value = "") {
  if (!value) return null;
  try {
    return new Wallet(normalizePrivateKey(value)).address;
  } catch {
    return null;
  }
}

export function addressFromEnvironment(name, environment = process.env) {
  const value = environment[name] || "";
  return isAddress(value) ? getAddress(value) : null;
}

export function mainnetGateReport(
  configuredOwner,
  environment = process.env,
  { allowPrivateKeyDerivation = true } = {},
) {
  const owner = getAddress(configuredOwner);
  const explicitDeployer = addressFromEnvironment("HOODYOOR_DEPLOYER_ADDRESS", environment);
  const deployer = explicitDeployer || (allowPrivateKeyDerivation
    ? walletAddressFromPrivateKey(environment.HOODYOOR_DEPLOYER_PRIVATE_KEY)
    : null);
  const resultSigner = addressFromEnvironment("HOODYOOR_RESULT_SIGNER", environment);
  const relayer = addressFromEnvironment("HOODYOOR_RELAYER_ADDRESS", environment);
  const revealCommitment = environment.HOODYOOR_REVEAL_COMMITMENT || "";
  const independentReviewApproved = environment.HOODYOOR_SECURITY_REVIEW_APPROVED === "1";
  const explicitOwnerWaiver = environment.HOODYOOR_SECURITY_REVIEW_WAIVER
    === HOODYOOR_SECURITY_REVIEW_WAIVER_ACK;
  const addresses = [deployer, resultSigner, relayer].filter(Boolean);
  const distinctOperationalWallets = addresses.length === 3
    && new Set(addresses.map((address) => address.toLowerCase())).size === 3;

  const gates = [
    {
      id: "verify-owner-and-treasury-control-on-robinhood",
      passed: environment.HOODYOOR_OWNER_TREASURY_CONTROL_VERIFIED === "1",
    },
    {
      id: "final-energy-migration-ledger",
      passed: environment.HOODYOOR_ENERGY_LEDGER_FROZEN === "1",
    },
    {
      id: "result-signer-address",
      passed: Boolean(resultSigner),
    },
    {
      id: "relayer-address",
      passed: Boolean(relayer),
    },
    {
      id: allowPrivateKeyDerivation ? "deployer-private-key" : "public-deployer-address",
      passed: Boolean(deployer),
    },
    {
      id: "deployer-matches-configured-owner",
      passed: Boolean(deployer) && deployer.toLowerCase() === owner.toLowerCase(),
    },
    {
      id: "separate-deployer-result-signer-relayer",
      passed: distinctOperationalWallets,
    },
    {
      id: "public-chain-reveal-blockhash-validation",
      passed: environment.HOODYOOR_REVEAL_BLOCKHASH_VALIDATED === "1",
    },
    {
      id: "security-review-or-explicit-owner-waiver",
      passed: independentReviewApproved || explicitOwnerWaiver,
    },
    {
      id: "paid-mint-energy-owner-approval",
      passed: environment.HOODYOOR_MINT_ENERGY_REWARD_APPROVED
        === String(HOODYOOR_APPROVED_MINT_ENERGY_REWARD),
    },
    {
      id: "reveal-commitment",
      passed: isHexString(revealCommitment, 32)
        && !/^0x0{64}$/i.test(revealCommitment),
    },
    {
      id: "reveal-secret-offline-backup",
      passed: environment.HOODYOOR_REVEAL_BACKUP_CONFIRMED === "1",
    },
    {
      id: "allow-robinhood-mainnet",
      passed: environment.ALLOW_HOODYOOR_MAINNET === "1",
    },
    {
      id: "mainnet-irreversibility-acknowledgement",
      passed: environment.HOODYOOR_MAINNET_ACK === HOODYOOR_MAINNET_ACK,
    },
  ];

  return {
    configuredOwner: owner,
    deployer,
    resultSigner,
    relayer,
    securityReview: {
      independentReviewApproved,
      explicitOwnerWaiver,
      mode: independentReviewApproved
        ? "independent-review"
        : explicitOwnerWaiver ? "explicit-owner-waiver" : "unresolved",
    },
    mintEnergyRewardApproved: gates.find(
      ({ id }) => id === "paid-mint-energy-owner-approval",
    ).passed,
    revealCommitmentConfigured: gates.find(({ id }) => id === "reveal-commitment").passed,
    gates,
    blockers: gates.filter(({ passed }) => !passed).map(({ id }) => id),
    ready: gates.every(({ passed }) => passed),
  };
}

export function verifyRevealSecretBackup(
  projectRoot = process.cwd(),
  environment = process.env,
) {
  const filePath = path.join(projectRoot, HOODYOOR_REVEAL_BACKUP_PATH);
  try {
    if (environment.HOODYOOR_REVEAL_BACKUP_CONFIRMED !== "1") {
      throw new Error("Private launch environment has not acknowledged the offline backup.");
    }
    const record = readJson(filePath);
    const commitment = environment.HOODYOOR_REVEAL_COMMITMENT || "";
    if (
      record.schema !== "dyoor-hoodyoor-reveal-secret-v1"
      || record.chainId !== HOODYOOR_CHAIN_ID
      || record.offlineBackupConfirmed !== true
      || !isHexString(record.secret || "", 32)
      || !isHexString(record.commitment || "", 32)
      || !isHexString(commitment, 32)
      || keccak256(record.secret).toLowerCase() !== record.commitment.toLowerCase()
      || record.commitment.toLowerCase() !== commitment.toLowerCase()
    ) throw new Error("Reveal-secret backup record is incomplete or inconsistent.");
    if ((fs.statSync(filePath).mode & 0o077) !== 0) {
      throw new Error("Reveal-secret backup record is not private to its filesystem owner.");
    }
    return {
      passed: true,
      path: path.relative(projectRoot, filePath),
      commitment: record.commitment,
      offlineBackupConfirmed: true,
    };
  } catch (error) {
    return {
      passed: false,
      path: path.relative(projectRoot, filePath),
      error: error.message,
    };
  }
}

function encodeEnergyMigrationRows(rows) {
  const chunks = [];
  for (const row of rows) {
    chunks.push(Buffer.from(getBytes(getAddress(row.wallet))));
    chunks.push(Buffer.from(getBytes(zeroPadValue(toBeHex(BigInt(row.destinationEnergy)), 32))));
  }
  return Buffer.concat(chunks);
}

export function verifyFrozenEnergyMigrationLedger(
  projectRoot = process.cwd(),
  environment = process.env,
) {
  const filePath = path.join(projectRoot, HOODYOOR_ENERGY_LEDGER_PATH);
  try {
    const ledger = readJson(filePath);
    if (ledger.schema !== "dyoor-hoodyoor-energy-migration-v1" || ledger.status !== "frozen") {
      throw new Error("Unexpected Energy migration ledger schema or status.");
    }
    if (
      ledger.source?.chainId !== 143
      || getAddress(ledger.source.energyBank)
        !== getAddress("0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767")
      || ledger.destination?.chainId !== HOODYOOR_CHAIN_ID
      || ledger.destination?.conversion?.rounding !== "floor"
      || ledger.destination?.conversion?.divisor !== (10n ** 18n).toString()
    ) throw new Error("Unexpected Energy migration source, destination, or conversion policy.");
    if (
      !Number.isSafeInteger(ledger.source.snapshotBlock)
      || ledger.source.snapshotBlock <= 71_094_998
      || !isHexString(ledger.source.snapshotBlockHash, 32)
      || !isHexString(ledger.source.indexedLogsHash, 32)
      || !isHexString(ledger.source.energyLogsHash, 32)
    ) throw new Error("Energy migration snapshot evidence is incomplete.");

    const rows = Array.isArray(ledger.rows) ? ledger.rows : [];
    const migrationRows = rows.filter((row) => BigInt(row.destinationEnergy) > 0n);
    if (!rows.length || migrationRows.length !== ledger.totals?.migratedWallets) {
      throw new Error("Energy migration row counts are inconsistent.");
    }
    const addresses = rows.map((row) => getAddress(row.wallet).toLowerCase());
    if (
      new Set(addresses).size !== addresses.length
      || addresses.some((address, index) => index > 0 && address <= addresses[index - 1])
    ) throw new Error("Energy migration wallet rows are not unique and sorted.");
    for (const row of rows) {
      const effective = BigInt(row.effectiveSpendableRaw);
      const destination = BigInt(row.destinationEnergy);
      const fraction = BigInt(row.discardedFractionRaw);
      if (
        effective < 0n
        || destination !== effective / (10n ** 18n)
        || fraction !== effective % (10n ** 18n)
      ) throw new Error(`Invalid Energy conversion row for ${row.wallet}.`);
    }

    const binaryPath = path.join(projectRoot, ledger.binary?.path || "");
    const binary = fs.readFileSync(binaryPath);
    const encoded = encodeEnergyMigrationRows(migrationRows);
    const binaryHash = keccak256(binary);
    if (
      ledger.binary.path !== "data/robinhood/onchain-128/hoodyoor-energy-migration.bin"
      || binary.length !== migrationRows.length * 52
      || binary.length !== ledger.binary.bytes
      || !binary.equals(encoded)
      || binaryHash.toLowerCase() !== String(ledger.binary.keccak256).toLowerCase()
      || crypto.createHash("sha256").update(binary).digest("hex") !== ledger.binary.sha256
    ) throw new Error("Energy migration binary does not match its frozen ledger.");

    const destinationTotal = migrationRows.reduce(
      (total, row) => total + BigInt(row.destinationEnergy),
      0n,
    );
    const batches = Array.isArray(ledger.batches) ? ledger.batches : [];
    const batchCount = batches.reduce((total, batch) => total + Number(batch.count), 0);
    const batchTotal = batches.reduce((total, batch) => total + BigInt(batch.totalEnergy), 0n);
    if (
      destinationTotal.toString() !== ledger.totals.destinationEnergy
      || batchCount !== migrationRows.length
      || batchTotal !== destinationTotal
      || new Set(batches.map((batch) => batch.campaignId.toLowerCase())).size !== batches.length
      || batches.some((batch) => !isHexString(batch.campaignId, 32))
    ) throw new Error("Energy migration totals or batch campaign IDs are inconsistent.");

    if (
      environment.HOODYOOR_ENERGY_LEDGER_FROZEN !== "1"
      || String(environment.HOODYOOR_ENERGY_LEDGER_HASH || "").toLowerCase()
        !== binaryHash.toLowerCase()
      || String(environment.HOODYOOR_ENERGY_SNAPSHOT_BLOCK || "")
        !== String(ledger.source.snapshotBlock)
    ) throw new Error("Private launch environment does not acknowledge this exact Energy ledger.");

    return {
      passed: true,
      path: path.relative(projectRoot, filePath),
      snapshotBlock: ledger.source.snapshotBlock,
      sourceWallets: ledger.totals.sourceWallets,
      migratedWallets: ledger.totals.migratedWallets,
      destinationEnergy: ledger.totals.destinationEnergy,
      batches: batches.length,
      ledgerHash: binaryHash,
    };
  } catch (error) {
    return {
      passed: false,
      path: path.relative(projectRoot, filePath),
      error: error.message,
    };
  }
}

export function assertMainnetBroadcastSafety(
  configuredOwner,
  environment = process.env,
  projectRoot = process.cwd(),
) {
  const report = mainnetGateReport(configuredOwner, environment);
  if (!report.ready) {
    throw new Error(
      `Robinhood mainnet broadcast is blocked: ${report.blockers.join(", ")}.`,
    );
  }
  const energyMigration = verifyFrozenEnergyMigrationLedger(projectRoot, environment);
  if (!energyMigration.passed) {
    throw new Error(
      `Robinhood mainnet broadcast is blocked: Energy migration ledger integrity failed (${energyMigration.error}).`,
    );
  }
  const revealBackup = verifyRevealSecretBackup(projectRoot, environment);
  if (!revealBackup.passed) {
    throw new Error(
      `Robinhood mainnet broadcast is blocked: reveal-secret offline backup verification failed (${revealBackup.error}).`,
    );
  }
  return { ...report, energyMigration, revealBackup };
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function artifactBytecode(artifact) {
  const value = artifact.bytecode?.object || artifact.bytecode;
  if (!value || value === "0x") {
    throw new Error("Compiled artifact is missing deploy bytecode.");
  }
  return value.startsWith("0x") ? value : `0x${value}`;
}

export async function requireContract(provider, address, label) {
  if (await provider.getCode(address) === "0x") {
    throw new Error(`${label} ${address} has no contract code.`);
  }
}

export function saveCheckpoint(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}
