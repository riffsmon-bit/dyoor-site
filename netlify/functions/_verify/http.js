const crypto = require('crypto');
const { sessionSecret, sessionCookieName } = require('./config');

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function redirect(location, extraHeaders = {}) {
  return {
    statusCode: 302,
    headers: {
      location,
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body: '',
  };
}

function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of cookieHeader.split(/;\s*/)) {
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx);
    const val = part.slice(idx + 1);
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function signSession(sessionId) {
  return crypto.createHmac('sha256', sessionSecret).update(sessionId).digest('hex');
}

function buildSessionCookie(sessionId) {
  const value = `${sessionId}.${signSession(sessionId)}`;
  return `${sessionCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readSessionId(event) {
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie || '');
  const raw = cookies[sessionCookieName];
  if (!raw) return null;
  const [sessionId, sig] = String(raw).split('.');
  if (!sessionId || !sig) return null;
  if (signSession(sessionId) !== sig) return null;
  return sessionId;
}

module.exports = {
  json,
  redirect,
  parseCookies,
  buildSessionCookie,
  clearSessionCookie,
  readSessionId,
};
