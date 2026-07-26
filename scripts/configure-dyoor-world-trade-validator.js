import "dotenv/config";
import { network } from "hardhat";

const MONAD_CHAIN_ID = 143n;
const DYOOR_S2_MAINNET = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const DYOOR_WORLD_TRADE_ESCROW = "0xdea68BF8acFd96F174f93Bd936A5dc3d2f010601";
const EXPECTED_SECURITY_LEVEL = 3;

const S2_ABI = [
  "function owner() view returns (address)",
  "function getTransferValidator() view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getApproved(uint256 tokenId) view returns (address)",
];

const VALIDATOR_ABI = [
  "function getCollectionSecurityPolicy(address collection) view returns (tuple(uint8 transferSecurityLevel,uint120 operatorWhitelistId,uint120 permittedContractReceiversId))",
  "function lastListId() view returns (uint120)",
  "function listOwners(uint120 id) view returns (address)",
  "function createListCopy(string name,uint120 sourceListId) returns (uint120 id)",
  "function addAccountsToWhitelist(uint120 id,address[] accounts)",
  "function applyListToCollection(address collection,uint120 id)",
  "function getWhitelistedAccounts(uint120 id) view returns (address[])",
  "function getWhitelistedCodeHashes(uint120 id) view returns (bytes32[])",
  "function isAccountWhitelisted(uint120 id,address account) view returns (bool)",
];

const ESCROW_ABI = [
  "function S2_COLLECTION() view returns (address)",
  "function nextTradeId() view returns (uint256)",
  "function createTrade(address taker,uint256 offeredTokenId,uint256 requestedTokenId,uint256 monRequested,uint64 expiresAt) payable returns (uint256)",
];

const execute = process.env.EXECUTE_DYOOR_WORLD_TRADE_VALIDATOR === "1";
const probeTokenId = BigInt(process.env.DYOOR_WORLD_TRADE_PROBE_TOKEN_ID || "132");
const probeRequestedTokenId = BigInt(
  process.env.DYOOR_WORLD_TRADE_PROBE_REQUESTED_TOKEN_ID || "133",
);

const { ethers } = await network.create();
const [deployer] = await ethers.getSigners();
if (!deployer) {
  throw new Error("No deployer signer found. Set DEPLOYER_PRIVATE_KEY first.");
}

const chain = await ethers.provider.getNetwork();
if (chain.chainId !== MONAD_CHAIN_ID) {
  throw new Error(`Wrong network. Expected Monad chain id 143, got ${chain.chainId}.`);
}

const collection = ethers.getAddress(DYOOR_S2_MAINNET);
const escrowAddress = ethers.getAddress(
  process.env.DYOOR_WORLD_TRADE_ESCROW_ADDRESS || DYOOR_WORLD_TRADE_ESCROW,
);
if (escrowAddress !== ethers.getAddress(DYOOR_WORLD_TRADE_ESCROW)) {
  throw new Error(`Refusing to whitelist an unverified escrow: ${escrowAddress}`);
}

const s2 = new ethers.Contract(collection, S2_ABI, deployer);
const collectionOwner = ethers.getAddress(await s2.owner());
if (collectionOwner !== ethers.getAddress(deployer.address)) {
  throw new Error(
    `Deployer ${deployer.address} is not the Season 2 owner ${collectionOwner}.`,
  );
}

const validatorAddress = ethers.getAddress(await s2.getTransferValidator());
if (validatorAddress === ethers.ZeroAddress) {
  throw new Error("Season 2 does not currently have a transfer validator.");
}

const validator = new ethers.Contract(validatorAddress, VALIDATOR_ABI, deployer);
const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, deployer);
if (ethers.getAddress(await escrow.S2_COLLECTION()) !== collection) {
  throw new Error("The configured escrow is not bound to the production S2 collection.");
}

const currentPolicy = await validator.getCollectionSecurityPolicy(collection);
const securityLevel = Number(currentPolicy.transferSecurityLevel);
const currentListId = currentPolicy.operatorWhitelistId;
if (securityLevel !== EXPECTED_SECURITY_LEVEL) {
  throw new Error(
    `Unexpected Season 2 transfer security level ${securityLevel}; expected ${EXPECTED_SECURITY_LEVEL}.`,
  );
}

const alreadyAllowed = await validator.isAccountWhitelisted(
  currentListId,
  escrowAddress,
);

console.log("D.Y.O.O.R World trade validator integration");
console.log("Mode:", execute ? "BROADCAST" : "DRY RUN");
console.log("Collection owner:", collectionOwner);
console.log("Transfer validator:", validatorAddress);
console.log("Security level:", securityLevel);
console.log("Active list:", String(currentListId));
console.log("Escrow:", escrowAddress);

