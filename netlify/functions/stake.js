// netlify/functions/stake.js
import { getStore } from "@netlify/blobs";
import { ethers } from "ethers";

// Minimal ABI for balance checks
const ERC721_ABI = [
  "function balanceOf(address owner) view returns (uint256)"
];

const CONTRACT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const CHAIN_ID = 143; // Monad
const RPC_URL = "https://rpc.monad.xyz";

// Helpers
function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(obj),
  };
}

function csvResponse(csvText) {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dyoor_softstake_snapshot.csv"`,
      "access-control-allow-origin": "*",
    },
    body: csvText,
  };
}

function normalizeAddr(a) {
  try { return ethers.getAddress(a); } catch { return null; }
}

async function getOnchainBalance(address) {
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const c = new ethers.Contract(CONTRACT_ADDRESS, ERC721_ABI, provider);
  const bal = await c.balanceOf(address);
  return Number(bal);
}

async function readIndex(store) {
  const idx = await store.get("index.json", { type: "json" });
  if (!idx || !Array.isArray(idx.addresses)) return { addresses: [] };
  return idx;
}

async function writeIndex(store, addresses) {
  await store.set("index.json", { addresses });
}

export default async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });

  const store = getStore("softstake"); // Netlify Blobs store

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // ----- GET: leaderboard -----
    if (req.method === "GET" && action === "leaderboard") {
      const idx = await readIndex(store);
      const rows = [];

      for (const addr of idx.addresses.slice(0, 250)) {
        const rec = await store.get(`${addr}.json`, { type: "json" });
        if (rec && rec.address) rows.push(rec);
      }

      // Sort by points desc, then staked amount desc
      rows.sort((a, b) => (b.points || 0) - (a.points || 0) || (b.soft_staked || 0) - (a.soft_staked || 0));

      return json(200, { ok: true, rows: rows.slice(0, 50) });
    }

    // ----- GET: snapshot (CSV) -----
    if (req.method === "GET" && action === "snapshot") {
      const idx = await readIndex(store);
      const out = ["address,held,soft_staked,points,updated_at"];

      for (const addr of idx.addresses.slice(0, 5000)) {
        const rec = await store.get(`${addr}.json`, { type: "json" });
        if (!rec || !rec.address) continue;

        const row = [
          rec.address,
          rec.held ?? "",
          rec.soft_staked ?? "",
          rec.points ?? 0,
          rec.updated_at ?? "",
        ].map(v => `"${String(v).replaceAll('"', '""')}"`).join(",");

        out.push(row);
      }

      return csvResponse(out.join("\n"));
    }

    // ----- POST: upsert staking record -----
    if (req.method === "POST") {
      const body = JSON.parse(req.body || "{}");

      const address = normalizeAddr(body.address);
      if (!address) return json(400, { ok: false, error: "Invalid address" });

      // Verify signature (simple, effective)
      const nonce = String(body.nonce || "");
      const signature = String(body.signature || "");
      const message = `DYOOR Soft Staking\n\nWallet: ${address}\nNonce: ${nonce}`;

      let recovered = "";
      try {
        recovered = ethers.verifyMessage(message, signature);
      } catch {
        return json(400, { ok: false, error: "Bad signature" });
      }
      if (normalizeAddr(recovered) !== address) {
        return json(401, { ok: false, error: "Signature does not match wallet" });
      }

      // Onchain held
      const held = await getOnchainBalance(address);

      // Soft staked amount (clamped)
      let softStaked = Number(body.soft_staked ?? 0);
      if (!Number.isFinite(softStaked)) softStaked = 0;
      softStaked = Math.max(0, Math.min(softStaked, held));

      // Points (simple model: keep what client sends, but don’t allow negatives)
      let points = Number(body.points ?? 0);
      if (!Number.isFinite(points)) points = 0;
      points = Math.max(0, points);

      const now = new Date().toISOString();
      const record = {
        address,
        held,
        soft_staked: softStaked,
        points,
        updated_at: now,
      };

      await store.set(`${address}.json`, record);

      // Add to index
      const idx = await readIndex(store);
      if (!idx.addresses.includes(address)) {
        idx.addresses.unshift(address);
        // de-dup + cap
        idx.addresses = Array.from(new Set(idx.addresses)).slice(0, 10000);
        await writeIndex(store, idx.addresses);
      }

      return json(200, { ok: true, record });
    }

    return json(400, { ok: false, error: "Unsupported request" });
  } catch (e) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
};
