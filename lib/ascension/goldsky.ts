export type GoldskyStakeResult = {
  tokenIds: string[];
  source: "goldsky";
};

type GoldskyStakeEvent = {
  id?: string;
  block_number?: string;
  tokenId?: string;
  user?: string;
};

const GOLDSKY_PAGE_SIZE = 1000;

function eventBlock(event: GoldskyStakeEvent) {
  const value = Number(event.block_number || 0);
  return Number.isFinite(value) ? value : 0;
}

function activeTokenIdsFromEvents(staked: GoldskyStakeEvent[], unstaked: GoldskyStakeEvent[]) {
  const events = [
    ...staked.map((event) => ({ ...event, kind: "staked" as const })),
    ...unstaked.map((event) => ({ ...event, kind: "unstaked" as const })),
  ].filter((event) => /^\d+$/.test(String(event.tokenId || "")));

  events.sort((a, b) => {
    const blockDiff = eventBlock(a) - eventBlock(b);
    if (blockDiff !== 0) return blockDiff;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const active = new Map<string, boolean>();
  for (const event of events) {
    active.set(String(event.tokenId), event.kind === "staked");
  }

  return Array.from(active.entries())
    .filter(([, isActive]) => isActive)
    .map(([tokenId]) => tokenId)
    .sort((a, b) => Number(a) - Number(b));
}

async function fetchWalletEvents(endpoint: string, field: "stakeds" | "unstakeds", wallet: string) {
  const rows: GoldskyStakeEvent[] = [];
  for (let skip = 0; skip < 10_000; skip += GOLDSKY_PAGE_SIZE) {
    const query = `
      query DyoorGoldskyWalletEvents($wallet: String!, $skip: Int!) {
        ${field}(first: ${GOLDSKY_PAGE_SIZE}, skip: $skip, where: { user: $wallet }, orderBy: block_number, orderDirection: asc) {
          id
          block_number
          user
          tokenId
        }
      }
    `;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { wallet: wallet.toLowerCase(), skip },
      }),
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`Goldsky ${field} HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.errors?.length) throw new Error(`Goldsky ${field} query failed`);
    const batch = Array.isArray(payload?.data?.[field]) ? payload.data[field] as GoldskyStakeEvent[] : [];
    rows.push(...batch);
    if (batch.length < GOLDSKY_PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchGoldskyStakedTokens(wallet: string): Promise<GoldskyStakeResult | null> {
  const endpoint = process.env.NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL;
  if (!endpoint || !wallet) return null;

  try {
    const [staked, unstaked] = await Promise.all([
      fetchWalletEvents(endpoint, "stakeds", wallet),
      fetchWalletEvents(endpoint, "unstakeds", wallet),
    ]);
    const tokenIds = activeTokenIdsFromEvents(staked, unstaked);
    return tokenIds.length ? { tokenIds, source: "goldsky" } : null;
  } catch {
    return null;
  }
}
