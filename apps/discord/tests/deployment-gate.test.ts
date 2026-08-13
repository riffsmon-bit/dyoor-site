import { describe, expect, it } from "vitest";
import {
  blockingPlanFailures,
  temporaryAdminMigrationEnabled,
} from "../src/discord/deployment-gate.js";
import type { PlanAction } from "../src/discord/plan.js";

const administratorFailure: PlanAction = {
  operation: "FAIL",
  resource: "PERMISSIONS",
  name: "DYOOR Verification",
  detail: "Administrator is prohibited for the DYØØR bot",
};

describe("Discord deployment migration gate", () => {
  it("requires the exact approved guild ID", () => {
    expect(temporaryAdminMigrationEnabled("1462783318004338837", "1462783318004338837")).toBe(true);
    expect(temporaryAdminMigrationEnabled("wrong", "1462783318004338837")).toBe(false);
  });

  it("allows only the exact temporary Administrator failure", () => {
    expect(blockingPlanFailures([administratorFailure], "DYOOR Verification", true)).toEqual([]);
    expect(blockingPlanFailures([administratorFailure], "DYOOR Verification", false)).toEqual([
      administratorFailure,
    ]);
  });

  it("never suppresses unrelated deployment failures", () => {
    const unrelated: PlanAction = {
      operation: "FAIL",
      resource: "SERVER",
      name: "Moderator 2FA",
      detail: "not required",
    };
    expect(
      blockingPlanFailures([administratorFailure, unrelated], "DYOOR Verification", true),
    ).toEqual([unrelated]);
  });
});
