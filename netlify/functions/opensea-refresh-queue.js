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
  const response = await fetch(`${siteOrigin()}/api/s2/trait-lab/opensea-refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "netlify-scheduled-function" }),
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
