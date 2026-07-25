import { NetlifyAPI } from "@netlify/api";
import { getAPIToken } from "@netlify/dev-utils";

const SITE_ID = "e2a951cd-7e5b-49ac-a39a-391f68b69964";
const SECRET_SCOPES = ["builds", "functions", "runtime"];
const REMOVE_KEYS = new Map([
  ["ASCENSION_BLUEPRINT_ADMIN_TOKEN", "Blueprint exports now require owner-wallet signatures."],
  ["CREDIT_ROLE", "The Energy Bank role is read directly from the contract."],
  ["DYOOR_TRAIT_BOUNTIES_CONTRACT", "The server uses the identical NEXT_PUBLIC contract address."],
  ["DYOOR_TRAIT_BOUNTIES_START_BLOCK", "The deployment block is retained in the local deployment record."],
  ["DYOOR_TRAIT_BOUNTY_PROCESSOR_ADDRESS", "The processor address is read from the verified contract."],
  ["DYOOR_TRAIT_LAB_DROID_BURN_REWARD_ENERGY", "The server uses the identical NEXT_PUBLIC reward value."],
  ["DYOOR_TRAIT_LAB_ENABLE_DROID_BURN", "The server uses the identical NEXT_PUBLIC feature flag."],
  ["DYOOR_TRAIT_LAB_ENABLE_LEADERBOARD", "The server uses the identical NEXT_PUBLIC feature flag."],
  ["DYOOR_WORLD_NAMES_CONTRACT", "The server uses the identical NEXT_PUBLIC registry address."],
  ["DYOOR_WORLD_NAMES_METADATA_BASE_URI", "The metadata base URI is stored by the deployed registry."],
  ["DYOOR_WORLD_NAMES_START_BLOCK", "The deployment block is retained in the local deployment record."],
  ["DYOOR_WORLD_OPEN_CLAIMS", "Claim state is read directly from the deployed registry."],
  ["DYOOR_WORLD_AUTOMATION_SECRET", "Automation derives a purpose-separated key from the protected World session secret."],
  ["DYOOR_WORLD_REWARD_SECRET", "Daily rewards derive a purpose-separated key from the protected World session secret."],
  ["GOLDSKY_API_KEY", "Runtime code uses the public Goldsky subgraph URL."],
  ["NEXT_PUBLIC_DYOOR_TRAIT_BOUNTIES_CONTRACT", "The verified immutable production address is the code default."],
  ["NEXT_PUBLIC_DYOOR_TRAIT_LAB_DROID_BURN_REWARD_ENERGY", "The production 2,500 Energy reward is the code default."],
  ["NEXT_PUBLIC_DYOOR_TRAIT_LAB_ENABLE_DROID_BURN", "Production burn support defaults to enabled."],
  ["NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT", "The verified immutable production address is the code default."],
  ["NEXT_PUBLIC_DYOOR_WORLD_TRADE_ESCROW_ADDRESS", "The verified ownerless production escrow is the code default."],
  ["NEXT_PUBLIC_DYOOR_S2_LOG_CHUNK_SIZE", "Owned-token scans use the server-safe code default."],
  ["MONAD_RPC_URL", "Runtime code falls back to the Monad public RPC while server paths prefer the protected Alchemy RPC."],
  ["RPC_URL", "Legacy verification functions now use the Monad public RPC fallback."],
  ["CHAIN_ID", "All production code defaults to Monad chain ID 143."],
  ["OPENSEA_CHAIN", "OpenSea metadata refresh defaults to Monad."],
  ["OX_API_KEY", "The current swap quote function no longer uses 0x."],
  ["PANCAKE_V2_ROUTER", "The current swap quote function no longer uses PancakeSwap."],
]);
const PROTECT_KEYS = [
  "ALCHEMY_MONAD_RPC_URL",
  "DISCORD_BOT_TOKEN",
  "DISCORD_CLIENT_SECRET",
  "DYOOR_TRAIT_LAB_SECRET",
  "ENERGY_BANK_OPERATOR_PRIVATE_KEY",
  "ENERGY_CREDIT_SIGNER_PRIVATE_KEY",
  "ENERGY_RECONCILIATION_AUTOMATION_SECRET",
  "GITHUB_TOKEN",
  "MONADSCAN_API_KEY",
  "NETLIFY_BLOBS_TOKEN",
  "OPENSEA_API_KEY",
  "SUPABASE_SERVICE_ROLE",
  "VERIFY_SESSION_SECRET",
];
const OPTIONAL_PROTECT_KEYS = [
  "DYOOR_WORLD_SESSION_SECRET",
];
const ALL_PROTECT_KEYS = [...PROTECT_KEYS, ...OPTIONAL_PROTECT_KEYS];

