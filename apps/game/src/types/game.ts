export type GameMode = "guest" | "wallet";
export type MapId = "laboratory" | "industrial-wastes";
export type Direction = "down" | "left" | "right" | "up";
export type QuestStage = "not_started" | "active" | "core_collected" | "complete";
export type BattleStatus = "active" | "victory" | "defeat";
export type EmissionTier = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
export type MiningQuestStage = "locked" | "available" | "active" | "ready" | "complete";
export type FieldProtocol = "vanguard" | "prospector" | "relay";

export type Trait = {
  traitType: string;
  value: string;
};

export type CharacterProfile = {
  id: string;
  displayName: string;
  tokenId: number | null;
  textureKey: string;
  placeholder: boolean;
  traits: Trait[];
  metadataVersion: string;
  traitHash: string;
};

export type PlayerIdentity = {
  callsign: string;
  protocol: FieldProtocol;
};

export type DroidPartyState = {
  activeDroidId: string;
  members: CharacterProfile[];
};

export type PlayerVitals = {
  health: number;
  maxHealth: number;
  energy: number;
  maxEnergy: number;
};

export type PlayerLocation = {
  mapId: MapId;
  x: number;
  y: number;
  direction: Direction;
};

export type InventoryState = Record<string, number>;

export type CoreEmissionState = {
  rarityScore: number;
  tier: EmissionTier;
  energyPerHour: number;
  bankedEnergy: number;
  lifetimeEnergy: number;
  lastAccruedAt: number;
};

export type EnergyMiningQuestState = {
  stage: MiningQuestStage;
  collectedNodeIds: string[];
};

export type GameSave = {
  version: 1;
  mode: GameMode;
  identity: PlayerIdentity;
  character: CharacterProfile;
  party: DroidPartyState;
  vitals: PlayerVitals;
  location: PlayerLocation;
  quest: {
    coreRecovery: QuestStage;
    energyMining: EnergyMiningQuestState;
  };
  inventory: InventoryState;
  defeatedEnemies: string[];
  coreEmission: CoreEmissionState;
  updatedAt: string;
};

export type EnemyDefinition = {
  id: string;
  name: string;
  maxHealth: number;
  attackMin: number;
  attackMax: number;
  energyReward: number;
  itemReward?: {
    itemId: string;
    quantity: number;
  };
};

export type BattleAction = "pulse" | "strike" | "guard" | "overclock";

export type BattleSnapshot = {
  turn: number;
  status: BattleStatus;
  playerHealth: number;
  playerMaxHealth: number;
  playerEnergy: number;
  playerMaxEnergy: number;
  enemyHealth: number;
  enemyMaxHealth: number;
  guarding: boolean;
  log: string[];
};

export type MovementVector = {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
};
