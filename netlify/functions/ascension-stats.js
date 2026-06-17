const { getStore } = require("@netlify/blobs");

const CHAIN_ID = 143;
const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_ASCENSION_STAKING = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const DEFAULT_ENERGY_BANK = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
const DEFAULT_LEDGER_URL = "https://raw.githubusercontent.com/riffsmon-bit/dyoor-site/main/data/harvested-energy.json";
const MAX_SUPPLY = 1111;
const DEFAULT_LOG_CHUNK_SIZE = 5000n;
const POINTS_CLAIMED_TOPIC = "0xba953728785de35be3827ee7a7a7867a8472947562602939440e6c0bdbf4725e";
const ENERGY_AIRDROPPED_TOPIC = "0xc87ee47d849e744604f4b906a3f99f2cb6e8a58a1a1b26d434a1516242c875e9";
const ENERGY_CORRECTED_TOPIC = "0xf0699d0e65e837d170097a88cefd0bfa81782baf2dd64f938951289e8b967568";
const SELECTORS = {
  pendingPoints: "0xc4950aab",
  stakedBalance: "0x60217267",
  pointsPerDay: "0x3bb1bde7",
  spendableEnergy: "0xac75ff1a",
  lifetimeEnergy: "0x662163a3",
  totalSpent: "0xa8949b46"
};
const ZERO_ACCOUNTING = {
  harvestedRaw: 0n,
  airdroppedRaw: 0n,
  bonusRaw: 0n,
  spentRaw: 0n,
  lifetimeRaw: 0n,
  bankRaw: 0n
};

function json(statusCode, body, cacheControl = "no-store") {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl
    },
    body: JSON.stringify(body)
  };
}

function normalizeAddress(address) {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function safeBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
    if (typeof value === "string" && value.trim() !== "") return BigInt(value.trim());
    return fallback;
  } catch {
    return fallback;
  }
}

function formatUnits(raw, decimals = 18) {
  const value = safeBigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}

function isTxHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || ""));
}

function toHex(value) {
  return `0x${safeBigInt(value).toString(16)}`;
}

function normalizeHexQuantity(value) {
  return toHex(value || 0n);
}

function decodeUint256(hex) {
  if (!hex || hex === "0x") return 0n;
  return safeBigInt(hex);
}

function decodeInt256(hex) {
  const raw = decodeUint256(hex);
  const signBit = 1n << 255n;
  const modulo = 1n << 256n;
  return raw >= signBit ? raw - modulo : raw;
}

function encodeAddressArg(address) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function addressTopic(address) {
  return `0x${encodeAddressArg(address)}`;
}

async function rpc(method, params = []) {
  const rpcUrl = process.env.MONAD_RPC_URL || DEFAULT_RPC;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    throw new Error(body?.error?.message || `RPC ${method} failed`);
  }
  return body.result;
}

async function ethCall(to, selector, addressArg = "") {
  const data = `${selector}${addressArg ? encodeAddressArg(addressArg) : ""}`;
  const result = await rpc("eth_call", [{ to, data }, "latest"]);
  return decodeUint256(result);
}

async function safeEthCall(to, selector, addressArg = "") {
  try {
    return await ethCall(to, selector, addressArg);
  } catch {
    return 0n;
  }
}

async function getLogsChunk(filter, fromBlock, toBlock) {
  try {
    return await rpc("eth_getLogs", [{
      ...filter,
      fromBlock: normalizeHexQuantity(fromBlock),
      toBlock: normalizeHexQuantity(toBlock)
    }]);
  } catch (err) {
    if (fromBlock >= toBlock) throw err;
    const midBlock = (fromBlock + toBlock) / 2n;
    const [left, right] = await Promise.all([
      getLogsChunk(filter, fromBlock, midBlock),
      getLogsChunk(filter, midBlock + 1n, toBlock)
    ]);
    return [].concat(left || [], right || []);
  }
}

