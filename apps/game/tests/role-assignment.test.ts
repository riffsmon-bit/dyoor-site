import { describe, expect, it } from "vitest";
import { registryRecord } from "../scripts/lib/classification";
import { applyManualRoleOverride } from "../scripts/lib/roles";
import { normalizeMetadataRecord } from "../scripts/lib/metadata";
import { metadataFixture } from "./fixtures";

describe("manual role overrides", () => {
  it("always takes priority over generated defaults", () => {
    const record = registryRecord(
      1100,
      "unminted",
      123,
      normalizeMetadataRecord(1100, metadataFixture(1100)),
    );
    const overridden = applyManualRoleOverride(record, {
      gameRole: "faction_leader",
      region: "Core Laboratory",
      recruitable: true,
    });
    expect(overridden.gameRole).toBe("faction_leader");
    expect(overridden.region).toBe("Core Laboratory");
    expect(overridden.recruitable).toBe(true);
  });
});
