import "dotenv/config";
import { ethers } from "ethers";

const DEFAULT_MONAD_RPC_URL = "https://rpc.monad.xyz";
const DEFAULT_ENERGY_BANK_ADDRESS = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
const GAS_LIMIT = 160000n;

const RECYCLE_REWARDS = {
  Hat: "250",
  Clothes: "250",
  Special: "750",
  Accessories: "250",
  "Accessories 2": "250",
  "Stickers/Body art": "250",
};

const ENERGY_BANK_ABI = [
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function spendableEnergy(address user) view returns (uint256)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
];

function usage() {
  console.log("Usage:");
  console.log("  node scripts/trait-lab-recycle-credit.js --roll-id <uuid> --wallet <0x...> --token-id <id> --trait-type <trait> --previous-value <value>");
  console.log("  EXECUTE_RECYCLE_CREDIT=1 node scripts/trait-lab-recycle-credit.js --roll-id <uuid> --wallet <0x...> --token-id <id> --trait-type <trait> --previous-value <value>");
  console.log("");
  console.log("Required env:");
  console.log("  ENERGY_BANK_OPERATOR_PRIVATE_KEY=<operator with CREDIT_ROLE>");
  console.log("Optional env:");
  console.log("  ENERGY_BANK_ADDRESS=<Energy Bank contract>");
  console.log("  MONAD_RPC_URL=<Monad mainnet RPC>");
}

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return String(process.argv[index + 1] || "").trim();
}

function normalizePrivateKey(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[a-fA-F0-9]{64}$/.test(prefixed) ? prefixed : "";
}

function requireAddress(value, label) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    throw new Error(`${label} must be a valid EVM address.`);
  }
}

function requireArg(name, label) {
  const value = getArg(name);
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function recycleClaim({ rollId, wallet, tokenId, traitType, previousValue, rewardEnergy }) {
  return ethers.keccak256(ethers.toUtf8Bytes([
    "trait-lab-recycle",
    rollId,
    wallet.toLowerCase(),
    String(tokenId),
    traitType,
    previousValue,
    String(rewardEnergy),
  ].join(":")));
}

async function main() {
  const execute = process.env.EXECUTE_RECYCLE_CREDIT === "1" || process.argv.includes("--execute");
  const rollId = requireArg("--roll-id", "roll ID");
  const wallet = requireAddress(requireArg("--wallet", "wallet"), "wallet");
  const tokenId = requireArg("--token-id", "token ID");
  const traitType = requireArg("--trait-type", "trait type");
  const previousValue = requireArg("--previous-value", "previous trait value");
  const rewardEnergy = getArg("--reward-energy") || RECYCLE_REWARDS[traitType];

  if (!rewardEnergy) {
    throw new Error(`${traitType} does not have a configured recycle reward.`);
  }

  const rpcUrl = readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_MONAD_RPC_URL;
  const energyBank = requireAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK_ADDRESS, "Energy Bank");
  const privateKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"));
  if (!privateKey) throw new Error("Set ENERGY_BANK_OPERATOR_PRIVATE_KEY before running recycle reward credit.");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const bank = new ethers.Contract(energyBank, ENERGY_BANK_ABI, signer);
  const amount = ethers.parseUnits(String(rewardEnergy), 18);
  const claim = recycleClaim({ rollId, wallet, tokenId, traitType, previousValue, rewardEnergy });
  const [network, creditRole, before, alreadyUsed] = await Promise.all([
    provider.getNetwork(),
    bank.CREDIT_ROLE(),
    bank.spendableEnergy(wallet),
    bank.usedClaimTxHash(claim).then(Boolean).catch(() => false),
  ]);
  const hasCreditRole = await bank.hasRole(creditRole, signer.address).then(Boolean);

  console.log("DYOOR Trait Lab recycle credit");
  console.log("Mode:", execute ? "BROADCAST" : "DRY RUN");
  console.log("Chain ID:", network.chainId.toString());
  console.log("Energy Bank:", energyBank);
  console.log("Operator:", signer.address);
  console.log("Operator has CREDIT_ROLE:", hasCreditRole);
  console.log("Wallet:", wallet);
  console.log("Token ID:", tokenId);
  console.log("Trait:", traitType);
  console.log("Previous value:", previousValue);
  console.log("Reward Energy:", rewardEnergy);
  console.log("Reward raw:", amount.toString());
  console.log("Claim:", claim);
  console.log("Claim already used:", alreadyUsed);
  console.log("Before spendable:", ethers.formatUnits(before, 18));

  if (!hasCreditRole) throw new Error("Operator is missing CREDIT_ROLE.");
  if (alreadyUsed) {
    console.log("No transaction needed; claim is already used.");
    return;
  }

  await bank.creditEnergy.staticCall(wallet, amount, claim);
  console.log("Simulation: passed");

  if (!execute) {
    usage();
    return;
  }

  const tx = await bank.creditEnergy(wallet, amount, claim, { gasLimit: GAS_LIMIT });
  console.log("Transaction hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed block:", receipt?.blockNumber ?? "unknown");
  const after = await bank.spendableEnergy(wallet);
  console.log("After spendable:", ethers.formatUnits(after, 18));
}

main().catch((error) => {
  console.error(error?.shortMessage || error?.message || error);
  process.exitCode = 1;
});