async function scanHarvestLogs(address) {
  const stakingAddress = normalizeAddress(process.env.ASCENSION_STAKING_ADDRESS || DEFAULT_ASCENSION_STAKING);
  const latestBlock = safeBigInt(await rpc("eth_blockNumber"));
  const startBlock = safeBigInt(process.env.ASCENSION_START_BLOCK || "0");
  const chunkSize = safeBigInt(process.env.ASCENSION_LOG_CHUNK_SIZE || DEFAULT_LOG_CHUNK_SIZE.toString(), DEFAULT_LOG_CHUNK_SIZE);
  const safeChunkSize = chunkSize > 0n ? chunkSize : DEFAULT_LOG_CHUNK_SIZE;
  let fromBlock = startBlock;
  let harvestedRaw = 0n;
  let lastHarvestRaw = 0n;
  let lastHarvestTxHash = "";
  let lastHarvestBlock = null;
  let logsScanned = 0;
  let chunksScanned = 0;

  if (!stakingAddress || fromBlock > latestBlock) {
    return {
      harvestedRaw,
      lastHarvestRaw,
      lastHarvestTxHash,
      lastHarvestBlock,
      logsScanned,
      chunksScanned,
      fromBlock,
      toBlock: latestBlock
    };
  }

  while (fromBlock <= latestBlock) {
    const toBlock = fromBlock + safeChunkSize - 1n > latestBlock
      ? latestBlock
      : fromBlock + safeChunkSize - 1n;

    const logs = await getLogsChunk({
      address: stakingAddress,
      topics: [POINTS_CLAIMED_TOPIC, addressTopic(address)]
    }, fromBlock, toBlock);

    for (const log of logs || []) {
      const amountRaw = decodeUint256(log.data);
      harvestedRaw += amountRaw;
      logsScanned += 1;
      lastHarvestRaw = amountRaw;
      lastHarvestTxHash = String(log.transactionHash || "");
      lastHarvestBlock = safeBigInt(log.blockNumber).toString();
    }

    chunksScanned += 1;
    fromBlock = toBlock + 1n;
  }

  return {
    harvestedRaw,
    lastHarvestRaw,
    lastHarvestTxHash,
    lastHarvestBlock,
    logsScanned,
    chunksScanned,
    fromBlock: startBlock,
    toBlock: latestBlock
  };
}

async function scanEnergyGrantLogs(address, energyBankAddress) {
  const latestBlock = safeBigInt(await rpc("eth_blockNumber"));
  const startBlock = safeBigInt(process.env.ENERGY_BANK_START_BLOCK || "0");
  if (!energyBankAddress || startBlock > latestBlock) {
    return { airdroppedRaw: 0n, bonusRaw: 0n, logsScanned: 0 };
  }

  let airdroppedRaw = 0n;
  let bonusRaw = 0n;
  let logsScanned = 0;

  const airdrops = await getLogsChunk({
    address: energyBankAddress,
    topics: [ENERGY_AIRDROPPED_TOPIC, null, addressTopic(address)]
  }, startBlock, latestBlock);

  for (const log of airdrops || []) {
    airdroppedRaw += decodeUint256(log.data);
    logsScanned += 1;
  }

  const corrections = await getLogsChunk({
    address: energyBankAddress,
    topics: [ENERGY_CORRECTED_TOPIC, addressTopic(address)]
  }, startBlock, latestBlock);

  for (const log of corrections || []) {
    const delta = decodeInt256(log.data);
    if (delta > 0n) airdroppedRaw += delta;
    else if (delta < 0n) bonusRaw += 0n;
    logsScanned += 1;
  }

  return { airdroppedRaw, bonusRaw, logsScanned };
}

function ledgerScanFallback(record) {
  const claims = Array.isArray(record?.claims) ? record.claims : [];
  const lastClaim = claims[claims.length - 1] || {};
  return {
    harvestedRaw: safeBigInt(record?.harvestedRaw || "0"),
    lastHarvestRaw: safeBigInt(lastClaim.amountRaw || "0"),
    lastHarvestTxHash: String(lastClaim.txHash || ""),
    lastHarvestBlock: null,
    logsScanned: claims.length,
    chunksScanned: 0,
    fromBlock: 0n,
    toBlock: 0n
  };
}

