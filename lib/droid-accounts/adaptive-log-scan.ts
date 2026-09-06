export type AdaptiveLogProvider<T> = {
  label: string;
  readRange(fromBlock: number, toBlock: number): Promise<T[]>;
};

export type AdaptiveLogRange<T> = {
  fromBlock: number;
  toBlock: number;
  items: T[];
  provider: string;
};

export type AdaptiveLogScanResult = {
  completed: boolean;
  indexedThroughBlock: number;
  provider: string;
  lastError: string;
  retryState:
    | "idle"
    | "retrying"
    | "reduced-range"
    | "fallback"
    | "budget-exhausted"
    | "failed";
  ranges: number;
  retries: number;
};

type AdaptiveLogScanOptions<T> = {
  fromBlock: number;
  toBlock: number;
  initialChunkSize: number;
  minimumChunkSize: number;
  retriesPerProvider: number;
  concurrency?: number;
  maxRanges?: number;
  maxDurationMs?: number;
  requestTimeoutMs?: number;
  providers: AdaptiveLogProvider<T>[];
  onRange(range: AdaptiveLogRange<T>): Promise<void> | void;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

function conciseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "RPC log request failed");
  return message.replace(/https?:\/\/\S+/gi, "[provider]").replace(/\s+/g, " ").slice(0, 240);
}

function defaultWait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function boundedRead<T>(promise: Promise<T[]>, timeoutMs: number) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    const value = await promise;
    if (!Array.isArray(value)) throw new Error("RPC log response was malformed.");
    return value;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("RPC log request timed out.")), timeoutMs);
      timer.unref?.();
    });
    const value = await Promise.race([promise, timeout]);
    if (!Array.isArray(value)) throw new Error("RPC log response was malformed.");
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Selects a backlog-aware first range while keeping an explicit hard ceiling.
 * Providers that reject it are still handled by the scanner's bounded bisection.
 */
export function chooseCatchupChunkSize(input: {
  fromBlock: number;
  toBlock: number;
  configuredChunkSize: number;
  maxRanges: number;
  maximumChunkSize: number;
}) {
  const fromBlock = Math.max(0, Math.trunc(input.fromBlock));
  const toBlock = Math.max(fromBlock - 1, Math.trunc(input.toBlock));
  const configured = Math.max(1, Math.trunc(input.configuredChunkSize));
  const maxRanges = Math.max(1, Math.trunc(input.maxRanges));
  const maximum = Math.max(configured, Math.trunc(input.maximumChunkSize));
  const backlog = toBlock >= fromBlock ? toBlock - fromBlock + 1 : 0;
  const rangeBudgetChunk = backlog ? Math.ceil(backlog / maxRanges) : configured;
  return Math.min(maximum, Math.max(configured, rangeBudgetChunk));
}

/** Clamps stale/future checkpoints before applying the bounded reorg overlap. */
export function activityResumeBlock(input: {
  startBlock: number;
  latestBlock: number;
  indexedThroughBlock: number | null;
  reorgBlocks: number;
}) {
  const startBlock = Math.max(0, Math.trunc(input.startBlock));
  const latestBlock = Math.max(startBlock, Math.trunc(input.latestBlock));
  if (input.indexedThroughBlock === null) return startBlock;
  const indexedThroughBlock = Math.min(
    latestBlock,
    Math.max(startBlock - 1, Math.trunc(input.indexedThroughBlock)),
  );
  const overlap = Math.max(0, Math.trunc(input.reorgBlocks));
  return Math.max(startBlock, indexedThroughBlock - overlap + 1);
}

/**
 * Scans logs in bounded ranges. A rejected range is retried, moved to an
 * explicitly configured fallback provider, and finally bisected. Successful
 * ranges are committed through `onRange`, so callers can persist progress.
 */
