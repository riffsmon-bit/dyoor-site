import type { PlanAction } from "./plan.js";

const temporaryAdministratorDetail = "Administrator is prohibited for the DYØØR bot";

export function temporaryAdminMigrationEnabled(value: string | undefined, guildId: string) {
  return value === guildId;
}

export function isTemporaryAdministratorFailure(action: PlanAction, botRoleName: string) {
  return (
    action.operation === "FAIL" &&
    action.resource === "PERMISSIONS" &&
    action.name === botRoleName &&
    action.detail === temporaryAdministratorDetail
  );
}

export function blockingPlanFailures(
  actions: readonly PlanAction[],
  botRoleName: string,
  allowTemporaryAdministrator: boolean,
) {
  return actions.filter(
    (action) =>
      action.operation === "FAIL" &&
      (!allowTemporaryAdministrator || !isTemporaryAdministratorFailure(action, botRoleName)),
  );
}
