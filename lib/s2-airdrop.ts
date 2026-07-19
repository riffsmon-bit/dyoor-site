import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";

export const S2_ASCENDED_AIRDROP_EXPECTED = {
  csvFilename: "dyoor-s2-ascended-airdrop-with-treasury.csv",
  uniqueWallets: 56,
  holderSnapshotQuantity: 510n,
  additionalTreasuryQuantity: 100n,
  totalQuantity: 610n,
  treasuryAddress: getAddress("0x4d540f7d0eb841c839334655c9f88313D750c6d5"),
  treasuryFinalQuantity: 134n,
  confirmationPhrase: "AIRDROP 610 DYOOR",
} as const;

export type AirdropCsvRow = {
  lineNumber: number;
  wallet: Address;
  rawWallet: string;
  quantity: bigint;
  sourceLineNumbers?: number[];
};

export type AirdropInvalidRow = {
  lineNumber: number;
  wallet?: string;
  quantity?: string;
  reason: string;
};

export type AirdropDuplicateRow = {
  wallet: Address;
  lineNumbers: number[];
  totalQuantity: bigint;
};

export type ParsedAirdropCsv = {
  rows: AirdropCsvRow[];
  invalidRows: AirdropInvalidRow[];
  duplicateRows: AirdropDuplicateRow[];
  totalQuantity: bigint;
  checksum: Hex;
  headers: string[];
  hasConflictingAmountHeaders: boolean;
};

export type FinalAirdropValidation = {
  ok: boolean;
  errors: string[];
  holderSnapshotQuantity: bigint;
  additionalTreasuryQuantity: bigint;
  combinedAirdropQuantity: bigint;
  treasuryFinalQuantity: bigint | null;
};

export type AirdropBatch = {
  batchId: Hex;
  batchIndex: number;
  recipients: Address[];
  quantities: bigint[];
  recipientCount: number;
  quantityMinted: bigint;
  firstCsvLine: number;
  lastCsvLine: number;
  firstWallet: Address;
  lastWallet: Address;
};

type ParsedLine = {
  values: string[];
  malformed: boolean;
};

function parseCsvLine(line: string): ParsedLine {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  let malformed = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (quoted) malformed = true;
  values.push(current.trim());
  return { values, malformed };
}

function normalizeHeaders(headerLine: string) {
  return parseCsvLine(headerLine.replace(/^\uFEFF/, "")).values
    .map((header) => header.trim().toLowerCase());
}

function parseQuantity(value: string) {
  const raw = value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = BigInt(raw);
  return parsed > 0n ? parsed : null;
}

function normalizeWallet(value: string) {
  try {
    return isAddress(value) ? getAddress(value) : "";
  } catch {
    return "";
  }
}

function canonicalRows(rows: AirdropCsvRow[]) {
  return rows
    .map((row) => `${row.lineNumber}:${row.wallet.toLowerCase()}:${row.quantity.toString()}`)
    .join("|");
}

