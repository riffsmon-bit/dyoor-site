// Public presentation flag only, never a wallet/financial authorization gate.
export function droidOsPreviewEnabled(environment) {
  const context = environment.CONTEXT || "";
  return environment.DROID_OS_UI_PREVIEW === "true"
    && (context === "deploy-preview" || context === "");
}
