const { getStore } = require("@netlify/blobs");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function normalizeAddress(address) {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function safeBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
    if (typeof value === "string" && value.trim() !== "") return BigInt(value.trim());
    return fallback;
  } catch {
    return fallback;
  }
}

exports.handler = async function (event) {
  try {
    const store = getStore("ascension-energy-ledger");
    const method = (event.httpMethod || "GET").toUpperCase();

    if (method === "GET") {
      const address = normalizeAddress(event?.queryStringParameters?.address || "");
      if (!address) {
        return json(400, { ok: false, error: "Missing or invalid address" });
      }

      const record = await store.get(`${address}.json`, { type: "json" });
      const harvestedRaw = safeBigInt(record?.harvestedRaw || "0").toString();

      return json(200, {
        ok: true,
        address,
        harvestedRaw,
        harvestedEnergy: harvestedRaw
      });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const action = String(body.action || "").trim();

      if (action === "recordHarvest") {
        const address = normalizeAddress(body.address);
        const amountRaw = safeBigInt(body.amountRaw || "0");

        if (!address) {
          return json(400, { ok: false, error: "Invalid address" });
        }

        if (amountRaw <= 0n) {
          return json(400, { ok: false, error: "Invalid harvest amount" });
        }

        const key = `${address}.json`;
        const existing = (await store.get(key, { type: "json" })) || {
          address,
          harvestedRaw: "0",
          claims: []
        };

        const txHash = String(body.txHash || "").toLowerCase();
        const existingClaims = Array.isArray(existing.claims) ? existing.claims : [];

        if (txHash && existingClaims.some((c) => String(c.txHash || "").toLowerCase() === txHash)) {
          return json(200, {
            ok: true,
            deduped: true,
            address,
            harvestedRaw: String(existing.harvestedRaw || "0")
          });
        }

        const previousRaw = safeBigInt(existing.harvestedRaw || "0");
        const nextRaw = previousRaw + amountRaw;

        const nextClaims = txHash
          ? existingClaims.concat([
              {
                txHash,
                amountRaw: amountRaw.toString(),
                recordedAt: new Date().toISOString()
              }
            ])
          : existingClaims;

        await store.set(key, {
          address,
          harvestedRaw: nextRaw.toString(),
          claims: nextClaims
        });

        return json(200, {
          ok: true,
          address,
          harvestedRaw: nextRaw.toString()
        });
      }

      if (action === "seedHarvest") {
        const address = normalizeAddress(body.address);
        const amountRaw = safeBigInt(body.amountRaw || "0");
        const txHash = String(body.txHash || "").toLowerCase();

        if (!address) {
          return json(400, { ok: false, error: "Invalid address" });
        }

        if (amountRaw <= 0n) {
          return json(400, { ok: false, error: "Invalid seed amount" });
        }

        const key = `${address}.json`;
        const existing = (await store.get(key, { type: "json" })) || {
          address,
          harvestedRaw: "0",
          claims: []
        };

        const existingClaims = Array.isArray(existing.claims) ? existing.claims : [];

        if (txHash && existingClaims.some((c) => String(c.txHash || "").toLowerCase() === txHash)) {
          return json(200, {
            ok: true,
            deduped: true,
            address,
            harvestedRaw: String(existing.harvestedRaw || "0")
          });
        }

        const previousRaw = safeBigInt(existing.harvestedRaw || "0");
        const nextRaw = previousRaw + amountRaw;

        const nextClaims = txHash
          ? existingClaims.concat([
              {
                txHash,
                amountRaw: amountRaw.toString(),
                recordedAt: new Date().toISOString(),
                seeded: true
              }
            ])
          : existingClaims;

        await store.set(key, {
          address,
          harvestedRaw: nextRaw.toString(),
          claims: nextClaims
        });

        return json(200, {
          ok: true,
          address,
          harvestedRaw: nextRaw.toString()
        });
      }

      return json(400, { ok: false, error: "Unsupported action" });
    }

    return json(405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    return json(500, {
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
};