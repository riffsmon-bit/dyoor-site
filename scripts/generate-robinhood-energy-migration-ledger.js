import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  getBytes,
  keccak256,
  toBeHex,
  zeroPadValue,
} from "ethers";

dotenv.config({ path: ".env.local" });
dotenv.config();

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "data", "robinhood", "onchain-128");
const privateEnvironmentPath = path.join(
  projectRoot,
  "data",
  "game",
  "private",
  "hoodyoor-mainnet.env",
);

const SOURCE_CHAIN_ID = 143;
const DESTINATION_CHAIN_ID = 4_663;
const SOURCE_BANK = getAddress("0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767");
const SOURCE_DEPLOYMENT_BLOCK = 71_094_998;
const SOURCE_CREATION_TRANSACTION =
  "0x5a7ae56765759c5745e914bebda89bd249ba417a711adefd51b0944f71717a56";
const SOURCE_UNIT = 10n ** 18n;
const DEFAULT_CONFIRMATIONS = 64;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_ENERGY_API = "https://dyoor.netlify.app";
const ETHERSCAN_API = "https://api.etherscan.io/v2/api";

const BANK_ABI = [
  "function spendableEnergy(address user) view returns (uint256)",
  "function lifetimeEnergy(address user) view returns (uint256)",
  "function totalSpent(address user) view returns (uint256)",
];
const EVENT_ABI = [
  "event EnergyCredited(address indexed user,uint256 amount,bytes32 indexed claimTxHash,address indexed operator)",
  "event EnergySpent(address indexed user,address indexed spender,uint256 amount,bytes32 indexed reason)",
  "event EnergyCorrected(address indexed user,int256 delta,address indexed operator,bytes32 indexed reason)",
  "event EnergyAirdropped(bytes32 indexed campaignId,address indexed recipient,uint256 amount)",
];
const eventInterface = new Interface(EVENT_ABI);

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableMessage(error) {
  return String(
    error?.shortMessage
      || error?.info?.error?.message
      || error?.error?.message
      || error?.message
      || error,
  );
}

async function retry(task, attempts = 6) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

function parseQuantity(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value) return 0;
  return Number(BigInt(value));
}

function normalizedLogKey(log) {
  return `${String(log.transactionHash).toLowerCase()}:${parseQuantity(log.logIndex)}`;
}

function canonicalLog(log) {
  return {
    blockNumber: parseQuantity(log.blockNumber),
    transactionIndex: parseQuantity(log.transactionIndex),
    logIndex: parseQuantity(log.logIndex),
    transactionHash: String(log.transactionHash).toLowerCase(),
    address: getAddress(log.address),
    topics: (log.topics || []).map((topic) => String(topic).toLowerCase()),
    data: String(log.data || "0x").toLowerCase(),
  };
}

