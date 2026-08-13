import { describe, expect, it } from "vitest";
import { TRAINING_DROID } from "../src/data/characters";
import { SaveService } from "../src/services/SaveService";
import { createDefaultSave, normalizeSave, SAVE_KEY } from "../src/systems/save/SaveSchema";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) || null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("guest mode and local save", () => {
  it("starts with a clearly generic non-token training droid", () => {
    const save = createDefaultSave();
    expect(save.mode).toBe("guest");
    expect(save.character).toEqual(TRAINING_DROID);
    expect(save.character.tokenId).toBeNull();
    expect(save.coreEmission.tier).toBe("common");
    expect(save.coreEmission.energyPerHour).toBe(10);
    expect(save.coreEmission.bankedEnergy).toBe(0);
    expect(save.quest.energyMining).toEqual({
      stage: "locked",
      collectedNodeIds: [],
    });
  });

  it("round-trips a validated save and rejects unknown versions", () => {
    const storage = new MemoryStorage();
    const service = new SaveService(storage);
    service.save(createDefaultSave());
    expect(service.load()?.version).toBe(1);
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 999 }));
    expect(service.load()).toBeNull();
    expect(normalizeSave({ version: 1, inventory: { "../escape": 5 } })?.inventory).toEqual({});
  });
});
