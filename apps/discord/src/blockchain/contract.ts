import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";
import type { AppEnv } from "../config/env.js";
import type { ChainDefinition, ContractDefinition, HolderRoleKey } from "../discord/model.js";

const erc721Abi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "supportsInterface",
    stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ascensionAbi = [
  {
    type: "function",
    name: "tokensOfStaker",
    stateMutability: "view",
    inputs: [{ name: "staker", type: "address" }],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "stakedBalance",
    stateMutability: "view",
    inputs: [{ name: "staker", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const probeWallet = getAddress("0x000000000000000000000000000000000000dEaD");

export interface ContractInspection {
  key: HolderRoleKey;
  label: string;
  network: string;
  chainId: number;
  address: Address;
  bytecodePresent: true;
  standard: "ERC-721" | "DYØØR Ascension staking";
  ownershipMethod: "balanceOf(address) > 0" | "tokensOfStaker(address).length > 0";
  name?: string;
  symbol?: string;
  totalSupply?: bigint;
  supportsErc721?: boolean;
}

export interface ContractHealth {
  key: HolderRoleKey;
  label: string;
  ok: boolean;
  inspection?: ContractInspection;
  error?: string;
}

export type EntitlementRead =
  | { key: HolderRoleKey; status: "QUALIFIED"; balance: bigint }
  | { key: HolderRoleKey; status: "NOT_QUALIFIED"; balance: 0n }
  | { key: HolderRoleKey; status: "RPC_ERROR"; error: string };

function chainFor(key: ChainDefinition["key"]) {
  const chain = dyoorDiscordConfig.chains.find((candidate) => candidate.key === key);
  if (!chain) throw new Error(`Unknown configured chain ${key}`);
  return chain;
}

function rpcUrl(env: AppEnv, chain: ChainDefinition) {
  return chain.key === "monad" ? env.MONAD_RPC_URL : env.ROBINHOOD_RPC_URL;
}

export function createChainClient(env: AppEnv, key: ChainDefinition["key"]): PublicClient {
  const configured = chainFor(key);
  const url = rpcUrl(env, configured);
  const chain = defineChain({
    id: configured.id,
    name: configured.name,
    nativeCurrency: {
      name: configured.currency,
      symbol: configured.currency,
      decimals: 18,
    },
    rpcUrls: { default: { http: [url] } },
  });
  return createPublicClient({
    chain,
    transport: http(url, { timeout: env.RPC_TIMEOUT_MS, retryCount: 1 }),
  });
}

async function validateChain(client: PublicClient, chain: ChainDefinition) {
  const actual = await client.getChainId();
  if (actual !== chain.id) {
    throw new Error(`RPC chain mismatch: expected ${chain.id}, received ${actual}`);
  }
}

async function inspectErc721(
  client: PublicClient,
  contract: ContractDefinition,
  chain: ChainDefinition,
): Promise<ContractInspection> {
  const address = getAddress(contract.address);
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`No bytecode at ${address}`);
  const [name, symbol, supportsErc721, totalSupply] = await Promise.all([
    client.readContract({ address, abi: erc721Abi, functionName: "name" }),
    client.readContract({ address, abi: erc721Abi, functionName: "symbol" }),
    client.readContract({
      address,
      abi: erc721Abi,
      functionName: "supportsInterface",
      args: ["0x80ac58cd"],
    }),
    client.readContract({ address, abi: erc721Abi, functionName: "totalSupply" }),
    client.readContract({
      address,
      abi: erc721Abi,
      functionName: "balanceOf",
      args: [probeWallet],
    }),
  ]);
  if (!supportsErc721) throw new Error("ERC-721 interface is not supported");
  if (contract.expectedName && name !== contract.expectedName) {
    throw new Error(`Name mismatch: expected ${contract.expectedName}, received ${name}`);
  }
  if (contract.expectedSymbol && symbol !== contract.expectedSymbol) {
    throw new Error(`Symbol mismatch: expected ${contract.expectedSymbol}, received ${symbol}`);
  }
  return {
    key: contract.key,
    label: contract.label,
    network: chain.name,
    chainId: chain.id,
    address,
    bytecodePresent: true,
    standard: "ERC-721",
    ownershipMethod: "balanceOf(address) > 0",
    name,
    symbol,
    totalSupply,
    supportsErc721,
  };
}

async function inspectAscension(
  client: PublicClient,
  contract: ContractDefinition,
  chain: ChainDefinition,
): Promise<ContractInspection> {
  const address = getAddress(contract.address);
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`No bytecode at ${address}`);
  await client.readContract({
    address,
    abi: ascensionAbi,
    functionName: "tokensOfStaker",
    args: [probeWallet],
  });
  return {
    key: contract.key,
    label: contract.label,
    network: chain.name,
    chainId: chain.id,
    address,
    bytecodePresent: true,
    standard: "DYØØR Ascension staking",
    ownershipMethod: "tokensOfStaker(address).length > 0",
  };
}

export async function inspectConfiguredContract(
  env: AppEnv,
  contract: ContractDefinition,
): Promise<ContractInspection> {
  const chain = chainFor(contract.chainKey);
  const client = createChainClient(env, chain.key);
  await validateChain(client, chain);
  return contract.standard === "ERC721"
    ? inspectErc721(client, contract, chain)
    : inspectAscension(client, contract, chain);
}

export async function inspectContractRegistry(env: AppEnv): Promise<ContractHealth[]> {
  return Promise.all(
    dyoorDiscordConfig.contracts.map(async (contract) => {
      try {
        return {
          key: contract.key,
          label: contract.label,
          ok: true,
          inspection: await inspectConfiguredContract(env, contract),
        } satisfies ContractHealth;
      } catch (error) {
        return {
          key: contract.key,
          label: contract.label,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown contract validation error",
        } satisfies ContractHealth;
      }
    }),
  );
}

async function readContractEntitlement(
  env: AppEnv,
  contract: ContractDefinition,
  wallet: Address,
): Promise<EntitlementRead> {
  const client = createChainClient(env, contract.chainKey);
  const chain = chainFor(contract.chainKey);
  await validateChain(client, chain);
  const address = getAddress(contract.address);
  let balance: bigint;
  if (contract.standard === "ERC721") {
    balance = await client.readContract({
      address,
      abi: erc721Abi,
      functionName: "balanceOf",
      args: [wallet],
    });
  } else {
    const tokens = await client.readContract({
      address,
      abi: ascensionAbi,
      functionName: "tokensOfStaker",
      args: [wallet],
    });
    balance = BigInt(tokens.length);
  }
  return balance > 0n
    ? { key: contract.key, status: "QUALIFIED", balance }
    : { key: contract.key, status: "NOT_QUALIFIED", balance: 0n };
}

export async function readWalletEntitlements(
  env: AppEnv,
  walletAddress: Address,
): Promise<Record<HolderRoleKey, EntitlementRead>> {
  const wallet = getAddress(walletAddress);
  const entries = await Promise.all(
    dyoorDiscordConfig.contracts.map(async (contract) => {
      try {
        return [contract.key, await readContractEntitlement(env, contract, wallet)] as const;
      } catch (error) {
        return [
          contract.key,
          {
            key: contract.key,
            status: "RPC_ERROR",
            error: error instanceof Error ? error.message : "Blockchain provider unavailable",
          } satisfies EntitlementRead,
        ] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<HolderRoleKey, EntitlementRead>;
}

export async function getEntitlementBalance(
  env: AppEnv,
  key: HolderRoleKey,
  wallet: Address,
): Promise<bigint> {
  const contract = dyoorDiscordConfig.contracts.find((candidate) => candidate.key === key);
  if (!contract) throw new Error(`Unknown entitlement ${key}`);
  const result = await readContractEntitlement(env, contract, getAddress(wallet));
  if (result.status === "RPC_ERROR") throw new Error(result.error);
  return result.balance;
}
