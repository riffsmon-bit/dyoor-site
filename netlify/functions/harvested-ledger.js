const OWNER = "riffsmon-bit";
const DEFAULT_REPO = "riffsmon-bit/dyoor-site";
const DEFAULT_BRANCH = "main";
const DEFAULT_PATH = "data/harvested-energy.json";

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

function toBigInt(value) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

function parseRepo(full) {
  const repo = String(full || DEFAULT_REPO);
  const parts = repo.split("/");
  if (parts.length !== 2) throw new Error("GITHUB_REPO must look like owner/repo");
  return { owner: parts[0], repo: parts[1] };
}

async function githubRequest(path, token, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let jsonBody = null;
  try {
    jsonBody = text ? JSON.parse(text) : null;
  } catch {
    jsonBody = null;
  }

  if (!res.ok) {
    throw new Error(
      jsonBody?.message ||
      `GitHub API failed (${res.status})`
    );
  }

  return jsonBody;
}

async function readLedger({ owner, repo, branch, path, token }) {
  try {
    const data = await githubRequest(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      token
    );

    const content = Buffer.from(data.content, "base64").toString("utf8");
    const parsed = JSON.parse(content || "{}");

    return {
      sha: data.sha,
      ledger: parsed && typeof parsed === "object" ? parsed : {}
    };
  } catch (err) {
    if (String(err.message || "").includes("Not Found")) {
      return { sha: null, ledger: {} };
    }
    throw err;
  }
}

async function writeLedger({ owner, repo, branch, path, token, ledger, sha, message }) {
  const content = Buffer.from(JSON.stringify(ledger, null, 2) + "\n", "utf8").toString("base64");

  const body = {
    message,
    content,
    branch
  };

  if (sha) body.sha = sha;

  return githubRequest(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    token,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}

exports.handler = async function (event) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const { owner, repo } = parseRepo(process.env.GITHUB_REPO || DEFAULT_REPO);
    const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
    const path = process.env.GITHUB_LEDGER_PATH || DEFAULT_PATH;

    if (!token) {
      return json(500, { ok: false, error: "Missing GITHUB_TOKEN" });
    }

    if (event.httpMethod === "GET") {
      const address = normalizeAddress(event.queryStringParameters?.address || "");
      if (!address) return json(400, { ok: false, error: "Missing or invalid address" });

      const { ledger } = await readLedger({ owner, repo, branch, path, token });
      const harvestedRaw = String(ledger[address]?.harvestedRaw || "0");

      return json(200, {
        ok: true,
        address,
        harvestedRaw
      });
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const action = String(body.action || "");

      const address = normalizeAddress(body.address || "");
      if (!address) return json(400, { ok: false, error: "Missing or invalid address" });

      const { sha, ledger } = await readLedger({ owner, repo, branch, path, token });
      const current = ledger[address] || { harvestedRaw: "0", claims: [] };

      if (action === "recordHarvest" || action === "seedHarvest") {
        const amountRaw = toBigInt(body.amountRaw);
        if (amountRaw <= 0n) return json(400, { ok: false, error: "Invalid amountRaw" });

        const txHash = String(body.txHash || "").toLowerCase();
        const claims = Array.isArray(current.claims) ? current.claims : [];

        if (txHash && claims.some(c => String(c.txHash || "").toLowerCase() === txHash)) {
          return json(200, {
            ok: true,
            deduped: true,
            address,
            harvestedRaw: String(current.harvestedRaw || "0")
          });
        }

        const next = toBigInt(current.harvestedRaw) + amountRaw;

        ledger[address] = {
          harvestedRaw: next.toString(),
          claims: txHash
            ? claims.concat([{
                txHash,
                amountRaw: amountRaw.toString(),
                seeded: action === "seedHarvest",
                recordedAt: new Date().toISOString()
              }])
            : claims
        };

        await writeLedger({
          owner,
          repo,
          branch,
          path,
          token,
          sha,
          ledger,
          message: `${action === "seedHarvest" ? "Seed" : "Record"} harvest for ${address}`
        });

        return json(200, {
          ok: true,
          address,
          harvestedRaw: ledger[address].harvestedRaw
        });
      }

      return json(400, { ok: false, error: "Unsupported action" });
    }

    return json(405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    return json(500, {
      ok: false,
      error: String(err?.message || err)
    });
  }
};