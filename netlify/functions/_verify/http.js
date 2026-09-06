import crypto from "node:crypto";
import { getVerifyConfig } from "./config.js";

export function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export function redirect(location, extraHeaders = {}) {
  return {
    statusCode: 302,
    headers: { location, "cache-control": "no-store", ...extraHeaders },
    body: "",
  };
}

export function parseBody(event) {
  try {
    return JSON.parse(event?.body || "{}");
  } catch {
    throw Object.assign(new Error("The request body is not valid JSON."), { status: 400 });
  }
}

function parseCookies(cookieHeader = "") {
  const cookies = {};
  for (const part of cookieHeader.split(/;\s*/)) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    try {
      cookies[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
    } catch {}
  }
  return cookies;
}

function hmac(value) {
  return crypto.createHmac("sha256", getVerifyConfig().session.secret).update(value).digest("hex");
}

function equal(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function buildSessionCookie(sessionId) {
  const config = getVerifyConfig();
  const value = `${sessionId}.${hmac(sessionId)}`;
  return [
    `${config.session.cookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.floor(config.session.ttlMs / 1000)}`,
  ].join("; ");
}

const OAUTH_STATE_COOKIE = "dyoor_verify_oauth_state";

export function buildOAuthStateCookie(state) {
  const value = `${state}.${hmac(`oauth:${state}`)}`;
  return [
    `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/.netlify/functions/discord-oauth-callback",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=600",
  ].join("; ");
}

export function clearOAuthStateCookie() {
  return [
    `${OAUTH_STATE_COOKIE}=`,
    "Path=/.netlify/functions/discord-oauth-callback",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

export function readOAuthStateCookie(event) {
  const cookies = parseCookies(event?.headers?.cookie || event?.headers?.Cookie || "");
  const [state, signature, ...extra] = String(cookies[OAUTH_STATE_COOKIE] || "").split(".");
  if (
    !/^[a-f0-9]{48}$/.test(state || "")
    || !signature
    || extra.length
    || !equal(hmac(`oauth:${state}`), signature)
  ) return "";
  return state;
}

export function clearSessionCookie() {
  const { cookieName } = getVerifyConfig().session;
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSessionId(event) {
  const { cookieName } = getVerifyConfig().session;
  const cookies = parseCookies(event?.headers?.cookie || event?.headers?.Cookie || "");
  const [sessionId, signature, ...extra] = String(cookies[cookieName] || "").split(".");
  if (!sessionId || !signature || extra.length || !equal(hmac(sessionId), signature)) return "";
  return /^[a-f0-9]{48}$/.test(sessionId) ? sessionId : "";
}

export function safeReturnTo(value) {
  const candidate = String(value || "/discord/verify").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return "/discord/verify";
  }
  try {
    const parsed = new URL(candidate, "https://dyoor.fun");
    return `${parsed.pathname}${parsed.search}`.slice(0, 500);
  } catch {
    return "/discord/verify";
  }
}

export function assertMethod(event, ...methods) {
  const method = String(event?.httpMethod || "GET").toUpperCase();
  if (!methods.includes(method)) {
    throw Object.assign(new Error("Method not allowed."), { status: 405 });
  }
}

export function assertSameOrigin(event) {
  const config = getVerifyConfig();
  const supplied = String(event?.headers?.origin || event?.headers?.Origin || "").replace(/\/+$/, "");
  if (!supplied || supplied !== config.baseUrl) {
    throw Object.assign(new Error("This verification request came from an untrusted origin."), { status: 403 });
  }
}

export function safeHandlerError(error, fallback = "Verification could not be completed.") {
  const status = Number(error?.status || 500);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  return json(safeStatus, {
    ok: false,
    error: safeStatus >= 500 ? fallback : String(error?.message || fallback),
  });
}
