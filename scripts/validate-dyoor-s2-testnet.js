#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ethers } from "ethers";

const MONAD_TESTNET_CHAIN_ID = 10143;
const MONAD_MAINNET_CHAIN_ID = 143;

const ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function AIRDROP_RESERVE() view returns (uint256)",
  "function SEADROP_MAX_SUPPLY() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function totalSeaDropMinted() view returns (uint256)",
  "function totalAirdropped() view returns (uint256)",
  "function remainingSeaDropSupply() view returns (uint256)",
  "function remainingAirdropReserve() view returns (uint256)",
  "function treasury() view returns (address)",
  "function royaltyAddress() view returns (address)",
  "function royaltyBasisPoints() view returns (uint256)",
  "function baseURI() view returns (string)",
  "function contractURI() view returns (string)",
  "function paused() view returns (bool)",
  "function airdropPaused() view returns (bool)",
  "function allowedSeaDrops() view returns (address[])",
  "function getMintStats(address minter) view returns (uint256 minterNumMinted,uint256 currentTotalSupply,uint256 maxSupply)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function emitMetadataUpdate(uint256 tokenId)",
  "function pause()",
  "function unpause()",
  "function airdropBatch(bytes32 batchId,uint256 batchIndex,address[] recipients,uint256[] quantities)",
  "function airdropBatchExecuted(bytes32 batchId) view returns (bool)",
  "function mintSeaDrop(address minter,uint256 quantity)",
  "function withdrawTreasury()",
];

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function expectStaticRevert(label, fn) {
  try {
    await fn();
    return { label, ok: false, error: "call unexpectedly succeeded" };
  } catch (error) {
    return { label, ok: true, error: error.shortMessage || error.message };
  }
}

