exports.config = { schedule: "*/2 * * * *" };

function siteOrigin() {
  return (
    process.env.DEPLOY_PRIME_URL
    || process.env.URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || "https://dyoor.fun"
  ).replace(/\/+$/, "");
}

exports.handler = async () => {
  const secret = String(process.env.DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET || "");
  if (secret.length < 32) {
    return {
      statusCode: 503,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: false,
        scheduled: true,
        error: "DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET is not configured.",
      }),
    };
  }

  const response = await fetch(`${siteOrigin()}/api/s2/trait-lab/bounties/process`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dyoor-bounty-secret": secret,
    },
    body: JSON.stringify({ limit: 50 }),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    statusCode: response.ok ? 200 : 500,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: response.ok,
      scheduled: true,
      status: response.status,
      result: payload,
    }),
  };
};
