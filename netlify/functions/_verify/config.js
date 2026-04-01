const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const optional = (name, fallback = '') => process.env[name] || fallback;

module.exports = {
  appBaseUrl: optional('URL', '').replace(/\/$/, ''),
  discordClientId: required('DISCORD_CLIENT_ID'),
  discordClientSecret: required('DISCORD_CLIENT_SECRET'),
  discordBotToken: required('DISCORD_BOT_TOKEN'),
  discordGuildId: required('DISCORD_GUILD_ID'),
  discordRedirectUri: required('DISCORD_REDIRECT_URI'),
  sessionSecret: required('VERIFY_SESSION_SECRET'),

  rpcUrl: required('RPC_URL'),
  chainId: Number(required('CHAIN_ID')),
  s1CollectionAddress: required('S1_COLLECTION_ADDRESS'),
  ascensionContractAddress: required('ASCENSION_CONTRACT_ADDRESS'),
  scanFromBlock: BigInt(optional('SCAN_FROM_BLOCK', '0')),

  holderRoleId: required('HOLDER_ROLE_ID'),
  ascendedRoleId: required('ASCENDED_ROLE_ID'),
  twentyPlusRoleId: required('TWENTY_PLUS_ROLE_ID'),
  fiftyPlusRoleId: required('FIFTY_PLUS_ROLE_ID'),

  // optional explicit Blobs config
  netlifyBlobsSiteId: optional('NETLIFY_BLOBS_SITE_ID', optional('NETLIFY_SITE_ID', '')),
  netlifyBlobsToken: optional('NETLIFY_BLOBS_TOKEN', ''),

  sessionCookieName: optional('VERIFY_SESSION_COOKIE', 'dyoor_verify_session'),
  nonceTtlSeconds: Number(optional('VERIFY_NONCE_TTL_SECONDS', '900')),
};