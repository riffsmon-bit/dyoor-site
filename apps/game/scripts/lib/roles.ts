import type { GameRole, PublicDroidRegistryRecord } from "./classification";

export type RoleOverride = {
  gameRole?: GameRole;
  region?: string | null;
  recruitable?: boolean;
  notes?: string;
};

export function applyManualRoleOverride(
  record: PublicDroidRegistryRecord,
  override: RoleOverride | undefined,
) {
  if (!override) return { ...record };
  return {
    ...record,
    gameRole: override.gameRole || record.gameRole,
    region: "region" in override ? override.region ?? null : record.region,
    recruitable: typeof override.recruitable === "boolean"
      ? override.recruitable
      : record.recruitable,
  };
}
