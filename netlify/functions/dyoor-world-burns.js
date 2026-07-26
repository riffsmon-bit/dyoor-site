const { createHmac } = require("node:crypto");

exports.config = { schedule: "*/2 * * * *" };

function automationSecret() {
  const configured = String(process.env.DYOOR_WORLD_AUTOMATION_SECRET || "").trim();
  if (configured) return configured;
  const master = String(
    process.env.DYOOR_WORLD_SESSION_SECRET
      || process.env.VERIFY_SESSION_SECRET
      || process.env.DYOOR_TRAIT_LAB_SECRET
      || "",
  ).trim();
  if (master.length < 32) return "";
  return createHmac("sha256", master)
    .update("dyoor-world:automation:v1")
    .digest("hex");
}

function siteOrigin() {
  return (
    process.env.DEPLOY_PRIME_URL
    || process.env.URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || "https://dyoor.netlify.app"
  ).replace(/\/+$/, "");
}

exports.handler = async () => {
  const secret = automationSecret();
  if (secret.length < 32) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: true,
        skipped: true,
        reason: "The dYOOR World automation key is not configured.",
      }),
    };
  }

  const response = await fetch(`${siteOrigin()}/api/dyoor-world/automation/burns`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
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
