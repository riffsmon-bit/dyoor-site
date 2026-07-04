import { ethers } from "ethers";
import { dyoorS2Contract } from "@/lib/contracts/addresses";
import {
  REQUIRED_TRAIT_TYPES,
  buildTokenMetadataAsync,
  getRuntimeMetadataConfig,
  parseTokenId,
} from "@/lib/dyoor-s2-metadata.js";
import { addEnergyDebit } from "@/src/lib/storage/energyStore";
import { getTraitOverrides, saveTraitOverride } from "@/src/lib/storage/traitStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REROLL_WINDOW_MS = 5 * 60 * 1000;
const LOCKED_TRAITS = new Set(["Background", "Droid"]);
const DEFAULT_REROLL_COST_RAW = ethers.parseUnits("250", 18).toString();
const ERC721_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
];

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeWallet(value: unknown) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    return "";
  }
}

function rerollCostRaw() {
  const raw = readEnv("DYOOR_REROLL_COST_RAW");
  return /^\d+$/.test(raw) && BigInt(raw) > 0n ? raw : DEFAULT_REROLL_COST_RAW;
}

function requireOperationId(value: unknown) {
  const raw = String(value || "").trim();
  if (!/^[a-zA-Z0-9:._-]{8,120}$/.test(raw)) {
    throw Object.assign(new Error("operationId is required and must be 8-120 safe characters."), { status: 400 });
  }
  return raw;
}

function rerollMessage({
  wallet,
  tokenId,
  traitType,
  value,
  costRaw,
  operationId,
  timestamp,
  nonce,
}: {
  wallet: string;
  tokenId: number;
  traitType: string;
  value: string;
  costRaw: string;
  operationId: string;
  timestamp: string;
  nonce: string;
}) {
  return [
    "DYOOR Trait Reroll",
    `Wallet: ${wallet}`,
    `Token ID: ${tokenId}`,
    `Trait: ${traitType}`,
    `Value: ${value}`,
    `CostRaw: ${costRaw}`,
    `Operation ID: ${operationId}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

async function verifyTokenOwner(tokenId: number, wallet: string) {
  if (!dyoorS2Contract) {
    throw Object.assign(new Error("NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS is required before rerolls can be enabled."), { status: 500 });
  }
  const rpcUrl = readEnv("DYOOR_S2_RPC_URL", "NEXT_PUBLIC_DYOOR_S2_RPC_URL", "MONAD_TESTNET_RPC_URL");
  if (!rpcUrl) {
    throw Object.assign(new Error("DYOOR_S2_RPC_URL or NEXT_PUBLIC_DYOOR_S2_RPC_URL is required before rerolls can be enabled."), { status: 500 });
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(dyoorS2Contract, ERC721_ABI, provider);
  const owner = normalizeWallet(await contract.ownerOf(BigInt(tokenId)));
  if (!owner || owner.toLowerCase() !== wallet.toLowerCase()) {
    throw Object.assign(new Error("Wallet does not own this token."), { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const wallet = normalizeWallet(body.wallet);
    if (!wallet) return json(400, { ok: false, error: "wallet must be a valid address." });

    const config = await getRuntimeMetadataConfig();
    const parsedToken = parseTokenId(body.tokenId, config.maxSupply);
    if (!parsedToken.ok || typeof parsedToken.tokenId !== "number") {
      return json(parsedToken.status || 400, { ok: false, error: parsedToken.error || "Invalid token ID." });
    }

    const traitType = String(body.traitType || "").trim();
    const value = String(body.value || "").trim();
    if (!REQUIRED_TRAIT_TYPES.includes(traitType)) return json(400, { ok: false, error: "traitType is not rerollable." });
    if (LOCKED_TRAITS.has(traitType)) return json(400, { ok: false, error: `${traitType} is locked and cannot be rerolled.` });
    if (!value || value.length > 80) return json(400, { ok: false, error: "value is required and must be 80 characters or less." });

    const operationId = requireOperationId(body.operationId || body.nonce);
    const timestamp = String(body.timestamp || "");
    const nonce = String(body.nonce || "");
    const signature = String(body.signature || "");
    const costRaw = String(body.costRaw || rerollCostRaw());

    if (!/^\d+$/.test(costRaw) || BigInt(costRaw) <= 0n) return json(400, { ok: false, error: "costRaw must be a positive integer string." });
    if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > REROLL_WINDOW_MS) {
      return json(401, { ok: false, error: "Reroll authorization expired. Sign again." });
    }
    if (!nonce || !signature) return json(400, { ok: false, error: "Missing reroll signature." });

    const message = rerollMessage({
      wallet,
      tokenId: parsedToken.tokenId,
      traitType,
      value,
      costRaw,
      operationId,
      timestamp,
      nonce,
    });
    let recovered = "";
    try {
      recovered = normalizeWallet(ethers.verifyMessage(message, signature));
    } catch {
      recovered = "";
    }
    if (recovered.toLowerCase() !== wallet.toLowerCase()) {
      return json(401, { ok: false, error: "Signature does not match wallet." });
    }

    await verifyTokenOwner(parsedToken.tokenId, wallet);

    const current = await getTraitOverrides(parsedToken.tokenId);
    if (current?.frozen) return json(409, { ok: false, error: "Token metadata is frozen." });

    const nextOverride = {
      ...current,
      version: Math.max(Number(current?.version || 1) + 1, 2),
      attributes: {
        ...(current?.attributes || {}),
        [traitType]: value,
      },
      updatedAt: new Date().toISOString(),
      updatedBy: wallet,
      notes: `Reroll operation ${operationId}`,
    };

    const debit = await addEnergyDebit({
      id: `reroll:${operationId}`,
      wallet,
      amountRaw: costRaw,
      type: "DEBIT_REROLL",
      source: "trait-reroll",
      tokenId: String(parsedToken.tokenId),
      notes: `${traitType} reroll to ${value}.`,
    });
    const override = await saveTraitOverride(parsedToken.tokenId, nextOverride);
    const metadata = await buildTokenMetadataAsync(parsedToken.tokenId, config);

    return json(200, {
      ok: true,
      wallet,
      tokenId: parsedToken.tokenId,
      operationId,
      costRaw,
      debitDeduped: debit.deduped,
      override,
      metadata: metadata.metadata,
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Reroll failed." });
  }
}
