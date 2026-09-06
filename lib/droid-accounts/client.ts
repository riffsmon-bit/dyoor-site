import {
  BrowserProvider,
  Contract,
  Interface,
  getAddress,
  isAddress,
  parseEther,
  parseUnits,
} from "ethers";
import {
  DROID_ACCOUNT_ABI,
  DROID_COLLECTION_ABI,
  DROID_ERC20_ABI,
  DROID_ERC721_ABI,
  DROID_REGISTRY_ABI,
} from "@/lib/droid-accounts/abis";
import { droidActivationAllowed } from "@/lib/droid-accounts/activation";
import type { DroidProtocolConfig } from "@/lib/droid-accounts/types";
import {
  isSupportedDroidChainId,
  switchProviderToDroidChain,
  type DroidEip1193Provider,
} from "@/lib/droid-accounts/network";

function requireConfigured(config: DroidProtocolConfig) {
  if (
    !config.configured || !config.registryAddress || !config.collectionAddress
    || !config.implementationAddress
  ) {
    throw new Error(config.setupIssue || "Droid Account contracts are not configured.");
  }
  if (!isSupportedDroidChainId(config.chainId)) {
    throw new Error("Unsupported native Droid chain configuration.");
  }
}

function requireAddress(value: string, label: string) {
  if (!isAddress(value)) throw new Error(`Enter a valid ${label} address.`);
  return getAddress(value);
}

function sameAddress(left: string, right: string) {
  return getAddress(left) === getAddress(right);
}

async function signerFor(
  provider: DroidEip1193Provider,
  config: DroidProtocolConfig,
) {
  requireConfigured(config);
  await switchProviderToDroidChain(provider, config.chainId);
  const browserProvider = new BrowserProvider(provider);
  const signer = await browserProvider.getSigner();
  return { browserProvider, signer };
}

async function verifyCurrentOwner(
  provider: BrowserProvider,
  config: DroidProtocolConfig,
  tokenId: number,
  signerAddress: string,
) {
  const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, provider);
  const currentOwner = await collection.ownerOf(tokenId) as string;
  if (!sameAddress(currentOwner, signerAddress)) {
    throw new Error("The connected wallet is no longer the current owner of this Droid.");
  }
}

export async function activateDroidAccount({
  provider,
  config,
  tokenId,
  expectedAccount,
}: {
  provider: DroidEip1193Provider;
  config: DroidProtocolConfig;
  tokenId: number;
  expectedAccount: string;
}) {
  if (!droidActivationAllowed(config, tokenId)) {
    throw new Error(`${config.chainName} Droid activation is staged but not enabled.`);
  }
  const { browserProvider, signer } = await signerFor(provider, config);
  const signerAddress = await signer.getAddress();
  await verifyCurrentOwner(browserProvider, config, tokenId, signerAddress);
  const registry = new Contract(config.registryAddress, DROID_REGISTRY_ABI, signer);
  const accountAddress = await registry.account(tokenId) as string;
  if (!expectedAccount || !sameAddress(accountAddress, expectedAccount)) {
    throw new Error("The wallet-derived Droid Account does not match the verified address.");
  }
  if (await browserProvider.getCode(accountAddress) !== "0x") {
    return { transactionHash: "", accountAddress: getAddress(accountAddress), alreadyActive: true };
  }
  await registry.createAccount.estimateGas(tokenId);
  const transaction = await registry.createAccount(tokenId);
  await transaction.wait();
  if (await browserProvider.getCode(accountAddress) === "0x") {
    throw new Error("Activation confirmed without deploying Droid Account code.");
  }
  return {
    transactionHash: transaction.hash as string,
    accountAddress: getAddress(accountAddress),
    alreadyActive: false,
  };
}

export async function fundDroidWithEth({
  provider,
  config,
  accountAddress,
  amount,
}: {
  provider: DroidEip1193Provider;
  config: DroidProtocolConfig;
  accountAddress: string;
  amount: string;
}) {
  const destination = requireAddress(accountAddress, "Droid Account");
  const value = parseEther(amount);
  if (value <= 0n) {
    throw new Error(`Enter a ${config.nativeCurrencySymbol} amount greater than zero.`);
  }
  const { browserProvider, signer } = await signerFor(provider, config);
  if (await browserProvider.getCode(destination) === "0x") {
    throw new Error("Activate this Droid Account before funding it.");
  }
  const transaction = await signer.sendTransaction({ to: destination, value });
  await transaction.wait();
  return transaction.hash as string;
}