if (!alreadyAllowed) {
  const sourceAccounts = await validator.getWhitelistedAccounts(currentListId);
  const sourceCodeHashes = await validator.getWhitelistedCodeHashes(currentListId);
  const normalizedSourceAccounts = sourceAccounts.map((account) =>
    ethers.getAddress(account));
  const normalizedSourceCodeHashes = sourceCodeHashes.map((codeHash) =>
    codeHash.toLowerCase());
  const lastListId = await validator.lastListId();
  let targetListId = currentListId;

  for (let candidate = lastListId; candidate > currentListId; candidate -= 1n) {
    if (ethers.getAddress(await validator.listOwners(candidate)) !== collectionOwner) {
      continue;
    }
    const candidateAccounts = (await validator.getWhitelistedAccounts(candidate))
      .map((account) => ethers.getAddress(account));
    const candidateCodeHashes = (await validator.getWhitelistedCodeHashes(candidate))
      .map((codeHash) => codeHash.toLowerCase());
    if (
      normalizedSourceAccounts.every((account) => candidateAccounts.includes(account))
        && normalizedSourceCodeHashes.every((codeHash) =>
          candidateCodeHashes.includes(codeHash))
    ) {
      targetListId = candidate;
      break;
    }
  }

  console.log("Copied account entries:", sourceAccounts.length);
  console.log("Copied code-hash entries:", sourceCodeHashes.length);

  if (targetListId === currentListId) {
    const nextListId = await validator.createListCopy.staticCall(
      "DYOOR World + OpenSea",
      currentListId,
    );
    const createGas = await validator.createListCopy.estimateGas(
      "DYOOR World + OpenSea",
      currentListId,
    );
    console.log("New list ID:", String(nextListId));
    console.log("Estimated create-list gas:", String(createGas));

    if (!execute) {
      console.log(
        "Dry run complete. Set EXECUTE_DYOOR_WORLD_TRADE_VALIDATOR=1 to create, extend, and apply the copied list.",
      );
      process.exit(0);
    }

    const createReceipt = await (
      await validator.createListCopy("DYOOR World + OpenSea", currentListId)
    ).wait();
    targetListId = nextListId;
    console.log("Create-list tx:", createReceipt.hash);
  } else {
    console.log("Reusing prepared owner list:", String(targetListId));
    if (!execute) {
      console.log(
        "Dry run complete. Set EXECUTE_DYOOR_WORLD_TRADE_VALIDATOR=1 to finish and apply the prepared list.",
      );
      process.exit(0);
    }
  }

  if (ethers.getAddress(await validator.listOwners(targetListId)) !== collectionOwner) {
    throw new Error("The copied validator list is not owned by the Season 2 owner.");
  }

  const copiedAccounts = await validator.getWhitelistedAccounts(targetListId);
  const copiedCodeHashes = await validator.getWhitelistedCodeHashes(targetListId);
  if (
    normalizedSourceAccounts.some((account) =>
      !copiedAccounts.map((item) => ethers.getAddress(item)).includes(account))
      || normalizedSourceCodeHashes.some((codeHash) =>
        !copiedCodeHashes.map((item) => item.toLowerCase()).includes(codeHash))
  ) {
    throw new Error("The copied list does not preserve the active OpenSea entries.");
  }

  if (!await validator.isAccountWhitelisted(targetListId, escrowAddress)) {
    const addReceipt = await (
      await validator.addAccountsToWhitelist(targetListId, [escrowAddress])
    ).wait();
    console.log("Whitelist-escrow tx:", addReceipt.hash);
  } else {
    console.log("Prepared list already contains the escrow.");
  }

  if (targetListId !== currentListId) {
    const applyReceipt = await (
      await validator.applyListToCollection(collection, targetListId)
    ).wait();
    console.log("Apply-list tx:", applyReceipt.hash);
  }
}

const finalPolicy = await validator.getCollectionSecurityPolicy(collection);
const finalListId = finalPolicy.operatorWhitelistId;
if (Number(finalPolicy.transferSecurityLevel) !== EXPECTED_SECURITY_LEVEL) {
  throw new Error("Season 2 transfer security changed unexpectedly.");
}
if (!await validator.isAccountWhitelisted(finalListId, escrowAddress)) {
  throw new Error("The trade escrow is not present on the active Season 2 list.");
}

console.log("Verified active list:", String(finalListId));
console.log("Verified security level:", Number(finalPolicy.transferSecurityLevel));
console.log("Verified escrow allowlisted: yes");

const probeOwner = ethers.getAddress(await s2.ownerOf(probeTokenId));
const probeApproval = ethers.getAddress(await s2.getApproved(probeTokenId));
if (probeApproval === escrowAddress) {
  const block = await ethers.provider.getBlock("latest");
  const probeEscrow = escrow.connect(
    new ethers.VoidSigner(probeOwner, ethers.provider),
  );
  const simulatedTradeId = await probeEscrow.createTrade.staticCall(
    ethers.ZeroAddress,
    probeTokenId,
    probeRequestedTokenId,
    0,
    BigInt(block.timestamp + 86_400),
  );
  console.log(
    `Production escrow simulation passed for Droid #${probeTokenId} as trade #${simulatedTradeId}.`,
  );
} else {
  console.log(
    `Escrow policy is live. Production probe skipped because Droid #${probeTokenId} is no longer approved to this escrow.`,
  );
}