function accountingFromRecord(record) {
  const grants = Array.isArray(record?.grants) ? record.grants : [];
  let airdroppedRaw = safeBigInt(record?.airdroppedRaw || "0");
  let bonusRaw = safeBigInt(record?.bonusRaw || "0");
  let spentRaw = safeBigInt(record?.spentRaw || "0");

  for (const grant of grants) {
    const amount = safeBigInt(grant?.amountRaw || "0");
    const type = String(grant?.type || "").toLowerCase();
    if (type === "airdrop") airdroppedRaw += amount;
    else if (type === "bonus") bonusRaw += amount;
  }

  return {
    ...ZERO_ACCOUNTING,
    harvestedRaw: safeBigInt(record?.harvestedRaw || "0"),
    airdroppedRaw,
    bonusRaw,
    spentRaw
  };
}

function resolveEnergyAccounting({
  harvestedRaw,
  record,
  grantScan,
  bankedRaw,
  bankLifetimeRaw,
  bankSpentRaw,
  hasEnergyBank
}) {
  const ledger = accountingFromRecord(record);
  const bonusRaw = ledger.bonusRaw;
  const spentRaw = hasEnergyBank ? bankSpentRaw : ledger.spentRaw;
  const scannedAirdroppedRaw = safeBigInt(grantScan?.airdroppedRaw || "0");
  const scannedBonusRaw = safeBigInt(grantScan?.bonusRaw || "0");
  const explicitAirdroppedRaw = scannedAirdroppedRaw > 0n ? scannedAirdroppedRaw : ledger.airdroppedRaw;
  const combinedBonusRaw = bonusRaw + scannedBonusRaw;
  const bankHasAccounting = hasEnergyBank && (bankedRaw > 0n || bankLifetimeRaw > 0n || bankSpentRaw > 0n);
  const inferredAirdroppedRaw = bankLifetimeRaw > harvestedRaw + explicitAirdroppedRaw + combinedBonusRaw
    ? bankLifetimeRaw - harvestedRaw - explicitAirdroppedRaw - combinedBonusRaw
    : 0n;
  const airdroppedRaw = explicitAirdroppedRaw + inferredAirdroppedRaw;
  const calculatedLifetimeRaw = harvestedRaw + airdroppedRaw + combinedBonusRaw;
  const lifetimeRaw = bankHasAccounting && bankLifetimeRaw > calculatedLifetimeRaw
    ? bankLifetimeRaw
    : calculatedLifetimeRaw;
  const calculatedBankRaw = lifetimeRaw > spentRaw ? lifetimeRaw - spentRaw : 0n;
  const bankRaw = bankHasAccounting && bankedRaw > calculatedBankRaw
    ? bankedRaw
    : calculatedBankRaw;

  return {
    harvestedRaw,
    airdroppedRaw,
    bonusRaw: combinedBonusRaw,
    spentRaw,
    lifetimeRaw,
    bankRaw,
    calculatedLifetimeRaw
  };
}

async function getLedgerRecord(address) {
  try {
    const store = getStore("ascension-energy-ledger");
    const record = await store.get(`${address}.json`, { type: "json" });
    if (record) return record;
  } catch {}

  try {
    const response = await fetch(process.env.HARVEST_LEDGER_URL || DEFAULT_LEDGER_URL, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) return null;
    const ledger = await response.json();
    return ledger?.[address] || null;
  } catch {
    return null;
  }
}

