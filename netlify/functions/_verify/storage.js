const { getStore } = require('@netlify/blobs');

const siteID = process.env.NETLIFY_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || '';
const token = process.env.NETLIFY_BLOBS_TOKEN || '';

const storeOptions = {};
if (siteID) storeOptions.siteID = siteID;
if (token) storeOptions.token = token;

const store = getStore('dyoor-verify', storeOptions);

async function getJson(key, fallback = null) {
  const value = await store.get(key, { type: 'json' });
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