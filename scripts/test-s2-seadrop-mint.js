#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ethers } from "ethers";

const MONAD_TESTNET_CHAIN_ID = 10143;
const MONAD_MAINNET_CHAIN_ID = 143;

const SEADROP_ABI = [
  "function mintPublic(address nftContract,address feeRecipient,address minterIfNotPayer,uint256 quantity) payable",
];

const NFT_ABI = [
  "function owner() view returns (address)",
  "function allowedSeaDrop(address seaDrop) view returns (bool)",
  "function paused() view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function totalSeaDropMinted() view returns (uint256)",
  "function SEADROP_MAX_SUPPLY() view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
];

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function main() {
  const rpcUrl = env("MONAD_TESTNET_RPC_URL", env("DYOOR_S2_RPC_URL", env("NEXT_PUBLIC_DYOOR_S2_RPC_URL", "")));
  const nftAddress = env("DYOOR_S2_CONTRACT_ADDRESS", env("NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS", ""));
  const seaDropAddress = env("SEADROP_ADDRESS", "");
  const feeRecipient = env("SEADROP_FEE_RECIPIENT", ethers.ZeroAddress);
  const quantity = BigInt(env("TEST_MINT_QUANTITY", "1"));
  const mintValueWei = BigInt(env("TEST_MINT_VALUE_WEI", "0"));
  const execute = env("EXECUTE_TEST_MINT") === "1";
  const reportPath = env("TEST_MINT_REPORT", `deployments/dyoor-s2-seadrop-test-mint-${Date.now()}.json`);

  if (!rpcUrl) throw new Error("MONAD_TESTNET_RPC_URL or DYOOR_S2_RPC_URL is required.");
  if (!nftAddress) throw new Error("DYOOR_S2_CONTRACT_ADDRESS is required.");
  if (!seaDropAddress) throw new Error("SEADROP_ADDRESS is required.");
  if (quantity <= 0n) throw new Error("TEST_MINT_QUANTITY must be positive.");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) === MONAD_MAINNET_CHAIN_ID) {
    throw new Error("Refusing to run a test mint against Monad mainnet.");
  }
  if (Number(network.chainId) !== MONAD_TESTNET_CHAIN_ID) {
    throw new Error(`Expected Monad testnet chain ID ${MONAD_TESTNET_CHAIN_ID}; got ${network.chainId}.`);
  }

  const key = env("TEST_MINTER_PRIVATE_KEY", env("PRIVATE_KEY", ""));
  const signer = key ? new ethers.Wallet(key, provider) : null;
  const minter = signer ? await signer.getAddress() : env("TEST_MINTER_ADDRESS", ethers.ZeroAddress);
  const nft = new ethers.Contract(nftAddress, NFT_ABI, provider);
  const seaDrop = new ethers.Contract(seaDropAddress, SEADROP_ABI, signer || provider);

  const [
    owner,
    allowed,
    paused,
    beforeSupply,
    beforeSeaDropMinted,
    seaDropCap,
  ] = await Promise.all([
    nft.owner(),
    nft.allowedSeaDrop(seaDropAddress),
    nft.paused(),
    nft.totalSupply(),
    nft.totalSeaDropMinted(),
    nft.SEADROP_MAX_SUPPLY(),
  ]);

  const data = seaDrop.interface.encodeFunctionData("mintPublic", [
    nftAddress,
    feeRecipient,
    ethers.ZeroAddress,
    quantity,
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    execute,
    chainId: Number(network.chainId),
    nftAddress,
    seaDropAddress,
    owner,
    minter,
    feeRecipient,
    quantity,
    mintValueWei,
    allowedSeaDrop: allowed,
    paused,
    beforeSupply,
    beforeSeaDropMinted,
    seaDropCap,
    encodedTransaction: {
      to: seaDropAddress,
      data,
      value: `0x${mintValueWei.toString(16)}`,
    },
    simulation: null,
    transaction: null,
    warnings: [],
  };

  if (!allowed) report.warnings.push("SEADROP_ADDRESS is not authorized on the NFT contract.");
  if (paused) report.warnings.push("NFT contract mint pause is active.");
  if (beforeSeaDropMinted + quantity > seaDropCap) report.warnings.push("Mint would exceed D.Y.O.O.R SeaDrop allocation cap.");
  if (!signer) report.warnings.push("No TEST_MINTER_PRIVATE_KEY/PRIVATE_KEY supplied; transaction was prepared only.");

  if (signer) {
    try {
      const simulation = await provider.call({
        from: minter,
        to: seaDropAddress,
        data,
        value: mintValueWei,
      });
      report.simulation = { ok: true, result: simulation };
    } catch (error) {
      report.simulation = { ok: false, error: error.shortMessage || error.message };
    }
  }

  if (execute) {
    if (!signer) throw new Error("EXECUTE_TEST_MINT=1 requires TEST_MINTER_PRIVATE_KEY or PRIVATE_KEY.");
    if (env("TEST_MINT_CONFIRMATION") !== "MINT_ONE_DYOOR_TESTNET") {
      throw new Error("TEST_MINT_CONFIRMATION=MINT_ONE_DYOOR_TESTNET is required.");
    }
    const tx = await signer.sendTransaction({ to: seaDropAddress, data, value: mintValueWei });
    const receipt = await tx.wait(1);
    const afterSupply = await nft.totalSupply();
    const afterSeaDropMinted = await nft.totalSeaDropMinted();
    report.transaction = {
      hash: tx.hash,
      blockNumber: receipt?.blockNumber,
      status: receipt?.status,
      afterSupply,
      afterSeaDropMinted,
    };
    if (afterSupply > beforeSupply) {
      try {
        report.transaction.tokenURI = await nft.tokenURI(afterSupply);
      } catch {}
    }
  }

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, bigintJson, 2)}\n`);
  console.log(JSON.stringify(report, bigintJson, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