async function main() {
  const rpcUrl = env("MONAD_TESTNET_RPC_URL", env("DYOOR_S2_RPC_URL", env("NEXT_PUBLIC_DYOOR_S2_RPC_URL", "")));
  const contractAddress = env("DYOOR_S2_CONTRACT_ADDRESS", env("NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS", ""));
  if (!rpcUrl) throw new Error("MONAD_TESTNET_RPC_URL or DYOOR_S2_RPC_URL is required.");
  if (!contractAddress) throw new Error("DYOOR_S2_CONTRACT_ADDRESS is required.");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) === MONAD_MAINNET_CHAIN_ID) {
    throw new Error("Refusing to run validation against Monad mainnet.");
  }
  if (Number(network.chainId) !== MONAD_TESTNET_CHAIN_ID) {
    throw new Error(`Expected Monad testnet chain ID ${MONAD_TESTNET_CHAIN_ID}; got ${network.chainId}.`);
  }

  const execute = env("EXECUTE_TESTNET_VALIDATION") === "1";
  const signerKey = env("DEPLOYER_PRIVATE_KEY") || env("PRIVATE_KEY");
  const signer = signerKey ? new ethers.Wallet(signerKey, provider) : null;
  const contract = new ethers.Contract(contractAddress, ABI, signer || provider);

  const [
    name,
    symbol,
    owner,
    pendingOwner,
    maxSupplyConstant,
    airdropReserve,
    seaDropMaxSupply,
    maxSupply,
    totalSupply,
    totalMinted,
    totalSeaDropMinted,
    totalAirdropped,
    remainingSeaDropSupply,
    remainingAirdropReserve,
    treasury,
    royaltyReceiver,
    royaltyBps,
    baseURI,
    contractURI,
    paused,
    airdropPaused,
    allowedSeaDrops,
  ] = await Promise.all([
    contract.name(),
    contract.symbol(),
    contract.owner(),
    contract.pendingOwner(),
    contract.MAX_SUPPLY(),
    contract.AIRDROP_RESERVE(),
    contract.SEADROP_MAX_SUPPLY(),
    contract.maxSupply(),
    contract.totalSupply(),
    contract.totalMinted(),
    contract.totalSeaDropMinted(),
    contract.totalAirdropped(),
    contract.remainingSeaDropSupply(),
    contract.remainingAirdropReserve(),
    contract.treasury(),
    contract.royaltyAddress(),
    contract.royaltyBasisPoints(),
    contract.baseURI(),
    contract.contractURI(),
    contract.paused(),
    contract.airdropPaused(),
    contract.allowedSeaDrops(),
  ]);

  const seaDropCode = {};
  for (const seaDrop of allowedSeaDrops) {
    seaDropCode[seaDrop] = await provider.getCode(seaDrop);
  }

  const mintStats = await contract.getMintStats(owner);
  const checks = [];
  checks.push({ label: "chain is Monad testnet", ok: Number(network.chainId) === MONAD_TESTNET_CHAIN_ID });
  checks.push({ label: "name is D.Y.O.O.R", ok: name === "D.Y.O.O.R", value: name });
  checks.push({ label: "symbol is DYOOR", ok: symbol === "DYOOR", value: symbol });
  checks.push({ label: "max supply constant is 3333", ok: maxSupplyConstant === 3333n, value: maxSupplyConstant });
  checks.push({ label: "maxSupply() is 3333", ok: maxSupply === 3333n, value: maxSupply });
  checks.push({ label: "airdrop reserve is 610", ok: airdropReserve === 610n, value: airdropReserve });
  checks.push({ label: "SeaDrop cap is 2723", ok: seaDropMaxSupply === 2723n, value: seaDropMaxSupply });
  checks.push({ label: "total minted <= max supply", ok: totalMinted <= maxSupply, value: totalMinted });
  checks.push({ label: "SeaDrop minted <= SeaDrop cap", ok: totalSeaDropMinted <= seaDropMaxSupply, value: totalSeaDropMinted });
  checks.push({ label: "airdrop minted <= reserve", ok: totalAirdropped <= airdropReserve, value: totalAirdropped });
  checks.push({ label: "treasury configured", ok: treasury !== ethers.ZeroAddress, value: treasury });
  checks.push({ label: "royalty receiver configured", ok: royaltyReceiver !== ethers.ZeroAddress, value: royaltyReceiver });
  checks.push({ label: "royalty bps <= 10000", ok: royaltyBps <= 10000n, value: royaltyBps });
  checks.push({ label: "base URI has no localhost", ok: !/localhost|127\.0\.0\.1/i.test(baseURI), value: baseURI });
  checks.push({ label: "contract URI has no localhost", ok: !/localhost|127\.0\.0\.1/i.test(contractURI), value: contractURI });
  checks.push({ label: "at least one SeaDrop address authorized", ok: allowedSeaDrops.length > 0, value: allowedSeaDrops });
  checks.push({
    label: "authorized SeaDrop addresses have bytecode",
    ok: allowedSeaDrops.every((address) => seaDropCode[address] && seaDropCode[address] !== "0x"),
    value: allowedSeaDrops,
  });
  checks.push({
    label: "getMintStats max supply remains collection max",
    ok: mintStats.maxSupply === maxSupply,
    value: mintStats.maxSupply,
  });

  if (totalSupply > 0n) {
    for (const tokenId of [1n, totalSupply > 1n ? 2n : 1n, totalSupply]) {
      const uri = await contract.tokenURI(tokenId);
      checks.push({ label: `tokenURI(${tokenId})`, ok: Boolean(uri), value: uri });
    }
  } else {
    checks.push({ label: "tokenURI tests", ok: true, skipped: true, value: "No tokens minted yet." });
  }

  const staticTests = [];
  staticTests.push(await expectStaticRevert("unauthorized pause", async () => {
    const data = contract.interface.encodeFunctionData("pause", []);
    await provider.call({ to: contractAddress, from: ethers.Wallet.createRandom().address, data });
  }));
  staticTests.push(await expectStaticRevert("unauthorized SeaDrop mint", async () => {
    const data = contract.interface.encodeFunctionData("mintSeaDrop", [ethers.Wallet.createRandom().address, 1]);
    await provider.call({ to: contractAddress, from: ethers.Wallet.createRandom().address, data });
  }));
  for (const signature of [
    "publicMint(uint256)",
    "teamMint(uint256,bytes32[])",
    "ascensionMint(uint256,bytes32[])",
    "gtdMint(uint256,bytes32[])",
    "mintDirect(uint256,bytes32[])",
    "updateMerkleRoots(bytes32,bytes32,bytes32,bytes32)",
    "setPhaseStartTimes(uint64,uint64,uint64,uint64,uint64)",
  ]) {
    staticTests.push(await expectStaticRevert(`${signature} is absent`, async () => {
      const selector = ethers.id(signature).slice(0, 10);
      await provider.call({ to: contractAddress, from: owner, data: selector });
    }));
  }

  const txResults = [];
  if (!execute) {
    txResults.push({ label: "transactional tests", skipped: true, reason: "Set EXECUTE_TESTNET_VALIDATION=1 to send testnet transactions." });
  } else if (!signer) {
    txResults.push({ label: "transactional tests", skipped: true, reason: "DEPLOYER_PRIVATE_KEY or PRIVATE_KEY is required." });
  } else {
    const signerAddress = await signer.getAddress();
    txResults.push({ label: "signer", value: signerAddress });
    txResults.push({ label: "owner signer", ok: signerAddress.toLowerCase() === owner.toLowerCase() });

    const testWallet = env("DYOOR_S2_TEST_RECIPIENT", signerAddress);
    const maybeSend = async (label, txFactory) => {
      try {
        const tx = await txFactory();
        const receipt = await tx.wait(1);
        txResults.push({ label, ok: true, txHash: tx.hash, blockNumber: receipt?.blockNumber });
      } catch (error) {
        txResults.push({ label, ok: false, error: error.shortMessage || error.message });
      }
    };

    if (env("RUN_TEST_AIRDROP") === "1") {
      await maybeSend("airdrop test", () => contract.airdropBatch(
        ethers.id(`validation-airdrop-${Date.now()}`),
        0,
        [testWallet],
        [1],
      ));
    }
    if (env("RUN_TEST_METADATA_EVENT") === "1" && totalSupply > 0n) {
      await maybeSend("ERC-4906 MetadataUpdate test", () => contract.emitMetadataUpdate(1));
    }
    if (env("RUN_TEST_PAUSE") === "1") {
      await maybeSend("pause", () => contract.pause());
      await maybeSend("unpause", () => contract.unpause());
    }
    if (env("RUN_TEST_WITHDRAWAL") === "1") {
      await maybeSend("treasury withdrawal test", () => contract.withdrawTreasury());
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    chainId: Number(network.chainId),
    contractAddress,
    name,
    symbol,
    owner,
    pendingOwner,
    maxSupplyConstant,
    airdropReserve,
    seaDropMaxSupply,
    maxSupply,
    totalSupply,
    totalMinted,
    totalSeaDropMinted,
    totalAirdropped,
    remainingSeaDropSupply,
    remainingAirdropReserve,
    treasury,
    royaltyReceiver,
    royaltyBps,
    baseURI,
    contractURI,
    paused,
    airdropPaused,
    allowedSeaDrops,
    seaDropCode,
    mintStats,
    removedRoutes: [
      "mintDirect",
      "teamMint",
      "ascensionMint",
      "gtdMint",
      "publicMint",
      "setPhaseStartTimes",
      "updateMerkleRoots",
    ],
    whitelistMinting: "OpenSea/SeaDrop-managed; no DYOOR custom whitelistMint function.",
    checks,
    staticTests,
    txResults,
  };

  const reportPath = env("TESTNET_VALIDATION_REPORT", `deployments/dyoor-s2-testnet-validation-${Date.now()}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, bigintJson, 2)}\n`);
  console.log(JSON.stringify(report, bigintJson, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