export async function scanAdaptiveLogRanges<T>(
  options: AdaptiveLogScanOptions<T>,
): Promise<AdaptiveLogScanResult> {
  const start = Math.max(0, Math.trunc(options.fromBlock));
  const end = Math.max(start - 1, Math.trunc(options.toBlock));
  const maximumChunkSize = Math.max(1, Math.trunc(options.initialChunkSize));
  const minimumChunkSize = Math.min(
    maximumChunkSize,
    Math.max(1, Math.trunc(options.minimumChunkSize)),
  );
  const retriesPerProvider = Math.max(0, Math.trunc(options.retriesPerProvider));
  const concurrency = Math.min(32, Math.max(1, Math.trunc(options.concurrency || 1)));
  const maxRanges = Math.max(1, Math.trunc(options.maxRanges || Number.MAX_SAFE_INTEGER));
  const wait = options.wait || defaultWait;
  const now = options.now || Date.now;
  const startedAt = now();
  const maxDurationMs = Math.max(0, Math.trunc(options.maxDurationMs || 0));
  const requestTimeoutMs = Math.max(0, Math.trunc(options.requestTimeoutMs || 0));
  const deadline = maxDurationMs > 0 ? startedAt + maxDurationMs : Number.POSITIVE_INFINITY;
  if (!options.providers.length) throw new Error("At least one log provider is required.");

  let cursor = start;
  let chunkSize = maximumChunkSize;
  let indexedThroughBlock = start - 1;
  let provider = options.providers[0].label;
  let lastError = "";
  let retryState: AdaptiveLogScanResult["retryState"] = "idle";
  let ranges = 0;
  let retries = 0;

  const budgetResult = (): AdaptiveLogScanResult => ({
    completed: false,
    indexedThroughBlock,
    provider,
    lastError: "Activity sync time budget reached; checkpointed progress will resume.",
    retryState: "budget-exhausted",
    ranges,
    retries,
  });

  async function readRange(fromBlock: number, toBlock: number) {
    let rangeItems: T[] | null = null;
    let rangeProvider = options.providers[0].label;
    let rangeLastError = "";
    let rangeRetryState: AdaptiveLogScanResult["retryState"] = "idle";
    let rangeRetries = 0;

    for (let providerIndex = 0; providerIndex < options.providers.length && !rangeItems; providerIndex += 1) {
      const candidate = options.providers[providerIndex];
      for (let attempt = 0; attempt <= retriesPerProvider; attempt += 1) {
        if (now() >= deadline) {
          return {
            items: null,
            provider: rangeProvider,
            lastError: "Activity sync time budget reached; checkpointed progress will resume.",
            retryState: "budget-exhausted" as const,
            retries: rangeRetries,
          };
        }
        try {
          const remainingBudget = deadline - now();
          const timeout = Math.min(
            requestTimeoutMs || Number.POSITIVE_INFINITY,
            remainingBudget,
          );
          rangeItems = await boundedRead(
            candidate.readRange(fromBlock, toBlock),
            timeout,
          );
          rangeProvider = candidate.label;
          if (providerIndex > 0) rangeRetryState = "fallback";
          break;
        } catch (error) {
          rangeLastError = conciseError(error);
          if (attempt < retriesPerProvider) {
            rangeRetries += 1;
            rangeRetryState = "retrying";
            const backoff = Math.min(1_500, 150 * (2 ** attempt));
            if (now() + backoff >= deadline) {
              return {
                items: null,
                provider: rangeProvider,
                lastError: "Activity sync time budget reached; checkpointed progress will resume.",
                retryState: "budget-exhausted" as const,
                retries: rangeRetries,
              };
            }
            await wait(backoff);
          }
        }
      }
    }

    return {
      items: rangeItems,
      provider: rangeProvider,
      lastError: rangeLastError,
      retryState: rangeRetryState,
      retries: rangeRetries,
    };
  }

  while (cursor <= end) {
    if (now() >= deadline) return budgetResult();
    if (ranges >= maxRanges) {
      return {
        completed: false,
        indexedThroughBlock,
        provider,
        lastError,
        retryState,
        ranges,
        retries,
      };
    }
    const remainingRanges = maxRanges - ranges;
    const waveSize = Math.min(
      concurrency,
      remainingRanges,
      Math.ceil((end - cursor + 1) / chunkSize),
    );
    const wave = Array.from({ length: waveSize }, (_, index) => {
      const fromBlock = cursor + (index * chunkSize);
      return {
        fromBlock,
        toBlock: Math.min(end, fromBlock + chunkSize - 1),
      };
    });
    const results = await Promise.all(wave.map(async (range) => ({
      ...range,
      result: await readRange(range.fromBlock, range.toBlock),
    })));
    retries += results.reduce((total, item) => total + item.result.retries, 0);
    const failed = results.find((item) => !item.result.items);
    if (failed) {
      provider = failed.result.provider;
      lastError = failed.result.lastError;
      retryState = failed.result.retryState;
      if (failed.result.retryState === "budget-exhausted") return budgetResult();
      const width = failed.toBlock - failed.fromBlock + 1;
      if (width > minimumChunkSize) {
        chunkSize = Math.max(minimumChunkSize, Math.floor(width / 2));
        retryState = "reduced-range";
        continue;
      }
      return {
        completed: false,
        indexedThroughBlock,
        provider,
        lastError,
        retryState: "failed",
        ranges,
        retries,
      };
    }

    for (const item of results) {
      const rangeItems = item.result.items;
      if (!rangeItems) throw new Error("Completed activity range unexpectedly lacked items.");
      await options.onRange({
        fromBlock: item.fromBlock,
        toBlock: item.toBlock,
        items: rangeItems,
        provider: item.result.provider,
      });
      ranges += 1;
      indexedThroughBlock = item.toBlock;
      cursor = item.toBlock + 1;
      provider = item.result.provider;
      if (item.result.retryState !== "idle") retryState = item.result.retryState;
    }

  }

  return {
    completed: true,
    indexedThroughBlock,
    provider,
    lastError,
    retryState,
    ranges,
    retries,
  };
}

export function dedupeActivityItems<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id.toLowerCase(), item])).values()];
}