exports.handler = async function (event) {
  try {
    const method = (event.httpMethod || "GET").toUpperCase();

    if (method === "GET") {
      const address = normalizeAddress(event?.queryStringParameters?.address || "");
      if (!address) {
        return json(400, { ok: false, error: "Missing or invalid address" });
      }

      const record = await getLedgerRecord(address);
      const stakingAddress = normalizeAddress(process.env.ASCENSION_STAKING_ADDRESS || DEFAULT_ASCENSION_STAKING);
      const energyBankAddress = normalizeAddress(process.env.ENERGY_BANK_ADDRESS || DEFAULT_ENERGY_BANK);
      const shouldScanLogs = event?.queryStringParameters?.scanLogs === "1";
      const shouldScanGrantLogs = event?.queryStringParameters?.scanGrants === "1";
      let apiStatus = shouldScanLogs ? "ok" : "partial";
      let apiMessage = shouldScanLogs
        ? "Energy totals loaded from Ascension harvest events with chunked RPC log scans."
        : "Energy totals loaded from the harvest ledger and Energy Bank contract. Add scanLogs=1 to force a harvest-event scan.";
      let logs = ledgerScanFallback(record);

      if (shouldScanLogs) {
        try {
          logs = await scanHarvestLogs(address);
        } catch (scanErr) {
          logs = ledgerScanFallback(record);
          apiStatus = "partial";
          apiMessage = `RPC harvest log scan failed; using the off-chain harvest ledger fallback. ${String(scanErr?.message || scanErr)}`;
        }
      }
      const pendingRaw = stakingAddress
        ? await safeEthCall(stakingAddress, SELECTORS.pendingPoints, address)
        : 0n;
      const totalStakedRaw = stakingAddress
        ? await safeEthCall(stakingAddress, SELECTORS.stakedBalance, address)
        : 0n;
      const pointsPerDayRaw = stakingAddress
        ? await safeEthCall(stakingAddress, SELECTORS.pointsPerDay)
        : 0n;
      const bankedRaw = energyBankAddress
        ? await safeEthCall(energyBankAddress, SELECTORS.spendableEnergy, address)
        : logs.harvestedRaw;
      const bankLifetimeRaw = energyBankAddress
        ? await safeEthCall(energyBankAddress, SELECTORS.lifetimeEnergy, address)
        : logs.harvestedRaw;
      const bankSpentRaw = energyBankAddress
        ? await safeEthCall(energyBankAddress, SELECTORS.totalSpent, address)
        : 0n;
      const harvestedRaw = logs.harvestedRaw;
      let grantScan = { airdroppedRaw: 0n, bonusRaw: 0n, logsScanned: 0 };
      if (energyBankAddress && shouldScanGrantLogs) {
        try {
          grantScan = await scanEnergyGrantLogs(address, energyBankAddress);
        } catch (grantScanErr) {
          apiStatus = "partial";
          apiMessage = `${apiMessage} Energy Bank grant log scan failed; using lifetime fallback. ${String(grantScanErr?.message || grantScanErr)}`;
        }
      }
      const accounting = resolveEnergyAccounting({
        harvestedRaw,
        record,
        grantScan,
        bankedRaw,
        bankLifetimeRaw,
        bankSpentRaw,
        hasEnergyBank: Boolean(energyBankAddress)
      });

      console.log("DYOOR energy accounting", {
        address,
        harvestedEnergy: accounting.harvestedRaw.toString(),
        airdroppedEnergy: accounting.airdroppedRaw.toString(),
        spentEnergy: accounting.spentRaw.toString(),
        lifetimeEnergy: accounting.lifetimeRaw.toString(),
        bankEnergy: accounting.bankRaw.toString()
      });

      return json(200, {
        ok: true,
        address,
        chainId: CHAIN_ID,
        stakingAddress,
        energyBankAddress,
        pendingRaw: pendingRaw.toString(),
        pendingEnergy: formatUnits(pendingRaw),
        harvestedRaw: harvestedRaw.toString(),
        harvestedEnergy: formatUnits(harvestedRaw),
        airdroppedRaw: accounting.airdroppedRaw.toString(),
        airdroppedEnergy: formatUnits(accounting.airdroppedRaw),
        bonusRaw: accounting.bonusRaw.toString(),
        bonusEnergy: formatUnits(accounting.bonusRaw),
        spentRaw: accounting.spentRaw.toString(),
        spentEnergy: formatUnits(accounting.spentRaw),
        lifetimeRaw: accounting.lifetimeRaw.toString(),
        lifetimeEnergy: formatUnits(accounting.lifetimeRaw),
        bankedRaw: accounting.bankRaw.toString(),
        bankedEnergy: formatUnits(accounting.bankRaw),
        bankLifetimeRaw: bankLifetimeRaw.toString(),
        bankLifetimeEnergy: formatUnits(bankLifetimeRaw),
        bankSpentRaw: bankSpentRaw.toString(),
        calculatedLifetimeRaw: accounting.calculatedLifetimeRaw.toString(),
        calculatedLifetimeEnergy: formatUnits(accounting.calculatedLifetimeRaw),
        energyDebug: {
          harvestedEnergy: accounting.harvestedRaw.toString(),
          airdroppedEnergy: accounting.airdroppedRaw.toString(),
          spentEnergy: accounting.spentRaw.toString(),
          lifetimeEnergy: accounting.lifetimeRaw.toString(),
          bankEnergy: accounting.bankRaw.toString()
        },
        totalStakedRaw: totalStakedRaw.toString(),
        totalStaked: totalStakedRaw.toString(),
        pointsPerDayRaw: pointsPerDayRaw.toString(),
        maxSupply: MAX_SUPPLY,
        percent: MAX_SUPPLY ? Number(totalStakedRaw) / MAX_SUPPLY : null,
        lastHarvestRaw: logs.lastHarvestRaw.toString(),
        lastHarvestedEnergy: formatUnits(logs.lastHarvestRaw),
        lastHarvestTxHash: logs.lastHarvestTxHash,
        lastHarvestBlock: logs.lastHarvestBlock,
        logsScanned: logs.logsScanned,
        energyGrantLogsScanned: grantScan.logsScanned,
        chunksScanned: logs.chunksScanned,
        fromBlock: logs.fromBlock.toString(),
        toBlock: logs.toBlock.toString(),
        apiStatus,
        apiMessage
      }, "public, max-age=10, stale-while-revalidate=30");
    }

    if (method === "POST") {
      const store = getStore("ascension-energy-ledger");
      const body = JSON.parse(event.body || "{}");
      const action = String(body.action || "").trim();

      if (action === "recordHarvest") {
        const address = normalizeAddress(body.address);
        const amountRaw = safeBigInt(body.amountRaw || "0");

        if (!address) {
          return json(400, { ok: false, error: "Invalid address" });
        }

        if (amountRaw <= 0n) {
          return json(400, { ok: false, error: "Invalid harvest amount" });
        }

        const key = `${address}.json`;
        const existing = (await store.get(key, { type: "json" })) || {
          address,
          harvestedRaw: "0",
          claims: []
        };

        const txHash = String(body.txHash || "").toLowerCase();
        if (txHash && !isTxHash(txHash)) {
          return json(400, { ok: false, error: "Invalid txHash" });
        }
        const existingClaims = Array.isArray(existing.claims) ? existing.claims : [];

        if (txHash && existingClaims.some((c) => String(c.txHash || "").toLowerCase() === txHash)) {
          return json(200, {
            ok: true,
            deduped: true,
            address,
            harvestedRaw: String(existing.harvestedRaw || "0")
          });
        }

        const previousRaw = safeBigInt(existing.harvestedRaw || "0");
        const nextRaw = previousRaw + amountRaw;

        const nextClaims = txHash
          ? existingClaims.concat([
              {
                txHash,
                amountRaw: amountRaw.toString(),
                recordedAt: new Date().toISOString()
              }
            ])
          : existingClaims;

        await store.set(key, {
          address,
          harvestedRaw: nextRaw.toString(),
          claims: nextClaims
        });

        return json(200, {
          ok: true,
          address,
          harvestedRaw: nextRaw.toString()
        });
      }

      if (action === "seedHarvest") {
        const address = normalizeAddress(body.address);
        const amountRaw = safeBigInt(body.amountRaw || "0");
        const txHash = String(body.txHash || "").toLowerCase();

        if (!address) {
          return json(400, { ok: false, error: "Invalid address" });
        }

        if (amountRaw <= 0n) {
          return json(400, { ok: false, error: "Invalid seed amount" });
        }

        const key = `${address}.json`;
        const existing = (await store.get(key, { type: "json" })) || {
          address,
          harvestedRaw: "0",
          claims: []
        };

        const existingClaims = Array.isArray(existing.claims) ? existing.claims : [];

        if (txHash && existingClaims.some((c) => String(c.txHash || "").toLowerCase() === txHash)) {
          return json(200, {
            ok: true,
            deduped: true,
            address,
            harvestedRaw: String(existing.harvestedRaw || "0")
          });
        }

        const previousRaw = safeBigInt(existing.harvestedRaw || "0");
        const nextRaw = previousRaw + amountRaw;

        const nextClaims = txHash
          ? existingClaims.concat([
              {
                txHash,
                amountRaw: amountRaw.toString(),
                recordedAt: new Date().toISOString(),
                seeded: true
              }
            ])
          : existingClaims;

        await store.set(key, {
          address,
          harvestedRaw: nextRaw.toString(),
          claims: nextClaims
        });

        return json(200, {
          ok: true,
          address,
          harvestedRaw: nextRaw.toString()
        });
      }

      return json(400, { ok: false, error: "Unsupported action" });
    }

    return json(405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    return json(500, {
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
};