export async function fundDroidWithToken({
  provider,
  config,
  accountAddress,
  tokenAddress,
  decimals,
  amount,
}: {
  provider: DroidEip1193Provider;
  config: DroidProtocolConfig;
  accountAddress: string;
  tokenAddress: string;
  decimals: number;
  amount: string;
}) {
  const destination = requireAddress(accountAddress, "Droid Account");
  const token = requireAddress(tokenAddress, "token contract");
  const configured = config.tokens.some((entry) => sameAddress(entry.address, token));
  if (!configured) throw new Error("That token is not in the configured Droid asset list.");
  const value = parseUnits(amount, decimals);
  if (value <= 0n) throw new Error("Enter a token amount greater than zero.");
  const { browserProvider, signer } = await signerFor(provider, config);
  if (await browserProvider.getCode(destination) === "0x") {
    throw new Error("Activate this Droid Account before funding it.");
  }
  const contract = new Contract(token, DROID_ERC20_ABI, signer);
  await contract.transfer.estimateGas(destination, value);
  const transaction = await contract.transfer(destination, value);
  await transaction.wait();
  return transaction.hash as string;
}

async function ownerAccount({
  provider,
  config,
  accountAddress,
  tokenId,
}: {
  provider: DroidEip1193Provider;
  config: DroidProtocolConfig;
  accountAddress: string;
  tokenId: number;
}) {
  const destination = requireAddress(accountAddress, "Droid Account");
  const { browserProvider, signer } = await signerFor(provider, config);
  const signerAddress = await signer.getAddress();
  await verifyCurrentOwner(browserProvider, config, tokenId, signerAddress);
  if (await browserProvider.getCode(destination) === "0x") {
    throw new Error("This Droid Account is not active.");
  }
  const account = new Contract(destination, DROID_ACCOUNT_ABI, signer);
  if (!sameAddress(await account.owner() as string, signerAddress)) {
    throw new Error("Droid Account authority changed before execution.");
  }
  return account;
}

export async function withdrawDroidEth({
  provider,
  config,
  accountAddress,
  tokenId,
  recipient,
  amount,
}: {
  provider: DroidEip1193Provider;
  config: DroidProtocolConfig;
  accountAddress: string;
  tokenId: number;
  recipient: string;
  amount: string;
}) {
  const to = requireAddress(recipient, "recipient");
  const value = parseEther(amount);
  if (value <= 0n) {
    throw new Error(`Enter a ${config.nativeCurrencySymbol} amount greater than zero.`);
  }
  const account = await ownerAccount({ provider, config, accountAddress, tokenId });
  await account.execute.estimateGas(to, value, "0x", 0);
  const transaction = await account.execute(to, value, "0x", 0);
  await transaction.wait();
  return transaction.hash as string;
}

export async function withdrawDroidToken({
  provider,
  config,
  accountAddress,
  tokenId,
  tokenAddress,
  decimals,
  recipient,
  amount,
}: {
  provider: DroidEip1193Provider;
  config: DroidProtocolConfig;
  accountAddress: string;
  tokenId: number;
  tokenAddress: string;
  decimals: number;
  recipient: string;
  amount: string;
}) {
  const to = requireAddress(recipient, "recipient");
  const token = requireAddress(tokenAddress, "token contract");
  const configured = config.tokens.some((entry) => sameAddress(entry.address, token));
  if (!configured) throw new Error("That token is not in the configured Droid asset list.");
  const value = parseUnits(amount, decimals);
  if (value <= 0n) throw new Error("Enter a token amount greater than zero.");
  const tokenInterface = new Interface(DROID_ERC20_ABI);
  const data = tokenInterface.encodeFunctionData("transfer", [to, value]);
  const account = await ownerAccount({ provider, config, accountAddress, tokenId });
  await account.execute.estimateGas(token, 0, data, 0);
  const transaction = await account.execute(token, 0, data, 0);
  await transaction.wait();
  return transaction.hash as string;
}

export async function withdrawDroidNft({
  provider,
  config,
  accountAddress,
  tokenId,
  nftCollection,
  nftTokenId,
  recipient,
}: {
  provider: DroidEip1193Provider;
  config: DroidProtocolConfig;
  accountAddress: string;
  tokenId: number;
  nftCollection: string;
  nftTokenId: string;
  recipient: string;
}) {
  const accountAddressChecked = requireAddress(accountAddress, "Droid Account");
  const collection = requireAddress(nftCollection, "NFT collection");
  const to = requireAddress(recipient, "recipient");
  const configured = config.nftCollections.some((entry) => sameAddress(entry.address, collection));
  if (!configured) throw new Error("That NFT collection is not configured for Droid inventory.");
  if (!/^\d+$/.test(nftTokenId)) throw new Error("Invalid NFT token ID.");
  const nftInterface = new Interface(DROID_ERC721_ABI);
  const data = nftInterface.encodeFunctionData(
    "safeTransferFrom(address,address,uint256)",
    [accountAddressChecked, to, BigInt(nftTokenId)],
  );
  const account = await ownerAccount({ provider, config, accountAddress, tokenId });
  await account.execute.estimateGas(collection, 0, data, 0);
  const transaction = await account.execute(collection, 0, data, 0);
  await transaction.wait();
  return transaction.hash as string;
}
