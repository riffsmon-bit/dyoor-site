import { TRAINING_DROID } from "../data/characters";
import { addItem, removeItem } from "../systems/inventory/Inventory";
import {
  addEmissionEnergy,
  normalizeCoreEmission,
} from "../systems/emission/CoreEmission";
import { miningEnergyForProtocol } from "../systems/identity/FieldProtocol";
import { advanceEnergyMining } from "../systems/quest/QuestEngine";
import { createDefaultSave } from "../systems/save/SaveSchema";
import type {
  CharacterProfile,
  Direction,
  GameMode,
  GameSave,
  MapId,
  MiningQuestStage,
  PlayerIdentity,
  QuestStage,
} from "../types/game";
import { SaveService, type StoragePort } from "./SaveService";

export class GameSession {
  private saveService: SaveService | null = null;
  private current: GameSave = createDefaultSave();

  initialize(storage: StoragePort) {
    this.saveService = new SaveService(storage);
  }

  hasSave() {
    return Boolean(this.saveService?.hasSave());
  }

  load() {
    const loaded = this.saveService?.load();
    if (loaded) this.current = loaded;
    return loaded;
  }

  start(
    mode: GameMode,
    character: CharacterProfile = TRAINING_DROID,
    options: {
      identity?: Partial<PlayerIdentity>;
      party?: CharacterProfile[];
    } = {},
  ) {
    this.current = createDefaultSave(mode, character, options);
    this.persist();
    return this.state;
  }

  get state(): GameSave {
    return structuredClone(this.current);
  }

  updateLocation(mapId: MapId, x: number, y: number, direction: Direction) {
    this.current.location = { mapId, x, y, direction };
    this.persist();
  }

  setQuestStage(stage: QuestStage) {
    this.current.quest.coreRecovery = stage;
    this.persist();
  }

  setMiningQuestStage(stage: MiningQuestStage) {
    this.current.quest.energyMining.stage = stage;
    this.persist();
  }

  collectMiningNode(nodeId: string) {
    const transition = advanceEnergyMining(
      this.current.quest.energyMining,
      "collect_node",
      nodeId,
    );
    if (!transition.changed) return false;
    this.current.quest.energyMining = transition.state;
    this.current.coreEmission = addEmissionEnergy(
      this.current.coreEmission,
      miningEnergyForProtocol(this.current.identity.protocol),
    );
    this.current.inventory = addItem(this.current.inventory, "energy-ore", 1);
    this.persist();
    return true;
  }

  setPartyMembers(members: CharacterProfile[]) {
    const unique = new Map<string, CharacterProfile>();
    unique.set(this.current.character.id, this.current.character);
    for (const member of members) {
      if (this.current.mode === "wallet" && !member.tokenId) continue;
      if (!unique.has(member.id)) unique.set(member.id, structuredClone(member));
      if (unique.size >= 3) break;
    }
    this.current.party = {
      activeDroidId: this.current.character.id,
      members: [...unique.values()],
    };
    this.persist();
  }

  setActivePartyMember(memberId: string) {
    const profile = this.current.party.members.find((member) => member.id === memberId);
    if (!profile) return null;
    if (this.current.mode === "wallet" && !profile.tokenId) return null;
    if (profile.id === this.current.character.id) return structuredClone(profile);

    const now = Date.now();
    this.current.coreEmission = normalizeCoreEmission(
      this.current.coreEmission,
      this.current.character,
      now,
    );
    this.current.character = structuredClone(profile);
    this.current.party.activeDroidId = profile.id;
    this.current.coreEmission = normalizeCoreEmission(
      this.current.coreEmission,
      this.current.character,
      now,
    );
    this.persist();
    return structuredClone(profile);
  }

  setVitals(health: number, energy: number) {
    this.current.vitals.health = Math.max(0, Math.min(this.current.vitals.maxHealth, health));
    this.current.vitals.energy = Math.max(0, Math.min(this.current.vitals.maxEnergy, energy));
    this.persist();
  }

  addEnergy(quantity: number) {
    this.setVitals(
      this.current.vitals.health,
      Math.min(this.current.vitals.maxEnergy, this.current.vitals.energy + quantity),
    );
  }

  healFully() {
    this.setVitals(this.current.vitals.maxHealth, this.current.vitals.energy);
  }

  addInventoryItem(itemId: string, quantity = 1) {
    this.current.inventory = addItem(this.current.inventory, itemId, quantity);
    this.persist();
  }

  removeInventoryItem(itemId: string, quantity = 1) {
    const result = removeItem(this.current.inventory, itemId, quantity);
    if (result.removed) {
      this.current.inventory = result.inventory;
      this.persist();
    }
    return result.removed;
  }

  markEnemyDefeated(enemyId: string) {
    this.current.defeatedEnemies = [...new Set([...this.current.defeatedEnemies, enemyId])];
    this.persist();
  }

  syncCoreEmission(now = Date.now()) {
    this.current.coreEmission = normalizeCoreEmission(
      this.current.coreEmission,
      this.current.character,
      now,
    );
    this.persist();
    return structuredClone(this.current.coreEmission);
  }

  awardSimulatedEnergy(quantity: number) {
    this.current.coreEmission = addEmissionEnergy(this.current.coreEmission, quantity);
    this.persist();
  }

  clear() {
    this.saveService?.clear();
    this.current = createDefaultSave();
  }

  private persist() {
    if (this.saveService) this.current = this.saveService.save(this.current);
  }
}

export const gameSession = new GameSession();
