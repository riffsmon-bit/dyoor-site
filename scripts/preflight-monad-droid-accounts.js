import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  ContractFactory,
  Interface,
  JsonRpcProvider,
  formatEther,
  getAddress,
  keccak256,
} from "ethers";
import { assertReadOnlyReleaseEnvironment } from "./lib/release-safety.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHAIN_ID = 143;
const RPC_URL = String(
  process.env.MONAD_DROID_RPC_URL
    || process.env.DYOOR_S2_RPC_URL
    || process.env.MONAD_RPC_URL
    || "https://rpc.monad.xyz",
).trim();
const COLLECTION = getAddress("0x349d8eb480c92cf75371fba5c6344a4d11b9103a");
const COLLECTION_RUNTIME_HASH =
  "0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd";
const ENERGY_BANK = getAddress("0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767");
const S1_COLLECTION = getAddress("0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f");
const ASCENSION = getAddress("0xf9611226c1CcCcCa37951938d6f358D3d5106549");
const NICK_FACTORY = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
const CANONICAL_REGISTRY = getAddress("0x000000006551c19487814612e58FE06813775758");
const CANONICAL_RUNTIME_HASH =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
const WMON = getAddress("0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A");
const USDC = getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603");
// Verified Robinhood V1 reference, normalized by removing Solidity CBOR metadata and
// constructor-patched immutable slots. These hashes prove Monad reuses the same logic.
const ROBINHOOD_V1_CREATION_EXECUTABLE_HASH =
  "0x4c38f02a77dd8118223132168113d668fe237d8e49c7637e5d39d8aec6687740";
const ROBINHOOD_V1_RUNTIME_TEMPLATE_HASH =
  "0x8a2bfc57a2bbb21d855650c13e70bfdb3e14cc2fb528f8578a070ae5d8b669fe";
const ZERO_SALT = `0x${"00".repeat(32)}`;
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

// Exact standard transaction from EIP-6551. This script can estimate it but has no send path.
const CANONICAL_DEPLOYMENT_DATA =
  "0x0000000000000000000000000000000000000000fd8eb4e1dca713016c518e31608060405234801561001057600080fd5b5061023b806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063246a00211461003b5780638a54c52f1461006a575b600080fd5b61004e6100493660046101b7565b61007d565b6040516001600160a01b03909116815260200160405180910390f35b61004e6100783660046101b7565b6100e1565b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b60015284601552605560002060601b60601c60005260206000f35b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b600152846015526055600020803b61018b578560b760556000f580610157576320188a596000526004601cfd5b80606c52508284887f79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf887226060606ca46020606cf35b8060601b60601c60005260206000f35b80356001600160a01b03811681146101b257600080fd5b919050565b600080600080600060a086880312156101cf57600080fd5b6101d88661019b565b945060208601359350604086013592506101f46060870161019b565b94979396509194608001359291505056fea2646970667358221220ea2fe53af507453c64dd7c1db05549fa47a298dfb825d6d11e1689856135f16764736f6c63430008110033";

const artifactRoot = path.join(ROOT, "contracts", "hoodyoor", "out");
const implementationArtifactPath = path.join(
  artifactRoot,
  "DroidAccountV1.sol",
  "DroidAccountV1.json",
);
const registryArtifactPath = path.join(
  artifactRoot,
  "DroidAccountRegistry.sol",
  "DroidAccountRegistry.json",
);

