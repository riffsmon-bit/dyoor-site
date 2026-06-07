function json(statusCode, body, cacheControl = "no-store") {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl
    },
    body: JSON.stringify(body)
  };
}

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

exports.handler = async function () {
  const projectId = readEnv(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    "WALLETCONNECT_PROJECT_ID"
  );

  return json(200, {
    ok: true,
    projectId
  }, "public, max-age=300");
};
