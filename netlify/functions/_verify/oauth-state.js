const crypto = require('crypto');
const { getJson, setJson, deleteKey } = require('./storage');

async function createOAuthState(returnTo = '/') {
  const state = crypto.randomBytes(18).toString('hex');
  await setJson(`oauth:${state}`, {
    returnTo,
    createdAt: Date.now(),
  });
  return state;
}

async function consumeOAuthState(state) {
  if (!state) return null;
  const key = `oauth:${state}`;
  const payload = await getJson(key, null);
  await deleteKey(key);
  return payload;
}

module.exports = {
  createOAuthState,
  consumeOAuthState,
};
