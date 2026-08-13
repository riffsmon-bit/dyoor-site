import { TRAINING_DROID } from "../../data/characters";
import {
  createDefaultCoreEmission,
  normalizeCoreEmission,
} from "../emission/CoreEmission";
import {
  applyProtocolVitals,
  createPlayerIdentity,
} from "../identity/FieldProtocol";
import { normalizeInventory } from "../inventory/Inventory";
import type {
  CharacterProfile,
  Direction,
  DroidPartyState,
  EnergyMiningQuestState,
  GameMode,
  GameSave,
  MapId,
  MiningQuestStage,
  QuestStage,
  Trait,
} from "../../types/game";

export const SAVE_KEY = "dyoor-game-save-v1";

const VALID_MAPS = new Set<MapId>(["laboratory", "industrial-wastes"]);
const VALID_DIRECTIONS = new Set<Direction>(["down", "left", "right", "up"]);
const VALID_QUEST_STAGES = new Set<QuestStage>([
  "not_started",
  "active",
  "core_collected",
  "complete",
]);
const VALID_MINING_STAGES = new Set<MiningQuestStage>([
  "locked",
  "available",
  "active",
  "ready",
  "complete",
]);

function safeNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function safeString(value: unknown, fallback: string, maximum = 128) {
  const string = typeof value === "string" ? value.trim() : "";
  return string ? string.slice(0, maximum) : fallback;
}

function normalizeTraits(value: unknown): Trait[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap((entry): Trait[] => {
    if (!entry || typeof entry !== "object") return [];
    const trait = entry as Record<string, unknown>;
    const traitType = safeString(trait.traitType, "", 64);
    const traitValue = safeString(trait.value, "", 128);
    return traitType && traitValue ? [{ traitType, value: traitValue }] : [];
  });
}

function normalizeCharacter(value: unknown): CharacterProfile {
  if (!value || typeof value !== "object") return structuredClone(TRAINING_DROID);
  const character = value as Record<string, unknown>;
  const tokenNumber = Number(character.tokenId);
  const tokenId = Number.isSafeInteger(tokenNumber) && tokenNumber >= 1 && tokenNumber <= 3333
    ? tokenNumber
    : null;
  return {
    id: safeString(character.id, tokenId ? `s2-${tokenId}` : TRAINING_DROID.id, 96),
    displayName: safeString(
      character.displayName,
      tokenId ? `D.Y.O.O.R #${tokenId}` : TRAINING_DROID.displayName,
      96,
    ),
    tokenId,
    textureKey: safeString(character.textureKey, TRAINING_DROID.textureKey, 96),
    placeholder: character.placeholder !== false,
    traits: normalizeTraits(character.traits),
    metadataVersion: safeString(character.metadataVersion, "unknown", 64),
    traitHash: safeString(character.traitHash, tokenId ? `token-${tokenId}` : TRAINING_DROID.traitHash, 128),
  };
}

function defaultCallsign(character: CharacterProfile) {
  return character.tokenId ? `DROID-${character.tokenId}` : "PILOT-01";
}

function normalizeParty(
  value: unknown,
  activeCharacter: CharacterProfile,
  mode: GameMode,
): DroidPartyState {
  if (mode === "guest") {
    return {
      activeDroidId: TRAINING_DROID.id,
      members: [structuredClone(TRAINING_DROID)],
    };
  }

  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const candidates = Array.isArray(input.members) ? input.members : [];
  const members: CharacterProfile[] = [];
  const seen = new Set<string>();
  for (const candidate of [activeCharacter, ...candidates]) {
    const profile = normalizeCharacter(candidate);
    if (!profile.tokenId || seen.has(profile.id)) continue;
    seen.add(profile.id);
    members.push(profile);
    if (members.length >= 3) break;
  }
  if (!members.length) members.push(activeCharacter);
  return {
    activeDroidId: activeCharacter.id,
    members,
  };
}

