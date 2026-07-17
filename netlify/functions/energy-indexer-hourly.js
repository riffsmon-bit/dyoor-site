exports.config = { schedule: "*/15 * * * *" };

function siteOrigin() {
  return (
    process.env.DEPLOY_PRIME_URL
    || process.env.URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || "https://dyoor.netlify.app"
  ).replace(/\/+$/, "");
}

exports.handler = async () => {
  const secret = process.env.ENERGY_INDEXER_SECRET || process.env.ADMIN_API_SECRET || "";
  if (!secret) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: true,
        skipped: true,
        reason: "ENERGY_INDEXER_SECRET or ADMIN_API_SECRET is not configured.",
      }),
    };
  }

  const maxChunks = Math.max(1, Math.min(50, Number(process.env.ENERGY_INDEXER_MAX_CHUNKS || 8) || 8));
  const response = await fetch(`${siteOrigin()}/api/admin/energy/reindex`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-secret": secret,
    },
    body: JSON.stringify({ maxChunks }),
  });

  const payload = await response.json().catch(() => ({}));
  return {
    statusCode: response.ok ? 200 : 500,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: response.ok,
      scheduled: true,
      maxChunks,
      status: response.status,
      result: payload,
    }),
  };
};