export function parseAirdropCsv(text: string): ParsedAirdropCsv {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLineIndex = lines.findIndex((line) => line.trim());
  if (headerLineIndex === -1) {
    return {
      rows: [],
      invalidRows: [{ lineNumber: 1, reason: "CSV is empty." }],
      duplicateRows: [],
      totalQuantity: 0n,
      checksum: keccak256(toBytes("empty")),
      headers: [],
      hasConflictingAmountHeaders: false,
    };
  }

  const headers = normalizeHeaders(lines[headerLineIndex]);
  const walletIndex = headers.indexOf("wallet");
  const quantityIndex = headers.indexOf("quantity");
  const amountIndex = headers.indexOf("amount");
  const rows: AirdropCsvRow[] = [];
  const invalidRows: AirdropInvalidRow[] = [];
  const hasQuantity = quantityIndex >= 0;
  const hasAmount = amountIndex >= 0;

  if (walletIndex === -1 || (!hasQuantity && !hasAmount)) {
    invalidRows.push({
      lineNumber: headerLineIndex + 1,
      reason: "CSV must include wallet and quantity or amount headers.",
    });
  }

  for (let index = headerLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const parsedLine = parseCsvLine(line);
    const columns = parsedLine.values;
    const lineNumber = index + 1;
    const rawWallet = String(columns[walletIndex] || "").trim();
    const rawQuantity = hasQuantity ? String(columns[quantityIndex] || "").trim() : "";
    const rawAmount = hasAmount ? String(columns[amountIndex] || "").trim() : "";
    const unexpected = columns.slice(headers.length).filter((value) => value.trim());

    if (parsedLine.malformed) {
      invalidRows.push({ lineNumber, wallet: rawWallet, quantity: rawQuantity || rawAmount, reason: "Malformed quoted CSV row." });
      continue;
    }
    if (walletIndex === -1 || (!hasQuantity && !hasAmount)) {
      invalidRows.push({ lineNumber, wallet: rawWallet, quantity: rawQuantity || rawAmount, reason: "Missing required headers." });
      continue;
    }
    if (unexpected.length) {
      invalidRows.push({ lineNumber, wallet: rawWallet, quantity: rawQuantity || rawAmount, reason: "Row contains unexpected extra data." });
      continue;
    }
    if (hasQuantity && hasAmount && rawQuantity && rawAmount && rawQuantity !== rawAmount) {
      invalidRows.push({ lineNumber, wallet: rawWallet, quantity: `${rawQuantity}/${rawAmount}`, reason: "Conflicting quantity and amount values." });
      continue;
    }

    const wallet = normalizeWallet(rawWallet);
    if (!wallet) {
      invalidRows.push({ lineNumber, wallet: rawWallet, quantity: rawQuantity || rawAmount, reason: "Invalid EVM address." });
      continue;
    }

    const quantity = parseQuantity(rawQuantity || rawAmount);
    if (quantity === null) {
      invalidRows.push({ lineNumber, wallet: rawWallet, quantity: rawQuantity || rawAmount, reason: "Quantity must be a positive base-10 whole number." });
      continue;
    }

    rows.push({ lineNumber, wallet, rawWallet, quantity });
  }

  const duplicateMap = new Map<string, AirdropDuplicateRow>();
  for (const row of rows) {
    const key = row.wallet.toLowerCase();
    const duplicate = duplicateMap.get(key) || {
      wallet: row.wallet,
      lineNumbers: [],
      totalQuantity: 0n,
    };
    duplicate.lineNumbers.push(row.lineNumber);
    duplicate.totalQuantity += row.quantity;
    duplicateMap.set(key, duplicate);
  }

  const duplicateRows = Array.from(duplicateMap.values()).filter((entry) => entry.lineNumbers.length > 1);
  const totalQuantity = rows.reduce((total, row) => total + row.quantity, 0n);

  return {
    rows,
    invalidRows,
    duplicateRows,
    totalQuantity,
    checksum: keccak256(toBytes(canonicalRows(rows))),
    headers,
    hasConflictingAmountHeaders: hasQuantity && hasAmount,
  };
}

export function mergeDuplicateRows(parsed: ParsedAirdropCsv): AirdropCsvRow[] {
  const merged = new Map<string, AirdropCsvRow>();
  for (const row of parsed.rows) {
    const key = row.wallet.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row, sourceLineNumbers: [row.lineNumber] });
      continue;
    }
    existing.quantity += row.quantity;
    existing.sourceLineNumbers = [...(existing.sourceLineNumbers || [existing.lineNumber]), row.lineNumber];
  }
  return Array.from(merged.values());
}

