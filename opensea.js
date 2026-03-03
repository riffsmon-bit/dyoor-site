// Netlify Function: OpenSea proxy for collection NFT previews
// - Handles CORS
// - Allows optional OPENSEA_API_KEY via Netlify env var
// - Keeps your front-end simple

export async function handler(event) {
  try {
    const qs = event.queryStringParameters || {};

    // You can fetch either by collection slug OR by chain+contract address.
    // Prefer chain+contract for non-Ethereum chains (more reliable).
    const slug = qs.slug ? String(qs.slug) : "";
    const address = qs.address ? String(qs.address) : "";
    const chain = qs.chain ? String(qs.chain) : "monad";

    const limitRaw = qs.limit ? Number(qs.limit) : 48;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 48;

    if (!slug && !address) {
      return {
        statusCode: 400,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
        },
        body: JSON.stringify({ error: 'Missing slug or address' }),
      };
    }

    // Contract-based route (recommended)
    const url = address
      ? `https://api.opensea.io/api/v2/chain/${encodeURIComponent(chain)}/contract/${encodeURIComponent(address)}/nfts?limit=${encodeURIComponent(limit)}`
      : `https://api.opensea.io/api/v2/collection/${encodeURIComponent(slug)}/nfts?limit=${encodeURIComponent(limit)}`;

    const headers = {
      'accept': 'application/json',
    };

    // Optional: set OPENSEA_API_KEY in Netlify environment variables
    if (process.env.OPENSEA_API_KEY) {
      headers['x-api-key'] = process.env.OPENSEA_API_KEY;
    }

    const res = await fetch(url, { headers });
    const text = await res.text();

    return {
      statusCode: res.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=300',
      },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      },
      body: JSON.stringify({ error: 'Proxy failed', details: String(e && e.message ? e.message : e) }),
    };
  }
}
