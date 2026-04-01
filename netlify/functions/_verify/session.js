const crypto = require('crypto');
const { getJson, setJson } = require('./storage');
const { readSessionId } = require('./http');

async function createSession(data = {}) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  await setJson(`session:${sessionId}`, {
    ...data,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return sessionId;
}

async function getSessionById(sessionId) {
  if (!sessionId) return null;
  return getJson(`session:${sessionId}`, null);
}

async function updateSession(sessionId, patch) {
  const existing = (await getSessionById(sessionId)) || {};
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  await setJson(`session:${sessionId}`, next);
  return next;
}

async function getSessionFromEvent(event) {
  const sessionId = readSessionId(event);
  if (!sessionId) return { sessionId: null, session: null };
  const session = await getSessionById(sessionId);
  return { sessionId, session };
}

module.exports = {
  createSession,
  getSessionById,
  updateSession,
  getSessionFromEvent,
};
