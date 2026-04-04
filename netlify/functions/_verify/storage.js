const { getStore } = require('@netlify/blobs');

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

const siteID = readEnv(
  'NETLIFY_BLOBS_SITE_ID',
  'NETLIFY_SITE_ID',
  'SITE_ID'
);

const token = readEnv(
  'NETLIFY_BLOBS_TOKEN',
  'NETLIFY_ACCESS_TOKEN',
  'NETLIFY_AUTH_TOKEN'
);

if (!siteID || !token) {
  throw new Error(
    `Netlify Blobs is not configured. Missing siteID/token. ` +
    `Got siteID=${siteID ? 'yes' : 'no'} token=${token ? 'yes' : 'no'}. ` +
    `Set NETLIFY_BLOBS_SITE_ID and NETLIFY_BLOBS_TOKEN in Netlify env vars.`
  );
}

const store = getStore({
  name: 'dyoor-verify',
  siteID,
  token,
  consistency: 'strong'
});

async function getJson(key, fallback = null) {
  const value = await store.get(key, { type: 'json', consistency: 'strong' });
  return value ?? fallback;
}

async function setJson(key, value) {
  await store.setJSON(key, value);
}

async function deleteKey(key) {
  await store.delete(key);
}

async function listByPrefix(prefix) {
  const results = [];
  let cursor;

  do {
    const page = await store.list({ prefix, cursor });
    for (const blob of page.blobs || []) {
      results.push(blob.key);
    }
    cursor = page.cursor;
  } while (cursor);

  return results;
}

module.exports = {
  getJson,
  setJson,
  deleteKey,
  listByPrefix,
};