function artifact(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label} artifact. Run npm run build:monad:droid-accounts.`);
  }
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const creation = String(value?.bytecode?.object || "");
  const runtime = String(value?.deployedBytecode?.object || "");
  if (!/^0x[0-9a-f]+$/i.test(creation) || !/^0x[0-9a-f]+$/i.test(runtime)) {
    throw new Error(`Invalid ${label} artifact bytecode.`);
  }
  return {
    abi: value.abi,
    creation,
    runtime,
    creationHash: keccak256(creation),
    runtimeHash: keccak256(runtime),
    creationBytes: (creation.length - 2) / 2,
    runtimeBytes: (runtime.length - 2) / 2,
    creationExecutableHash: keccak256(stripSolidityMetadata(creation)),
    runtimeTemplateHash: keccak256(stripSolidityMetadata(runtime)),
  };
}

function stripSolidityMetadata(bytecode) {
  const bytes = Buffer.from(bytecode.slice(2), "hex");
  if (bytes.length < 2) throw new Error("Artifact bytecode is too short.");
  const metadataLength = bytes.readUInt16BE(bytes.length - 2);
  if (metadataLength + 2 > bytes.length) {
    throw new Error("Artifact Solidity metadata suffix is malformed.");
  }
  return `0x${bytes.subarray(0, bytes.length - metadataLength - 2).toString("hex")}`;
}

function canonicalRuntime() {
  const initCode = CANONICAL_DEPLOYMENT_DATA.slice(66);
  const runtimeMarker = initCode.indexOf("f3fe");
  if (runtimeMarker < 0) throw new Error("Canonical ERC-6551 deployment data is malformed.");
  const runtime = `0x${initCode.slice(runtimeMarker + 4)}`;
  if (keccak256(runtime) !== CANONICAL_RUNTIME_HASH) {
    throw new Error("Canonical ERC-6551 deployment data does not match the reviewed runtime hash.");
  }
  return runtime;
}

async function timeout(promise, label, timeoutMs = 15_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function bigintString(value) {
  return BigInt(value).toString();
}

async function main() {
  assertReadOnlyReleaseEnvironment();
  if (
    process.env.EXECUTE_MONAD_DROID_DEPLOYMENT === "1"
    || process.env.ALLOW_MONAD_DROID_MAINNET === "1"
  ) {
    throw new Error("Refused: Monad Droid preflight is read-only and has no broadcast mode.");
  }
  if (/^(1|true|yes|on)$/i.test(String(process.env.CROSS_CHAIN_BRIDGE_ENABLED || ""))) {
    throw new Error("CROSS_CHAIN_BRIDGE_ENABLED must remain false.");
  }
  if (/^(1|true|yes|on)$/i.test(String(process.env.DROID_AGENT_ENABLED || ""))) {
    throw new Error("DROID_AGENT_ENABLED must remain false.");
  }

  const implementation = artifact(implementationArtifactPath, "DroidAccountV1");
  const registry = artifact(registryArtifactPath, "DroidAccountRegistry");
  if (
    implementation.creationExecutableHash !== ROBINHOOD_V1_CREATION_EXECUTABLE_HASH
    || implementation.runtimeTemplateHash !== ROBINHOOD_V1_RUNTIME_TEMPLATE_HASH
  ) {
    throw new Error("Local DroidAccountV1 executable differs from verified Robinhood V1.");
  }
  if (implementation.runtimeBytes > 24_576 || registry.runtimeBytes > 24_576) {
    throw new Error("Droid contract runtime exceeds EIP-170.");
  }

  const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, {
    staticNetwork: true,
    batchMaxCount: 50,
  });
  const network = await timeout(provider.getNetwork(), "Monad network read");
  if (Number(network.chainId) !== CHAIN_ID) {
    throw new Error(`Wrong chain: expected ${CHAIN_ID}, received ${network.chainId}.`);
  }

  const addresses = [
    COLLECTION,
    ENERGY_BANK,
    S1_COLLECTION,
    ASCENSION,
    NICK_FACTORY,
    CANONICAL_REGISTRY,
    WMON,
    USDC,
  ];
  const [latestBlock, feeData, codes, implementationStorage, beaconStorage] = await Promise.all([
    timeout(provider.getBlockNumber(), "latest block read"),
    timeout(provider.getFeeData(), "fee data read"),
    Promise.all(addresses.map((address) => timeout(provider.getCode(address), `${address} code`))),
    timeout(provider.getStorage(COLLECTION, IMPLEMENTATION_SLOT), "implementation slot"),
    timeout(provider.getStorage(COLLECTION, BEACON_SLOT), "beacon slot"),
  ]);
  const code = Object.fromEntries(addresses.map((address, index) => [address, codes[index]]));
  for (const address of [COLLECTION, ENERGY_BANK, S1_COLLECTION, ASCENSION, NICK_FACTORY, WMON, USDC]) {
    if (code[address] === "0x") throw new Error(`Required live contract ${address} has no code.`);
  }
  if (keccak256(code[COLLECTION]).toLowerCase() !== COLLECTION_RUNTIME_HASH) {
    throw new Error("Live D.Y.O.O.R runtime hash differs from the audited deployment.");
  }
  if (
    code[CANONICAL_REGISTRY] !== "0x"
    && keccak256(code[CANONICAL_REGISTRY]).toLowerCase() !== CANONICAL_RUNTIME_HASH
  ) {
    throw new Error("Canonical ERC-6551 address contains unexpected code.");
  }
  if (BigInt(implementationStorage) !== 0n || BigInt(beaconStorage) !== 0n) {
    throw new Error("Live D.Y.O.O.R unexpectedly reports EIP-1967 proxy storage.");
  }

  const collectionAbi = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function owner() view returns (address)",
    "function treasury() view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function totalMinted() view returns (uint256)",
    "function maxSupply() view returns (uint256)",
    "function MAX_SUPPLY() view returns (uint256)",
    "function metadataFrozen() view returns (bool)",
    "function ownerOf(uint256) view returns (address)",
    "function balanceOf(address) view returns (uint256)",
    "function tokenURI(uint256) view returns (string)",
    "function supportsInterface(bytes4) view returns (bool)",
    "function approve(address,uint256)",
    "function transferFrom(address,address,uint256)",
    "function safeTransferFrom(address,address,uint256)",
    "function burn(uint256)",
  ];
  const collection = new Contract(COLLECTION, collectionAbi, provider);
  const erc721 = new Contract(S1_COLLECTION, ["function balanceOf(address) view returns (uint256)"], provider);
  const energy = new Contract(ENERGY_BANK, ["function energyBalance(address) view returns (uint256)"], provider);
  const erc20Abi = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ];
  const wmon = new Contract(WMON, erc20Abi, provider);
  const usdc = new Contract(USDC, erc20Abi, provider);
  const owner = await timeout(collection.owner(), "collection owner read");
  const [
    name,
    symbol,
    treasury,
    totalSupply,
    totalMinted,
    maxSupply,
    constantMaxSupply,
    metadataFrozen,
    tokenOneOwner,
    tokenOneUri,
    erc721Supported,
    metadataSupported,
    s2AscensionBalance,
    s1AscensionBalance,
    ownerEnergy,
    wmonMetadata,
    usdcMetadata,
  ] = await Promise.all([
    collection.name(),
    collection.symbol(),
    collection.treasury(),
    collection.totalSupply(),
    collection.totalMinted(),
    collection.maxSupply(),
    collection.MAX_SUPPLY(),
    collection.metadataFrozen(),
    collection.ownerOf(1),
    collection.tokenURI(1),
    collection.supportsInterface("0x80ac58cd"),
    collection.supportsInterface("0x5b5e139f"),
    collection.balanceOf(ASCENSION),
    erc721.balanceOf(ASCENSION),
    energy.energyBalance(owner),
    Promise.all([wmon.name(), wmon.symbol(), wmon.decimals()]),
    Promise.all([usdc.name(), usdc.symbol(), usdc.decimals()]),
  ]);
  if (
    name !== "D.Y.O.O.R"
    || symbol !== "DYOOR"
    || !erc721Supported
    || !metadataSupported
    || maxSupply !== 3_333n
    || constantMaxSupply !== 3_333n
    || totalMinted < totalSupply
  ) {
    throw new Error("Live D.Y.O.O.R ERC-721 or supply invariants changed.");
  }
  if (s2AscensionBalance !== 0n || s1AscensionBalance === 0n) {
    throw new Error("Ascension collection-custody boundary changed; resolver review required.");
  }

  const collectionInterface = new Interface(collectionAbi);
  const simulatedCalls = [
    ["approve", [getAddress("0x000000000000000000000000000000000000dEaD"), 1]],
    ["transferFrom", [tokenOneOwner, tokenOneOwner, 1]],
    ["safeTransferFrom", [tokenOneOwner, tokenOneOwner, 1]],
    ["burn", [1]],
  ];
  for (const [functionName, args] of simulatedCalls) {
    await timeout(provider.call({
      from: tokenOneOwner,
      to: COLLECTION,
      data: collectionInterface.encodeFunctionData(functionName, args),
    }), `${functionName} simulation`);
  }

  const canonicalPresent = code[CANONICAL_REGISTRY] !== "0x";
  const canonicalGas = canonicalPresent
    ? 0n
    : await timeout(provider.estimateGas({
        from: owner,
        to: NICK_FACTORY,
        data: CANONICAL_DEPLOYMENT_DATA,
        value: 0,
      }), "canonical registry gas estimate");
  const implementationGas = await timeout(provider.estimateGas({
    from: owner,
    data: implementation.creation,
  }), "implementation gas estimate");

  const factory = new ContractFactory(registry.abi, registry.creation);
  const registryRequest = await factory.getDeployTransaction(
    CANONICAL_REGISTRY,
    COLLECTION,
    getAddress("0x0000000000000000000000000000000000000001"),
    CHAIN_ID,
    ZERO_SALT,
  );
  // Replace the placeholder implementation word with a deterministic valid-length address only
  // for gas estimation. Constructor behavior depends on code existence, so the implementation
  // state override uses the reviewed V1 runtime as well.
  const placeholderImplementation = getAddress("0x0000000000000000000000000000000000000001");
  let registryGas = null;
  let registryGasSource = "unavailable";
  try {
    const raw = await timeout(provider.send("eth_estimateGas", [{
      from: owner,
      data: registryRequest.data,
    }, "latest", {
      [CANONICAL_REGISTRY]: { code: canonicalRuntime() },
      [placeholderImplementation]: { code: implementation.runtime },
    }]), "registry gas estimate with state override");
    registryGas = BigInt(raw);
    registryGasSource = "Monad eth_estimateGas with reviewed runtime state overrides";
  } catch {
    // Same compiler output measured during the Robinhood deployment; retained as a clearly
    // identified fallback rather than presenting it as a Monad simulation.
    registryGas = 530_373n;
    registryGasSource = "Robinhood same-bytecode benchmark; refresh after canonical deployment";
  }

  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
  if (!gasPrice) throw new Error("Monad RPC did not return a usable gas price.");
  const totalGas = canonicalGas + implementationGas + registryGas;
  const estimatedWei = totalGas * gasPrice;
  const bufferedWei = estimatedWei * 3n;

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "read-only-mainnet-preflight",
    broadcastCapability: false,
    broadcastAttempted: false,
    privateKeyRead: false,
    chainId: CHAIN_ID,
    latestBlock,
    collection: {
      address: COLLECTION,
      runtimeCodeHash: keccak256(code[COLLECTION]),
      proxy: false,
      name,
      symbol,
      owner: getAddress(owner),
      treasury: getAddress(treasury),
      totalSupply: Number(totalSupply),
      totalMinted: Number(totalMinted),
      burned: Number(totalMinted - totalSupply),
      maxSupply: Number(maxSupply),
      metadataFrozen,
      sampleToken: {
        tokenId: 1,
        owner: getAddress(tokenOneOwner),
        tokenUri: tokenOneUri,
      },
      holderCallSimulations: simulatedCalls.map(([functionName]) => functionName),
    },
    controllerResolution: {
      policy: "DIRECT_ERC721_OWNER",
      season2BalanceAtAscension: Number(s2AscensionBalance),
      season1BalanceAtAscension: Number(s1AscensionBalance),
      conclusion: "Ascension custody is Season 1 only; do not apply its tokenId records to Season 2.",
    },
    energy: {
      address: ENERGY_BANK,
      ownerSampleRawBalance: bigintString(ownerEnergy),
      decimals: 18,
      treatment: "non-transferable progression utility; no price assigned",
    },
    approvedAssetCandidates: [
      { address: WMON, name: wmonMetadata[0], symbol: wmonMetadata[1], decimals: Number(wmonMetadata[2]) },
      { address: USDC, name: usdcMetadata[0], symbol: usdcMetadata[1], decimals: Number(usdcMetadata[2]) },
    ],
    canonicalRegistry: {
      address: CANONICAL_REGISTRY,
      present: canonicalPresent,
      runtimeCodeHash: canonicalPresent ? keccak256(code[CANONICAL_REGISTRY]) : null,
      deploymentFactory: NICK_FACTORY,
      reviewedDeploymentDataHash: keccak256(CANONICAL_DEPLOYMENT_DATA),
      expectedRuntimeCodeHash: CANONICAL_RUNTIME_HASH,
    },
    artifacts: {
      implementation: {
        creationHash: implementation.creationHash,
        runtimeHash: implementation.runtimeHash,
        creationBytes: implementation.creationBytes,
        runtimeBytes: implementation.runtimeBytes,
        creationExecutableHash: implementation.creationExecutableHash,
        runtimeTemplateHash: implementation.runtimeTemplateHash,
        verifiedRobinhoodV1LogicMatch: true,
      },
      facade: {
        creationHash: registry.creationHash,
        runtimeHash: registry.runtimeHash,
        creationBytes: registry.creationBytes,
        runtimeBytes: registry.runtimeBytes,
      },
    },
    gas: {
      canonicalRegistry: canonicalGas.toString(),
      implementation: implementationGas.toString(),
      facade: registryGas.toString(),
      facadeEstimateSource: registryGasSource,
      total: totalGas.toString(),
      gasPriceWei: gasPrice.toString(),
      estimatedDeploymentMon: formatEther(estimatedWei),
      recommendedThreeTimesBufferMon: formatEther(bufferedWei),
    },
    deploymentSequence: [
      ...(canonicalPresent ? [] : ["Deploy exact canonical ERC-6551 registry transaction through Nick's Factory"]),
      "Verify canonical registry runtime hash",
      "Deploy immutable DroidAccountV1",
      "Deploy immutable DroidAccountRegistry(ERC6551Registry, D.Y.O.O.R, implementation, 143, zero salt)",
      "Verify both contracts and immutable wiring",
      "Run token #1 counterfactual/read simulations",
      "Configure addresses while Monad feature flags remain false",
      "Run website smoke tests and an owner activation canary",
      "Enable both Monad Droid feature gates only after explicit approval",
    ],
    existingContractsUntouched: [COLLECTION, ENERGY_BANK, S1_COLLECTION, ASCENSION],
    blockersBeforeDeployment: [
      ...(canonicalPresent ? [] : ["canonical ERC-6551 registry is not deployed"]),
      "independent security review remains outstanding",
      "production deployment approval has not been given",
    ],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
