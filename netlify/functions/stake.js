import { getStore } from "@netlify/blobs";
import { ethers } from "ethers";

const ERC721_ABI = ["function balanceOf(address owner) view returns (uint256)"];

const CONTRACT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const CHAIN_ID = 143; // Monad
const RPC_URL = "https://rpc.monad.xyz";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function csv(status, csvText) {
  return new Response(csvText, {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dyoor_softstake_snapshot.csv"`,
    },
  });
}

function normalizeAddr(a) {
  try {
    return ethers.getAddress(a);
  } catch {
    return null;
  }
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

// Netlify Functions (new runtime): must return Response
export default async (request) => {
  try {
    if (request.method === "OPTIONS") return json(200, { ok: true });

    const store = getStore("softstake");
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    // GET leaderboard
    if (request.method === "GET" && action === "leaderboard") {
      const idx = await readIndex(store);
      const rows = [];

      for (const addr of idx.addresses.slice(0, 500)) {
        const rec = await store.get(`${addr}.json`, { type: "json" });
        if (rec && rec.address) rows.push(rec);
      }

      rows.sort(
        (a, b) =>
          (b.points || 0) - (a.points || 0) ||
          (b.soft_staked || 0) - (a.soft_staked || 0)
      );

      return json(200, { ok: true, rows: rows.slice(0, 50) });
    }

    // GET snapshot CSV
    if (request.method === "GET" && action === "snapshot") {
      const idx = await readIndex(store);
      const out = ["address,held,soft_staked,points,updated_at"];

      for (const addr of idx.addresses.slice(0, 10000)) {
        const rec = await store.get(`${addr}.json`, { type: "json" });
        if (!rec || !rec.address) continue;

        const row = [
          rec.address,
          rec.held ?? "",
          rec.soft_staked ?? "",
          rec.points ?? 0,
          rec.updated_at ?? "",
        ]
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(",");

        out.push(row);
      }

      return csv(200, out.join("\n"));
    }

    // POST upsert
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));

      const address = normalizeAddr(body.address);
      if (!address) return json(400, { ok: false, error: "Invalid address" });

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

      const held = await getOnchainBalance(address);

      let softStaked = Number(body.soft_staked ?? 0);
      if (!Number.isFinite(softStaked)) softStaked = 0;
      softStaked = Math.max(0, Math.min(softStaked, held));

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

      const idx = await readIndex(store);
      if (!idx.addresses.includes(address)) {
        idx.addresses.unshift(address);
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