export function validateFinalAirdropCsv(parsed: ParsedAirdropCsv): FinalAirdropValidation {
  const errors: string[] = [];
  const uniqueWallets = new Set(parsed.rows.map((row) => row.wallet.toLowerCase()));
  const treasuryRow = parsed.rows.find(
    (row) => row.wallet.toLowerCase() === S2_ASCENDED_AIRDROP_EXPECTED.treasuryAddress.toLowerCase(),
  );

  if (parsed.invalidRows.length !== 0) errors.push(`Expected 0 invalid rows; found ${parsed.invalidRows.length}.`);
  if (parsed.duplicateRows.length !== 0) errors.push(`Expected 0 duplicate wallet rows; found ${parsed.duplicateRows.length}.`);
  if (uniqueWallets.size !== S2_ASCENDED_AIRDROP_EXPECTED.uniqueWallets) {
    errors.push(`Expected ${S2_ASCENDED_AIRDROP_EXPECTED.uniqueWallets} unique wallets; found ${uniqueWallets.size}.`);
  }
  if (parsed.totalQuantity !== S2_ASCENDED_AIRDROP_EXPECTED.totalQuantity) {
    errors.push(`Expected total quantity ${S2_ASCENDED_AIRDROP_EXPECTED.totalQuantity}; found ${parsed.totalQuantity}.`);
  }
  if (!treasuryRow) {
    errors.push("Treasury wallet row is missing.");
  } else if (treasuryRow.quantity !== S2_ASCENDED_AIRDROP_EXPECTED.treasuryFinalQuantity) {
    errors.push(`Expected treasury quantity ${S2_ASCENDED_AIRDROP_EXPECTED.treasuryFinalQuantity}; found ${treasuryRow.quantity}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    holderSnapshotQuantity: S2_ASCENDED_AIRDROP_EXPECTED.holderSnapshotQuantity,
    additionalTreasuryQuantity: S2_ASCENDED_AIRDROP_EXPECTED.additionalTreasuryQuantity,
    combinedAirdropQuantity: S2_ASCENDED_AIRDROP_EXPECTED.totalQuantity,
    treasuryFinalQuantity: treasuryRow?.quantity ?? null,
  };
}

export function canonicalRecipientChecksum(rows: AirdropCsvRow[]) {
  return keccak256(toBytes(canonicalRows(rows)));
}

export function buildAirdropBatches({
  batchSize,
  chainId,
  contractAddress,
  rows,
  snapshotChecksum,
}: {
  batchSize: number;
  chainId: number | bigint;
  contractAddress: Address;
  rows: AirdropCsvRow[];
  snapshotChecksum: Hex;
}): AirdropBatch[] {
  const size = Math.max(1, Math.floor(batchSize));
  const batches: AirdropBatch[] = [];

  for (let index = 0; index < rows.length; index += size) {
    const batchRows = rows.slice(index, index + size);
    const batchIndex = batches.length;
    const recipients = batchRows.map((row) => row.wallet);
    const quantities = batchRows.map((row) => row.quantity);
    const batchId = keccak256(encodeAbiParameters(
      [
        { name: "chainId", type: "uint256" },
        { name: "contractAddress", type: "address" },
        { name: "snapshotChecksum", type: "bytes32" },
        { name: "batchIndex", type: "uint256" },
        { name: "recipients", type: "address[]" },
        { name: "quantities", type: "uint256[]" },
      ],
      [BigInt(chainId), contractAddress, snapshotChecksum, BigInt(batchIndex), recipients, quantities],
    ));

    batches.push({
      batchId,
      batchIndex,
      recipients,
      quantities,
      recipientCount: batchRows.length,
      quantityMinted: batchRows.reduce((total, row) => total + row.quantity, 0n),
      firstCsvLine: batchRows[0]?.lineNumber || 0,
      lastCsvLine: batchRows[batchRows.length - 1]?.lineNumber || 0,
      firstWallet: batchRows[0]?.wallet || "0x0000000000000000000000000000000000000000",
      lastWallet: batchRows[batchRows.length - 1]?.wallet || "0x0000000000000000000000000000000000000000",
    });
  }

  return batches;
}

export function projectedSupplyStatus(currentSupply: bigint, maxSupply: bigint, requested: bigint) {
  const projected = currentSupply + requested;
  return {
    projected,
    remainingBefore: maxSupply > currentSupply ? maxSupply - currentSupply : 0n,
    remainingAfter: maxSupply > projected ? maxSupply - projected : 0n,
    exceedsSupply: projected > maxSupply,
  };
}