async function fetchIndexedLogs(apiKey, snapshotBlock) {
  const logs = [];
  const offset = 1_000;
  for (let page = 1; ; page += 1) {
    const parameters = new URLSearchParams({
      chainid: String(SOURCE_CHAIN_ID),
      module: "logs",
      action: "getLogs",
      fromBlock: String(SOURCE_DEPLOYMENT_BLOCK),
      toBlock: String(snapshotBlock),
      address: SOURCE_BANK,
      page: String(page),
      offset: String(offset),
      apikey: apiKey,
    });
    const payload = await retry(async () => {
      const response = await fetch(`${ETHERSCAN_API}?${parameters}`, {
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error(`MonadScan log request returned HTTP ${response.status}.`);
      const body = await response.json();
      if (body.status === "0" && body.message === "No records found") return [];
      if (body.status !== "1" || !Array.isArray(body.result)) {
        throw new Error(`MonadScan log request failed: ${String(body.result || body.message)}.`);
      }
      return body.result;
    });
    logs.push(...payload);
    if (payload.length < offset) break;
  }

  const unique = new Map();
  for (const rawLog of logs) {
    const log = canonicalLog(rawLog);
    if (log.address !== SOURCE_BANK) {
      throw new Error(`Indexed log returned unexpected address ${log.address}.`);
    }
    if (log.blockNumber > snapshotBlock) {
      throw new Error(`Indexed log at block ${log.blockNumber} is newer than the snapshot.`);
    }
    const key = normalizedLogKey(log);
    const previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(log)) {
      throw new Error(`Conflicting indexed log ${key}.`);
    }
    unique.set(key, log);
  }

  return [...unique.values()].sort((left, right) =>
    left.blockNumber - right.blockNumber
      || left.transactionIndex - right.transactionIndex
      || left.logIndex - right.logIndex);
}

function emptyWalletState(wallet) {
  return {
    wallet: getAddress(wallet),
    spendableRaw: 0n,
    lifetimeRaw: 0n,
    spentRaw: 0n,
    eventCount: 0,
  };
}

function replayEnergyEvents(logs) {
  const wallets = new Map();
  const eventCounts = {
    EnergyCredited: 0,
    EnergySpent: 0,
    EnergyCorrected: 0,
    EnergyAirdropped: 0,
  };
  const relevantLogs = [];
  const unknownTopicCounts = new Map();

  function stateFor(wallet) {
    const normalized = getAddress(wallet);
    const key = normalized.toLowerCase();
    if (!wallets.has(key)) wallets.set(key, emptyWalletState(normalized));
    return wallets.get(key);
  }

  for (const log of logs) {
    let parsed;
    try {
      parsed = eventInterface.parseLog({ topics: log.topics, data: log.data });
    } catch {
      const topic = log.topics[0] || "0x";
      unknownTopicCounts.set(topic, (unknownTopicCounts.get(topic) || 0) + 1);
      continue;
    }
    if (!parsed) {
      const topic = log.topics[0] || "0x";
      unknownTopicCounts.set(topic, (unknownTopicCounts.get(topic) || 0) + 1);
      continue;
    }

    eventCounts[parsed.name] += 1;
    relevantLogs.push(log);
    const wallet = parsed.name === "EnergyAirdropped"
      ? parsed.args.recipient
      : parsed.args.user;
    const state = stateFor(wallet);
    state.eventCount += 1;

    if (parsed.name === "EnergyCredited" || parsed.name === "EnergyAirdropped") {
      const amount = BigInt(parsed.args.amount);
      state.spendableRaw += amount;
      state.lifetimeRaw += amount;
    } else if (parsed.name === "EnergySpent") {
      const amount = BigInt(parsed.args.amount);
      if (state.spendableRaw < amount) {
        throw new Error(`Energy event replay underflow for ${state.wallet}.`);
      }
      state.spendableRaw -= amount;
      state.spentRaw += amount;
    } else if (parsed.name === "EnergyCorrected") {
      const delta = BigInt(parsed.args.delta);
      if (delta > 0n) {
        state.spendableRaw += delta;
        state.lifetimeRaw += delta;
      } else {
        const amount = -delta;
        if (state.spendableRaw < amount) {
          throw new Error(`Energy correction replay underflow for ${state.wallet}.`);
        }
        state.spendableRaw -= amount;
        state.spentRaw += amount;
      }
    }
  }

  return {
    wallets: [...wallets.values()].sort((left, right) =>
      left.wallet.toLowerCase().localeCompare(right.wallet.toLowerCase())),
    eventCounts,
    relevantLogs,
    unknownTopicCounts: Object.fromEntries(
      [...unknownTopicCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

async function readExactOnchainStates(bank, wallets, snapshotBlock) {
  return mapLimit(wallets, 6, async (expected) => {
    const [spendableRaw, lifetimeRaw, spentRaw] = await retry(() => Promise.all([
      bank.spendableEnergy(expected.wallet, { blockTag: snapshotBlock }),
      bank.lifetimeEnergy(expected.wallet, { blockTag: snapshotBlock }),
      bank.totalSpent(expected.wallet, { blockTag: snapshotBlock }),
    ]));
    const observed = {
      spendableRaw: BigInt(spendableRaw),
      lifetimeRaw: BigInt(lifetimeRaw),
      spentRaw: BigInt(spentRaw),
    };
    for (const key of ["spendableRaw", "lifetimeRaw", "spentRaw"]) {
      if (observed[key] !== expected[key]) {
        throw new Error(
          `Indexed event replay mismatch for ${expected.wallet} ${key}: `
            + `${expected[key]} expected, ${observed[key]} onchain.`,
        );
      }
    }
    return { ...expected, ...observed };
  });
}

function normalizeEnergyApiPayload(payload, wallet) {
  if (!payload?.ok || getAddress(payload.wallet) !== getAddress(wallet)) {
    throw new Error(`Production Energy API returned an invalid payload for ${wallet}.`);
  }
  const serverDebitRaw = BigInt(
    payload.serverSettledTraitLabDebitRaw
      ?? payload.serverSettledEnergyDebitRaw
      ?? 0,
  );
  const effectiveSpentRaw = BigInt(payload.spentRaw || 0);
  const reportedBankSpent = payload.energyBankSpentRaw;
  const bankSpentRaw = reportedBankSpent === undefined
    ? effectiveSpentRaw - serverDebitRaw
    : BigInt(reportedBankSpent || 0);
  const result = {
    wallet: getAddress(wallet),
    energyBankSpendableRaw: BigInt(payload.energyBankSpendableRaw || 0),
    lifetimeRaw: BigInt(payload.lifetimeRaw || 0),
    bankSpentRaw,
    serverDebitRaw,
    serverDebitCount: Number(
      payload.serverSettledTraitLabDebitCount
        ?? payload.serverSettledEnergyDebitCount
        ?? 0,
    ),
    effectiveSpendableRaw: BigInt(payload.spendableRaw || 0),
    effectiveSpentRaw,
    dataSource: String(payload.dataSource || ""),
  };
  if (
    result.serverDebitRaw < 0n
    || result.bankSpentRaw < 0n
    || result.effectiveSpendableRaw < 0n
  ) {
    throw new Error(`Production Energy API returned negative accounting for ${wallet}.`);
  }
  return result;
}

async function captureProductionApi(baseUrl, wallets) {
  const capturedAt = new Date().toISOString();
  const rows = await mapLimit(wallets, 5, async ({ wallet }) => retry(async () => {
    const response = await fetch(`${baseUrl}/api/energy/${wallet}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Production Energy API returned HTTP ${response.status} for ${wallet}.`);
    }
    return normalizeEnergyApiPayload(await response.json(), wallet);
  }));
  return { capturedAt, rows };
}

function assertStableApiCaptures(first, second, onchainStates) {
  const firstByWallet = new Map(first.rows.map((row) => [row.wallet.toLowerCase(), row]));
  const secondByWallet = new Map(second.rows.map((row) => [row.wallet.toLowerCase(), row]));
  return onchainStates.map((onchain) => {
    const key = onchain.wallet.toLowerCase();
    const left = firstByWallet.get(key);
    const right = secondByWallet.get(key);
    if (!left || !right) throw new Error(`Missing production Energy capture for ${onchain.wallet}.`);
    for (const field of [
      "energyBankSpendableRaw",
      "lifetimeRaw",
      "bankSpentRaw",
      "serverDebitRaw",
      "serverDebitCount",
      "effectiveSpendableRaw",
      "effectiveSpentRaw",
      "dataSource",
    ]) {
      if (left[field] !== right[field]) {
        throw new Error(`Production Energy changed during capture for ${onchain.wallet} (${field}).`);
      }
    }
    if (
      left.energyBankSpendableRaw !== onchain.spendableRaw
      || left.lifetimeRaw !== onchain.lifetimeRaw
      || left.bankSpentRaw !== onchain.spentRaw
    ) {
      throw new Error(
        `Energy Bank changed after snapshot block ${onchain.snapshotBlock || ""} for ${onchain.wallet}; rerun the snapshot.`,
      );
    }
    const expectedEffective = onchain.spendableRaw > left.serverDebitRaw
      ? onchain.spendableRaw - left.serverDebitRaw
      : 0n;
    if (left.effectiveSpendableRaw !== expectedEffective) {
      throw new Error(`Production effective Energy disagrees with bank-minus-debits for ${onchain.wallet}.`);
    }
    return { onchain, api: left };
  });
}

function encodeMigrationRows(rows) {
  const chunks = [];
  for (const row of rows) {
    chunks.push(Buffer.from(getBytes(row.wallet)));
    chunks.push(Buffer.from(getBytes(zeroPadValue(toBeHex(row.destinationEnergy), 32))));
  }
  return Buffer.concat(chunks);
}

function csvValue(value) {
  const printable = String(value ?? "");
  return `"${printable.replaceAll('"', '""')}"`;
}

function renderCsv(rows) {
  const headers = [
    "wallet",
    "sourceSpendableRaw",
    "sourceLifetimeRaw",
    "sourceSpentRaw",
    "serverSettledDebitRaw",
    "serverSettledDebitCount",
    "effectiveSpendableRaw",
    "destinationEnergy",
    "discardedFractionRaw",
    "sourceEventCount",
  ];
  return `${headers.join(",")}\n${rows.map((row) => headers
    .map((header) => csvValue(row[header]))
    .join(",")).join("\n")}\n`;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + BigInt(row[field] || 0), 0n);
}

function buildBatches(rows, ledgerHash, batchSize) {
  const batches = [];
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batchRows = rows.slice(offset, offset + batchSize);
    const index = batches.length;
    batches.push({
      index,
      start: offset,
      end: offset + batchRows.length - 1,
      count: batchRows.length,
      campaignId: keccak256(Buffer.from(
        `HOODYOOR_ENERGY_MIGRATION|${DESTINATION_CHAIN_ID}|${SOURCE_CHAIN_ID}`
          + `|${SOURCE_BANK.toLowerCase()}|${ledgerHash.toLowerCase()}|${index}`,
        "utf8",
      )),
      totalEnergy: sum(batchRows, "destinationEnergy").toString(),
    });
  }
  return batches;
}

async function writeFrozenEnvironment(ledgerHash, snapshotBlock) {
  let contents = await fs.readFile(privateEnvironmentPath, "utf8");
  const updates = {
    HOODYOOR_ENERGY_LEDGER_FROZEN: "1",
    HOODYOOR_ENERGY_LEDGER_HASH: ledgerHash,
    HOODYOOR_ENERGY_SNAPSHOT_BLOCK: String(snapshotBlock),
  };
  for (const [name, value] of Object.entries(updates)) {
    const expression = new RegExp(`^${name}=.*$`, "m");
    if (expression.test(contents)) contents = contents.replace(expression, `${name}=${value}`);
    else contents += `${contents.endsWith("\n") ? "" : "\n"}${name}=${value}\n`;
  }
  const temporaryPath = `${privateEnvironmentPath}.tmp`;
  await fs.writeFile(temporaryPath, contents, { mode: 0o600 });
  await fs.rename(temporaryPath, privateEnvironmentPath);
  await fs.chmod(privateEnvironmentPath, 0o600);
}

async function main() {
  const rpcUrl = readEnv("ALCHEMY_MONAD_RPC_URL", "MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL");
  const apiKey = readEnv("MONADSCAN_API_KEY");
  const energyApiBase = readEnv("HOODYOOR_ENERGY_API_BASE_URL") || DEFAULT_ENERGY_API;
  if (!rpcUrl) throw new Error("A Monad RPC URL is required.");
  if (!apiKey) throw new Error("MONADSCAN_API_KEY is required for the complete indexed log export.");

  const confirmations = positiveInteger(
    readEnv("HOODYOOR_ENERGY_SNAPSHOT_CONFIRMATIONS"),
    DEFAULT_CONFIRMATIONS,
  );
  const batchSize = positiveInteger(readEnv("HOODYOOR_ENERGY_MIGRATION_BATCH_SIZE"), DEFAULT_BATCH_SIZE);
  const provider = new JsonRpcProvider(rpcUrl, SOURCE_CHAIN_ID, {
    staticNetwork: true,
    batchMaxCount: 100,
  });
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== SOURCE_CHAIN_ID) {
    throw new Error(`Wrong source chain ${network.chainId}; expected ${SOURCE_CHAIN_ID}.`);
  }
  const latestBlock = await provider.getBlockNumber();
  const snapshotBlock = latestBlock - confirmations;
  if (snapshotBlock <= SOURCE_DEPLOYMENT_BLOCK) throw new Error("Invalid Energy snapshot block.");
  const [block, sourceCode] = await Promise.all([
    provider.getBlock(snapshotBlock),
    provider.getCode(SOURCE_BANK, snapshotBlock),
  ]);
  if (!block?.hash || sourceCode === "0x") {
    throw new Error("Could not resolve the exact Energy snapshot block and contract code.");
  }

  const indexedLogs = await fetchIndexedLogs(apiKey, snapshotBlock);
  const replay = replayEnergyEvents(indexedLogs);
  if (!replay.wallets.length) throw new Error("The Energy event replay produced no wallets.");
  const bank = new Contract(SOURCE_BANK, BANK_ABI, provider);
  const onchainStates = await readExactOnchainStates(bank, replay.wallets, snapshotBlock);

  const firstCapture = await captureProductionApi(energyApiBase, onchainStates);
  const secondCapture = await captureProductionApi(energyApiBase, onchainStates);
  const stable = assertStableApiCaptures(firstCapture, secondCapture, onchainStates);

  const rows = stable.map(({ onchain, api }) => {
    const destinationEnergy = api.effectiveSpendableRaw / SOURCE_UNIT;
    return {
      wallet: onchain.wallet,
      sourceSpendableRaw: onchain.spendableRaw.toString(),
      sourceLifetimeRaw: onchain.lifetimeRaw.toString(),
      sourceSpentRaw: onchain.spentRaw.toString(),
      serverSettledDebitRaw: api.serverDebitRaw.toString(),
      serverSettledDebitCount: api.serverDebitCount,
      effectiveSpendableRaw: api.effectiveSpendableRaw.toString(),
      destinationEnergy: destinationEnergy.toString(),
      discardedFractionRaw: (api.effectiveSpendableRaw % SOURCE_UNIT).toString(),
      sourceEventCount: onchain.eventCount,
    };
  });
  const migrationRows = rows.filter((row) => BigInt(row.destinationEnergy) > 0n);
  const binary = encodeMigrationRows(migrationRows);
  const ledgerHash = keccak256(binary);
  const batches = buildBatches(migrationRows, ledgerHash, batchSize);
  const indexedLogsHash = keccak256(Buffer.from(JSON.stringify(indexedLogs), "utf8"));
  const energyLogsHash = keccak256(Buffer.from(JSON.stringify(replay.relevantLogs), "utf8"));
  const generatedAt = new Date().toISOString();

  const ledger = {
    schema: "dyoor-hoodyoor-energy-migration-v1",
    status: "frozen",
    generatedAt,
    source: {
      chainId: SOURCE_CHAIN_ID,
      energyBank: SOURCE_BANK,
      deploymentBlock: SOURCE_DEPLOYMENT_BLOCK,
      creationTransaction: SOURCE_CREATION_TRANSACTION,
      snapshotBlock,
      snapshotBlockHash: block.hash,
      snapshotTimestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
      confirmationsAtCapture: confirmations,
      contractRuntimeCodeHash: keccak256(sourceCode),
      indexedLogCount: indexedLogs.length,
      indexedLogsHash,
      energyLogCount: replay.relevantLogs.length,
      energyLogsHash,
      eventCounts: replay.eventCounts,
      nonEnergyTopicCounts: replay.unknownTopicCounts,
      indexer: "Etherscan V2 / MonadScan",
      exactStateVerification: "all replayed spendable/lifetime/spent balances matched eth_call at snapshotBlock",
    },
    productionDebitOverlay: {
      apiBaseUrl: energyApiBase,
      firstCapturedAt: firstCapture.capturedAt,
      secondCapturedAt: secondCapture.capturedAt,
      verification: "two captures matched and bank fields matched the exact-block onchain replay",
    },
    destination: {
      chainId: DESTINATION_CHAIN_ID,
      unit: "whole Energy",
      conversion: {
        sourceDecimals: 18,
        divisor: SOURCE_UNIT.toString(),
        rounding: "floor",
        rationale: "HoodYØØR reroll costs are whole-Energy integers; no new Energy is created during conversion.",
      },
      binaryRecordFormat: "20-byte address followed by 32-byte big-endian destination Energy",
      recordBytes: 52,
      batchSize,
    },
    totals: {
      sourceWallets: rows.length,
      migratedWallets: migrationRows.length,
      zeroDestinationWallets: rows.length - migrationRows.length,
      sourceSpendableRaw: sum(rows, "sourceSpendableRaw").toString(),
      serverSettledDebitRaw: sum(rows, "serverSettledDebitRaw").toString(),
      effectiveSpendableRaw: sum(rows, "effectiveSpendableRaw").toString(),
      destinationEnergy: sum(rows, "destinationEnergy").toString(),
      discardedFractionRaw: sum(rows, "discardedFractionRaw").toString(),
      migrationBatches: batches.length,
    },
    binary: {
      path: "data/robinhood/onchain-128/hoodyoor-energy-migration.bin",
      bytes: binary.length,
      sha256: crypto.createHash("sha256").update(binary).digest("hex"),
      keccak256: ledgerHash,
    },
    csv: {
      path: "data/robinhood/onchain-128/hoodyoor-energy-migration.csv",
    },
    batches,
    rows,
  };

  await fs.mkdir(outputRoot, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(outputRoot, "hoodyoor-energy-migration-ledger.json"),
      `${JSON.stringify(ledger, null, 2)}\n`,
    ),
    fs.writeFile(path.join(outputRoot, "hoodyoor-energy-migration.bin"), binary),
    fs.writeFile(path.join(outputRoot, "hoodyoor-energy-migration.csv"), renderCsv(rows)),
  ]);

  const freeze = process.env.FREEZE_HOODYOOR_ENERGY_LEDGER === "1";
  if (freeze) await writeFrozenEnvironment(ledgerHash, snapshotBlock);
  console.log(JSON.stringify({
    schema: ledger.schema,
    status: ledger.status,
    frozenEnvironmentUpdated: freeze,
    sourceChainId: SOURCE_CHAIN_ID,
    snapshotBlock,
    indexedLogs: indexedLogs.length,
    energyLogs: replay.relevantLogs.length,
    sourceWallets: rows.length,
    migratedWallets: migrationRows.length,
    destinationEnergy: ledger.totals.destinationEnergy,
    ledgerHash,
    batches: batches.length,
    output: path.relative(projectRoot, path.join(outputRoot, "hoodyoor-energy-migration-ledger.json")),
  }, null, 2));
}

main().catch((error) => {
  console.error(retryableMessage(error));
  process.exitCode = 1;
});
