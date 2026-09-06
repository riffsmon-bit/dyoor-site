// Public presentation flag only, never a wallet/financial authorization gate.
export function droidOsPreviewEnabled(environment) {
  const context = environment.CONTEXT || "";
  return environment.DROID_OS_UI_PREVIEW === "true"
    && (context === "deploy-preview" || context === "");
}

// Netlify rewrites the request's internal host. Pin the public audience at build
// time instead of trusting Host/X-Forwarded-Host or accepting other previews.
export function droidOsPreviewOrigin(environment) {
  if (!droidOsPreviewEnabled(environment) || environment.CONTEXT !== "deploy-preview") return "";
  const value = String(environment.DEPLOY_PRIME_URL || "");
  return /^https:\/\/deploy-preview-[0-9]+--dyoor\.netlify\.app\/?$/.test(value) ? new URL(value).origin : "";
}