function normalizeEnergyMining(value: unknown): EnergyMiningQuestState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { stage: "locked", collectedNodeIds: [] };
  }
  const input = value as Record<string, unknown>;
  const stage = VALID_MINING_STAGES.has(input.stage as MiningQuestStage)
    ? input.stage as MiningQuestStage
    : "locked";
  const collectedNodeIds = Array.isArray(input.collectedNodeIds)
    ? [...new Set(input.collectedNodeIds.filter(
      (entry): entry is string => typeof entry === "string" && /^seam-[a-z0-9-]{1,32}$/.test(entry),
    ))].slice(0, 3)
    : [];
  return {
    stage: stage === "ready" && collectedNodeIds.length < 3 ? "active" : stage,
    collectedNodeIds,
  };
}

export function createDefaultSave(
  mode: GameMode = "guest",
  character: CharacterProfile = TRAINING_DROID,
  options: {
    identity?: { callsign?: unknown; protocol?: unknown };
    party?: CharacterProfile[];
  } = {},
): GameSave {
  const activeCharacter = mode === "guest"
    ? structuredClone(TRAINING_DROID)
    : normalizeCharacter(character);
  const identity = createPlayerIdentity(
    options.identity?.callsign ?? defaultCallsign(activeCharacter),
    options.identity?.protocol,
  );
  const vitals = applyProtocolVitals({
    health: 100,
    maxHealth: 100,
    energy: 60,
    maxEnergy: 100,
  }, identity.protocol);
  const party = normalizeParty({
    members: options.party || [activeCharacter],
  }, activeCharacter, mode);
  return {
    version: 1,
    mode,
    identity,
    character: activeCharacter,
    party,
    vitals,
    location: {
      mapId: "laboratory",
      x: 480,
      y: 480,
      direction: "down",
    },
    quest: {
      coreRecovery: "not_started",
      energyMining: {
        stage: "locked",
        collectedNodeIds: [],
      },
    },
    inventory: {},
    defeatedEnemies: [],
    coreEmission: createDefaultCoreEmission(activeCharacter),
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeSave(value: unknown): GameSave | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, any>;
  if (input.version !== 1) return null;

  const mode: GameMode = input.mode === "wallet" ? "wallet" : "guest";
  const requestedCharacter = normalizeCharacter(input.character);
  const character = mode === "guest"
    ? structuredClone(TRAINING_DROID)
    : requestedCharacter;
  const identity = createPlayerIdentity(
    input.identity?.callsign ?? defaultCallsign(character),
    input.identity?.protocol,
  );
  const protocolVitals = applyProtocolVitals({
    health: 100,
    maxHealth: 100,
    energy: 60,
    maxEnergy: 100,
  }, identity.protocol);
  const party = normalizeParty(input.party, character, mode);
  const mapId = VALID_MAPS.has(input.location?.mapId)
    ? input.location.mapId as MapId
    : "laboratory";
  const direction = VALID_DIRECTIONS.has(input.location?.direction)
    ? input.location.direction as Direction
    : "down";
  const stage = VALID_QUEST_STAGES.has(input.quest?.coreRecovery)
    ? input.quest.coreRecovery as QuestStage
    : "not_started";

  return {
    version: 1,
    mode,
    identity,
    character,
    party,
    vitals: {
      health: safeNumber(
        input.vitals?.health,
        protocolVitals.maxHealth,
        0,
        protocolVitals.maxHealth,
      ),
      maxHealth: protocolVitals.maxHealth,
      energy: safeNumber(
        input.vitals?.energy,
        protocolVitals.energy,
        0,
        protocolVitals.maxEnergy,
      ),
      maxEnergy: protocolVitals.maxEnergy,
    },
    location: {
      mapId,
      x: safeNumber(input.location?.x, 480, 32, 4096),
      y: safeNumber(input.location?.y, 480, 32, 4096),
      direction,
    },
    quest: {
      coreRecovery: stage,
      energyMining: normalizeEnergyMining(input.quest?.energyMining),
    },
    inventory: normalizeInventory(input.inventory),
    defeatedEnemies: Array.isArray(input.defeatedEnemies)
      ? [...new Set(input.defeatedEnemies.filter((entry: unknown) => (
        typeof entry === "string" && /^[a-z0-9-]{1,64}$/.test(entry)
      )))].slice(0, 256)
      : [],
    coreEmission: normalizeCoreEmission(input.coreEmission, character),
    updatedAt: safeString(input.updatedAt, new Date().toISOString(), 64),
  };
}
