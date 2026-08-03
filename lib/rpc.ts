import {
  createPublicClient,
  encodeFunctionData,
  http,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
} from "viem";
import { monadMainnet, DEFAULT_MONAD_RPC_URL } from "@/lib/monad";

type ReadKey = string;

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;
const inFlightReads = new Map<ReadKey, Promise<unknown>>();

function configuredUrls() {
  return [DEFAULT_MONAD_RPC_URL];
}

function timeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function withRetry<T>(task: () => Promise<T>, label: string, retries = DEFAULT_RETRIES): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await timeout(task(), DEFAULT_TIMEOUT_MS, label);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function createMonadPublicClient(rpcUrl = configuredUrls()[0]) {
  return createPublicClient({
    chain: monadMainnet,
    transport: http(rpcUrl, { timeout: DEFAULT_TIMEOUT_MS, retryCount: 0 }),
  });
}

export async function readWithFailover<T>(label: string, task: (rpcUrl: string) => Promise<T>): Promise<T> {
  const errors: string[] = [];

  for (const rpcUrl of configuredUrls()) {
    try {
      return await withRetry(() => task(rpcUrl), `${label} via Monad RPC`);
    } catch (error) {
      errors.push(`${rpcUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`${label} failed on all Monad RPC endpoints. ${errors.join(" | ")}`);
}

export function dedupeRead<T>(key: ReadKey, task: () => Promise<T>): Promise<T> {
  const existing = inFlightReads.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const next = task().finally(() => inFlightReads.delete(key));
  inFlightReads.set(key, next);
  return next;
}

export async function readContractWithFailover<
  const TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
>(
  params: {
    address: Address;
    abi: TAbi;
    functionName: TFunctionName;
    args?: ContractFunctionArgs<TAbi, "pure" | "view", TFunctionName>;
    label?: string;
  },
) {
  const keyArgs = (params.args ?? []) as readonly unknown[];
  const key = JSON.stringify({
    address: params.address,
    functionName: params.functionName,
    args: keyArgs.map((arg) => typeof arg === "bigint" ? arg.toString() : arg),
  });

  return dedupeRead(key, () => readWithFailover(params.label || String(params.functionName), async (rpcUrl) => {
    const client = createMonadPublicClient(rpcUrl);
    return client.readContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
    } as any);
  }));
}

export function calldataKey(abi: Abi, functionName: string, args: readonly unknown[] = []) {
  return encodeFunctionData({ abi, functionName, args } as any);
}
