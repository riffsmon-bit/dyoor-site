import type { DroidProtocolConfig } from "@/lib/droid-accounts/types";

export function droidActivationAllowed(
  config: Pick<
    DroidProtocolConfig,
    "activationEnabled" | "activationMode" | "activationTokenIds"
  >,
  tokenId: number,
) {
  if (!config.activationEnabled) return false;
  if (config.activationMode === "general") return true;
  return config.activationMode === "allowlist"
    && config.activationTokenIds.includes(tokenId);
}
