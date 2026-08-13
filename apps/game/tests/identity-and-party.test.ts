import { describe, expect, it } from "vitest";
import {
  MOCK_HOLDER_DROIDS,
  TRAINING_DROID,
} from "../src/data/characters";
import { GameSession } from "../src/services/GameSession";
import {
  applyProtocolVitals,
  createPlayerIdentity,
  miningEnergyForProtocol,
  normalizeCallsign,
} from "../src/systems/identity/FieldProtocol";
import {
  createDefaultSave,
  normalizeSave,
} from "../src/systems/save/SaveSchema";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) || null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("field identity and party", () => {
  it("normalizes callsigns and applies deterministic protocol bonuses", () => {
    expect(normalizeCallsign("  riffs dyoor! ")).toBe("RIFFS-DYOOR");
    expect(createPlayerIdentity("", "unknown").protocol).toBe("prospector");
    expect(applyProtocolVitals({
      health: 100,
      maxHealth: 100,
      energy: 60,
      maxEnergy: 100,
    }, "vanguard")).toMatchObject({
      health: 115,
      maxHealth: 115,
      maxEnergy: 100,
    });
    expect(applyProtocolVitals({
      health: 100,
      maxHealth: 100,
      energy: 60,
      maxEnergy: 100,
    }, "relay")).toMatchObject({
      energy: 75,
      maxEnergy: 115,
    });
    expect(miningEnergyForProtocol("prospector")).toBe(15);
  });

  it("creates a capped holder party with the selected droid active", () => {
    const [active, reserve] = MOCK_HOLDER_DROIDS;
    const save = createDefaultSave("wallet", active!, {
      identity: { callsign: "Riffs", protocol: "relay" },
      party: [active!, reserve!, reserve!, active!],
    });
    expect(save.identity).toEqual({ callsign: "RIFFS", protocol: "relay" });
    expect(save.character.id).toBe(active!.id);
    expect(save.party.activeDroidId).toBe(active!.id);
    expect(save.party.members.map((member) => member.id)).toEqual([
      active!.id,
      reserve!.id,
    ]);
  });

  it("does not let a tampered guest save impersonate a token holder", () => {
    const tampered = {
      ...createDefaultSave(),
      character: MOCK_HOLDER_DROIDS[0],
      party: {
        activeDroidId: MOCK_HOLDER_DROIDS[0]!.id,
        members: MOCK_HOLDER_DROIDS,
      },
    };
    const normalized = normalizeSave(tampered);
    expect(normalized?.mode).toBe("guest");
    expect(normalized?.character).toEqual(TRAINING_DROID);
    expect(normalized?.party.members).toEqual([TRAINING_DROID]);
  });

  it("switches only between members already admitted to the local party", () => {
    const [active, reserve] = MOCK_HOLDER_DROIDS;
    const session = new GameSession();
    session.initialize(new MemoryStorage());
    session.start("wallet", active!, {
      party: [active!, reserve!],
    });
    expect(session.setActivePartyMember("not-in-party")).toBeNull();
    expect(session.setActivePartyMember(reserve!.id)?.id).toBe(reserve!.id);
    expect(session.state.character.id).toBe(reserve!.id);
    expect(session.state.party.activeDroidId).toBe(reserve!.id);
  });
});
