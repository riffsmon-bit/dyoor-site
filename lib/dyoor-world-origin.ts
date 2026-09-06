const DEFAULT_DYOOR_WORLD_ORIGINS = [
  "https://dyoor.fun",
  "https://www.dyoor.fun",
];

function normalizeHttpOrigin(value: unknown) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : "";
  } catch {
    return "";
  }
}

export function dyoorWorldAllowedOrigins(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
) {
  const allowed = new Set(DEFAULT_DYOOR_WORLD_ORIGINS);
  for (const name of [
    "DYOOR_WORLD_ALLOWED_ORIGINS",
    "NEXT_PUBLIC_SITE_URL",
    "SITE_URL",
    "URL",
    "DEPLOY_PRIME_URL",
  ]) {
    for (const value of String(environment[name] || "").split(",")) {
      const origin = normalizeHttpOrigin(value);
      if (origin) allowed.add(origin);
    }
  }

  const requestUrl = new URL(request.url);
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(requestUrl.hostname)) {
    allowed.add(requestUrl.origin);
  }
  return allowed;
}

/**
 * Returns the exact host to bind into the signed challenge, or null when the
 * browser origin is absent/malformed/not explicitly trusted. There is no
 * unrestricted Netlify wildcard: only this site's permanent alias, immutable
 * deploy IDs, numbered deploy previews, or an exact configured URL may pass.
 */
export function dyoorWorldRequestAudience(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
) {
  const suppliedOrigin = normalizeHttpOrigin(request.headers.get("origin"));
  if (!suppliedOrigin) return null;
  const suppliedUrl = new URL(suppliedOrigin);
  const isDyoorDeployOrigin = suppliedUrl.protocol === "https:"
    && /^(?:[a-f0-9]{24}|deploy-preview-\d+)--dyoor\.netlify\.app$/i.test(suppliedUrl.hostname);
  if (!isDyoorDeployOrigin && !dyoorWorldAllowedOrigins(request, environment).has(suppliedOrigin)) {
    return null;
  }
  return suppliedUrl.host.toLowerCase();
}
