import { ethers } from "ethers";

const CHAIN_ID = 143;
const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_ASCENSION_STAKING = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";

const ENERGY_BANK_ABI = [
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)"
];
const ASCENSION_ABI = [
  "event PointsClaimed(address indexed user,uint256 amount)"
];

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST,OPTIONS"
    }
  });
}

function requireAddress(value, label) {
  try {
    return ethers.getAddress(value);
  } catch {
    throw new Error(`${label} must be a valid address.`);
  }
}

function requireUint(value, label) {
  if (!/^\d+$/.test(String(value || ""))) throw new Error(`${label} must be a positive integer.`);
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function requireTxHash(value) {
  const txHash = String(value || "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("txHash must be a transaction hash.");
  return txHash.toLowerCase();
}

function normalizePrivateKey(value) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return json(200, { ok: true });
    if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

    const energyBankAddress = requireAddress(process.env.ENERGY_BANK_ADDRESS, "ENERGY_BANK_ADDRESS");
    const ascensionStaking = requireAddress(
      process.env.ASCENSION_STAKING_ADDRESS || DEFAULT_ASCENSION_STAKING,
      "ASCENSION_STAKING_ADDRESS"
    );
    const signerKey = normalizePrivateKey(
      process.env.ENERGY_BANK_OPERATOR_PRIVATE_KEY ||
      process.env.DEPLOYER_PRIVATE_KEY ||
      ""
    );
    if (!signerKey) {
      return json(500, { ok: false, error: "Missing ENERGY_BANK_OPERATOR_PRIVATE_KEY" });
    }

    const body = await request.json().catch(() => ({}));
    const user = requireAddress(body.user || body.address, "user");
    const amount = requireUint(body.amountRaw, "amountRaw");
    const claimTxHash = requireTxHash(body.txHash);

    const provider = new ethers.JsonRpcProvider(process.env.MONAD_RPC_URL || DEFAULT_RPC, CHAIN_ID);
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(CHAIN_ID)) {
      throw new Error(`Wrong RPC network. Expected chain ${CHAIN_ID}, got ${network.chainId.toString()}.`);
    }

    const receipt = await provider.getTransactionReceipt(claimTxHash);
    if (!receipt) return json(409, { ok: false, error: "Harvest transaction is not confirmed yet." });
    if (receipt.status !== 1) return json(400, { ok: false, error: "Harvest transaction failed on-chain." });

    const ascensionInterface = new ethers.Interface(ASCENSION_ABI);
    const claimTopic = ethers.id("PointsClaimed(address,uint256)");
    const claimLog = receipt.logs.find((log) => (
      log.address.toLowerCase() === ascensionStaking.toLowerCase() &&
      log.topics?.[0] === claimTopic
    ));

    if (!claimLog) {
      return json(400, { ok: false, error: "Harvest transaction did not emit PointsClaimed from Ascension staking." });
    }

    const parsedClaim = ascensionInterface.parseLog(claimLog);
    if (ethers.getAddress(parsedClaim.args.user) !== user) {
      return json(400, { ok: false, error: "Harvest event user does not match wallet." });
    }
    if (parsedClaim.args.amount !== amount) {
      return json(400, { ok: false, error: "Harvest event amount does not match requested credit." });
    }

    const signer = new ethers.Wallet(signerKey, provider);
    const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer);
    const alreadyUsed = await bank.usedClaimTxHash(claimTxHash);
    if (alreadyUsed) {
      return json(200, {
        ok: true,
        alreadyCredited: true,
        energyBankAddress,
        user,
        amountRaw: amount.toString(),
        claimTxHash
      });
    }

    const creditRole = await bank.CREDIT_ROLE();
    const hasCreditRole = await bank.hasRole(creditRole, signer.address);
    if (!hasCreditRole) {
      return json(500, { ok: false, error: "Energy Bank operator does not have CREDIT_ROLE." });
    }

    const tx = await bank.creditEnergy(user, amount, claimTxHash);
    const creditReceipt = await tx.wait();

    return json(200, {
      ok: true,
      energyBankAddress,
      user,
      amountRaw: amount.toString(),
      claimTxHash,
      operator: signer.address,
      creditTxHash: tx.hash,
      creditBlock: creditReceipt?.blockNumber ?? null
    });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
