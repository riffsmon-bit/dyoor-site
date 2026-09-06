const DEFAULTS = Object.freeze({
  guildId: "1462783318004338837",
  clientId: "1488722061038715101",
  dyoorifiedRoleId: "1463877305171710063",
  season1RoleId: "1463876633743200342",
  ascendedRoleId: "1463876629544701992",
  season2RoleId: "1536568854413713438",
  hoodyoorRoleId: "1536568855332130916",
  season1Address: "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f",
  ascensionAddress: "0xf9611226c1ccccca37951938d6f358d3d5106549",
  season2Address: "0x349d8eb480c92cf75371fba5c6344a4d11b9103a",
  hoodyoorAddress: "0x8277f8126722b11d7b44c5c453bcf62a78aafa25",
});

function readEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function required(label, ...names) {
  const value = readEnv(...names);
  if (!value) throw Object.assign(new Error(`${label} is not configured.`), { status: 503 });
  return value;
}

function positiveNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function getVerifyConfig() {
  const configuredRedirectUri = readEnv("DISCORD_REDIRECT_URI");
  let redirectOrigin = "";
  if (configuredRedirectUri) {
    try {
      redirectOrigin = new URL(configuredRedirectUri).origin;
    } catch {
      throw Object.assign(new Error("The Discord OAuth redirect URI is invalid."), { status: 503 });
    }
  }
  const configuredBaseUrl = (
    readEnv("DYOOR_VERIFY_BASE_URL", "NEXT_PUBLIC_SITE_URL")
    || redirectOrigin
    || required("The production site URL", "URL", "DEPLOY_PRIME_URL")
  ).replace(/\/+$/, "");
  let baseUrl = "";
  try {
    const parsed = new URL(configuredBaseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("HTTPS is required.");
    baseUrl = parsed.origin;
  } catch {
    throw Object.assign(new Error("The verification site URL is invalid."), { status: 503 });
  }
  const redirectUri = configuredRedirectUri
    || `${baseUrl}/.netlify/functions/discord-oauth-callback`;
  if (new URL(redirectUri).origin !== baseUrl) {
    throw Object.assign(new Error("The verification site and Discord redirect origins do not match."), { status: 503 });
  }
  return {
    baseUrl,
    discord: {
      clientId: readEnv("DISCORD_CLIENT_ID") || DEFAULTS.clientId,
      clientSecret: required("The Discord OAuth client secret", "DISCORD_CLIENT_SECRET"),
      botToken: required("The Discord bot token", "DISCORD_BOT_TOKEN"),
      guildId: readEnv("DISCORD_GUILD_ID") || DEFAULTS.guildId,
      redirectUri,
      roles: {
        dyoorified: readEnv("DYOORIFIED_ROLE_ID") || DEFAULTS.dyoorifiedRoleId,
        season1: readEnv("HOLDER_ROLE_ID", "SEASON_1_ROLE_ID") || DEFAULTS.season1RoleId,
        ascended: readEnv("ASCENDED_ROLE_ID") || DEFAULTS.ascendedRoleId,
        season2: readEnv("SEASON_2_ROLE_ID") || DEFAULTS.season2RoleId,
        hoodyoor: readEnv("HOODYOOR_ROLE_ID") || DEFAULTS.hoodyoorRoleId,
      },
    },
    session: {
      secret: required("The verification session secret", "VERIFY_SESSION_SECRET"),
      cookieName: readEnv("VERIFY_SESSION_COOKIE") || "dyoor_verify_session",
      ttlMs: positiveNumber(readEnv("VERIFY_SESSION_TTL_SECONDS"), 43_200, 900, 2_592_000) * 1000,
      nonceTtlMs: positiveNumber(readEnv("VERIFY_NONCE_TTL_SECONDS"), 300, 60, 900) * 1000,
    },
    storage: {
      siteId: required(
        "The Netlify Blobs site ID",
        "NETLIFY_BLOBS_SITE_ID",
        "NETLIFY_SITE_ID",
        "SITE_ID",
      ),
      token: required(
        "The Netlify Blobs token",
        "NETLIFY_BLOBS_TOKEN",
        "NETLIFY_ACCESS_TOKEN",
        "NETLIFY_AUTH_TOKEN",
      ),
    },
    chains: {
      monad: {
        id: 143,
        rpcUrl: readEnv(
          "MONAD_RPC_URL",
          "RPC_URL",
          "ALCHEMY_MONAD_RPC_URL",
          "DYOOR_S2_RPC_URL",
          "NEXT_PUBLIC_MONAD_RPC_URL",
        ) || "https://rpc.monad.xyz",
      },
      robinhood: {
        id: 4663,
        rpcUrl: readEnv(
          "ROBINHOOD_RPC_URL",
          "HOODYOOR_RPC_URL",
          "NEXT_PUBLIC_ROBINHOOD_RPC_URL",
        ) || "https://rpc.mainnet.chain.robinhood.com",
      },
    },
    contracts: {
      season1: readEnv("S1_COLLECTION_ADDRESS", "SEASON_1_CONTRACT") || DEFAULTS.season1Address,
      ascended: readEnv("ASCENSION_CONTRACT_ADDRESS", "ASCENSION_STAKING_CONTRACT") || DEFAULTS.ascensionAddress,
      season2: readEnv("SEASON_2_CONTRACT") || DEFAULTS.season2Address,
      hoodyoor: readEnv("HOODYOOR_CONTRACT") || DEFAULTS.hoodyoorAddress,
    },
    sync: {
      concurrency: positiveNumber(readEnv("HOLDER_SYNC_CONCURRENCY"), 4, 1, 10),
      graceMs: positiveNumber(readEnv("HOLDER_GRACE_PERIOD_HOURS"), 24, 1, 168) * 60 * 60 * 1000,
      rpcTimeoutMs: positiveNumber(readEnv("RPC_TIMEOUT_MS"), 10_000, 1_000, 30_000),
      cronSecret: readEnv("DISCORD_SYNC_SECRET"),
    },
  };
}

export const verifyDefaults = DEFAULTS;
