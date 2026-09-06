exports.config = { schedule: "0 * * * *" };

function siteOrigin() {
  return (
    process.env.DEPLOY_PRIME_URL
    || process.env.URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || "https://dyoor.fun"
  ).replace(/\/+$/, "");
}

exports.handler = async () => {
  const secret = process.env.ENERGY_RECONCILIATION_AUTOMATION_SECRET || "";
  if (!secret) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: true,
        skipped: true,
        reason: "ENERGY_RECONCILIATION_AUTOMATION_SECRET is not configured.",
      }),
    };
  }

  const limit = Math.max(1, Math.min(25, Number(process.env.ENERGY_RECONCILIATION_AUTO_LIMIT || 10) || 10));
  const response = await fetch(`${siteOrigin()}/api/admin/energy-reconciliation`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dyoor-automation-secret": secret,
    },
    body: JSON.stringify({
      mode: "repair",
      limit,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  return {
    statusCode: response.ok || payload?.partial ? 200 : 500,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: response.ok || Boolean(payload?.partial),
      scheduled: true,
      limit,
      status: response.status,
      result: payload,
    }),
  };
};
