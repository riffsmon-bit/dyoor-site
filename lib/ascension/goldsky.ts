export type GoldskyStakeResult = {
  tokenIds: string[];
  source: "goldsky";
};

const GOLD_SKY_QUERIES = [
  `query DyoorStakedTokens($wallet: String!) {
    stakedTokens(where: { owner: $wallet }) { tokenId }
  }`,
  `query DyoorStakes($wallet: String!) {
    stakes(where: { owner: $wallet, unstakedAt: null }) { tokenId }
  }`,
  `query DyoorAscensions($wallet: String!) {
    ascensions(where: { user: $wallet, active: true }) { tokenId }
  }`,
];

function extractTokenIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const ids: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const tokenId = record.tokenId ?? record.id;
    if (tokenId != null && /^\d+$/.test(String(tokenId))) ids.push(String(tokenId));
    Object.values(record).forEach(visit);
  };
  visit(value);
  return Array.from(new Set(ids)).sort((a, b) => Number(a) - Number(b));
}

export async function fetchGoldskyStakedTokens(wallet: string): Promise<GoldskyStakeResult | null> {
  const endpoint = process.env.NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL;
  if (!endpoint || !wallet) return null;

  for (const query of GOLD_SKY_QUERIES) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          variables: { wallet: wallet.toLowerCase() },
        }),
        cache: "no-store",
      });

      if (!response.ok) continue;
      const payload = await response.json();
      if (payload?.errors?.length) continue;
      const tokenIds = extractTokenIds(payload?.data);
      if (tokenIds.length) return { tokenIds, source: "goldsky" };
    } catch {
      continue;
    }
  }

  return null;
}
