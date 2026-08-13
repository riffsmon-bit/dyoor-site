import { describe, expect, it } from "vitest";
import { INDUSTRIAL_WASTES_MAP, LABORATORY_MAP, isMapTileWalkable } from "../src/data/maps";
import { addItem, removeItem } from "../src/systems/inventory/Inventory";
import {
  advanceCoreRecovery,
  advanceEnergyMining,
} from "../src/systems/quest/QuestEngine";

describe("quest progression", () => {
  it("requires start, collection, and return in order", () => {
    const start = advanceCoreRecovery("not_started", "talk_to_scientist");
    const collect = advanceCoreRecovery(start.stage, "collect_energy_core");
    const complete = advanceCoreRecovery(collect.stage, "return_energy_core");
    expect([start.stage, collect.stage, complete.stage]).toEqual([
      "active",
      "core_collected",
      "complete",
    ]);
    expect(advanceCoreRecovery("not_started", "return_energy_core").changed).toBe(false);
  });

  it("unlocks a three-node mining survey after Core Recovery", () => {
    const unlocked = advanceEnergyMining(
      { stage: "locked", collectedNodeIds: [] },
      "unlock",
    );
    const accepted = advanceEnergyMining(unlocked.state, "accept");
    const first = advanceEnergyMining(accepted.state, "collect_node", "seam-north");
    const duplicate = advanceEnergyMining(first.state, "collect_node", "seam-north");
    const second = advanceEnergyMining(first.state, "collect_node", "seam-west");
    const third = advanceEnergyMining(second.state, "collect_node", "seam-south");
    const complete = advanceEnergyMining(third.state, "turn_in");
    expect(unlocked.state.stage).toBe("available");
    expect(accepted.state.stage).toBe("active");
    expect(duplicate.changed).toBe(false);
    expect(third.state).toEqual({
      stage: "ready",
      collectedNodeIds: ["seam-north", "seam-west", "seam-south"],
    });
    expect(complete.state.stage).toBe("complete");
  });

  it("consumes the recovered core when it becomes a stabilized quest item", () => {
    const collected = addItem({}, "energy-core", 1);
    const consumed = removeItem(collected, "energy-core", 1);
    expect(consumed).toEqual({ inventory: {}, removed: true });
    expect(addItem(consumed.inventory, "stabilized-core", 1)).toEqual({
      "stabilized-core": 1,
    });
  });
});

describe("map collision data", () => {
  it("blocks walls while keeping both transition doors walkable", () => {
    expect(isMapTileWalkable(LABORATORY_MAP, 0, 0)).toBe(false);
    expect(isMapTileWalkable(LABORATORY_MAP, 13, 19)).toBe(true);
    expect(isMapTileWalkable(INDUSTRIAL_WASTES_MAP, 14, 0)).toBe(true);
    expect(isMapTileWalkable(INDUSTRIAL_WASTES_MAP, -1, 0)).toBe(false);
  });
});