if (process.env.APPLY_NETLIFY_ENV_CLEANUP !== "1") {
  throw new Error(
    "Refusing to modify Netlify. Set APPLY_NETLIFY_ENV_CLEANUP=1 explicitly.",
  );
}

function contextKey(value) {
  return `${value.context}:${value.context_parameter || ""}`;
}

function secretCompatibleValues(values) {
  const output = new Map();
  const allValue = values.find((entry) => entry.context === "all")?.value;
  if (allValue !== undefined) {
    for (const context of ["production", "deploy-preview", "branch-deploy"]) {
      output.set(`${context}:`, { context, value: allValue });
    }
    output.set("dev:", { context: "dev", value: "" });
  }

  for (const entry of values) {
    if (entry.context === "all") continue;
    const value = {
      context: entry.context,
      ...(entry.context_parameter
        ? { context_parameter: entry.context_parameter }
        : {}),
      value: entry.context === "dev" ? "" : entry.value,
    };
    output.set(contextKey(value), value);
  }

  const normalized = [...output.values()];
  if (
    normalized.length === 0
      || !normalized.some(
        (entry) => entry.context !== "dev" && String(entry.value || "").length > 0,
      )
  ) {
    throw new Error("No non-development value is available to protect.");
  }
  return normalized;
}

const token = await getAPIToken();
if (!token) {
  throw new Error("No authenticated Netlify API token is available.");
}
const api = new NetlifyAPI(token);
const site = await api.getSite({ siteId: SITE_ID });
if (site.id !== SITE_ID || !site.account_slug) {
  throw new Error(`Could not resolve the expected Netlify site ${SITE_ID}.`);
}
const accountId = site.account_slug;
let variables = await api.getEnvVars({ accountId, siteId: SITE_ID });
const failures = [];
const protectedKeys = [];
const removedKeys = [];

for (const key of ALL_PROTECT_KEYS) {
  const existing = variables.find((entry) => entry.key === key);
  if (!existing) {
    if (OPTIONAL_PROTECT_KEYS.includes(key)) continue;
    failures.push(`${key}: variable is missing`);
    continue;
  }
  if (existing.is_secret) {
    protectedKeys.push(key);
    continue;
  }

  try {
    await api.updateEnvVar({
      accountId,
      siteId: SITE_ID,
      key,
      body: {
        key,
        is_secret: true,
        scopes: SECRET_SCOPES,
        values: secretCompatibleValues(existing.values || []),
      },
    });
    protectedKeys.push(key);
    console.log(`Protected ${key} as a Netlify secret.`);
  } catch (error) {
    failures.push(`${key}: ${error?.json?.message || error?.message || error}`);
  }
}

for (const [key, reason] of REMOVE_KEYS) {
  const existing = variables.find((entry) => entry.key === key);
  if (!existing) {
    removedKeys.push(key);
    continue;
  }

  try {
    await api.deleteEnvVar({ accountId, siteId: SITE_ID, key });
    removedKeys.push(key);
    console.log(`Removed ${key}. ${reason}`);
  } catch (error) {
    failures.push(`${key}: ${error?.json?.message || error?.message || error}`);
  }
}

variables = await api.getEnvVars({ accountId, siteId: SITE_ID });
for (const key of ALL_PROTECT_KEYS) {
  const variable = variables.find((entry) => entry.key === key);
  if (!variable && OPTIONAL_PROTECT_KEYS.includes(key)) continue;
  if (!variable?.is_secret) {
    failures.push(`${key}: secret classification did not verify`);
  } else if ((variable.scopes || []).includes("post_processing")) {
    failures.push(`${key}: secret still has the post-processing scope`);
  }
}
for (const key of REMOVE_KEYS.keys()) {
  if (variables.some((entry) => entry.key === key)) {
    failures.push(`${key}: deletion did not verify`);
  }
}

if (failures.length > 0) {
  throw new Error(`Netlify cleanup was incomplete:\n- ${failures.join("\n- ")}`);
}

console.log(JSON.stringify({
  ok: true,
  siteId: SITE_ID,
  siteName: site.name,
  protectedKeys,
  removedKeys,
  valuesPrinted: false,
}, null, 2));
