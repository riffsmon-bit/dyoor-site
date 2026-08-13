import { describe, expect, it } from "vitest";
import { CORRUPTED_SCOUT } from "../src/data/characters";
import { BattleEngine } from "../src/systems/battle/BattleEngine";

const vitals = { health: 100, maxHealth: 100, energy: 60, maxEnergy: 100 };

describe("battle state transitions", () => {
  it("spends Energy for pulse and reaches victory deterministically", () => {
    const engine = new BattleEngine(vitals, { ...CORRUPTED_SCOUT, maxHealth: 20 }, () => 0.99);
    const result = engine.act("pulse");
    expect(result.playerEnergy).toBe(48);
    expect(result.status).toBe("victory");
  });

  it("reduces incoming damage while guarding", () => {
    const engine = new BattleEngine(vitals, CORRUPTED_SCOUT, () => 0.99);
    const result = engine.act("guard");
    expect(result.playerHealth).toBeGreaterThan(89);
    expect(result.playerEnergy).toBe(68);
  });

  it("can transition to defeat", () => {
    const engine = new BattleEngine({ ...vitals, health: 1 }, CORRUPTED_SCOUT, () => 0.99);
    expect(engine.act("strike").status).toBe("defeat");
  });

  it("trades Energy and feedback HP for a high-output Overclock", () => {
    const engine = new BattleEngine(vitals, CORRUPTED_SCOUT, () => 0);
    const result = engine.act("overclock");
    expect(result.playerEnergy).toBe(40);
    expect(result.playerHealth).toBeLessThan(96);
    expect(result.enemyHealth).toBe(28);
    expect(result.log[0]).toContain("Overclock");
  });
});
