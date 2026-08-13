import type {
  FieldProtocol,
  PlayerIdentity,
  PlayerVitals,
} from "../../types/game";

export type FieldProtocolDefinition = {
  id: FieldProtocol;
  name: string;
  role: string;
  description: string;
  maxHealthBonus: number;
  maxEnergyBonus: number;
  miningEnergyPerNode: number;
  color: number;
};

export const FIELD_PROTOCOLS: readonly FieldProtocolDefinition[] = [
  {
    id: "vanguard",
    name: "VANGUARD",
    role: "FRONTLINE",
    description: "+15 maximum HP. Built to absorb corrupted signal pressure.",
    maxHealthBonus: 15,
    maxEnergyBonus: 0,
    miningEnergyPerNode: 10,
    color: 0xff5d87,
  },
  {
    id: "prospector",
    name: "PROSPECTOR",
    role: "EXTRACTION",
    description: "Charged seams yield 15 simulated Energy instead of 10.",
    maxHealthBonus: 0,
    maxEnergyBonus: 0,
    miningEnergyPerNode: 15,
    color: 0xffd45d,
  },
  {
    id: "relay",
    name: "RELAY",
    role: "CORE TECH",
    description: "+15 maximum Core Energy for longer field operations.",
    maxHealthBonus: 0,
    maxEnergyBonus: 15,
    miningEnergyPerNode: 10,
    color: 0x65ffe9,
  },
] as const;

const VALID_PROTOCOLS = new Set<FieldProtocol>(
  FIELD_PROTOCOLS.map((definition) => definition.id),
);

export function normalizeFieldProtocol(value: unknown): FieldProtocol {
  return VALID_PROTOCOLS.has(value as FieldProtocol)
    ? value as FieldProtocol
    : "prospector";
}

export function normalizeCallsign(value: unknown, fallback = "PILOT-01") {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, "")
    .trim()
    .replace(/[ -]+/g, "-")
    .slice(0, 16);
  return normalized || fallback;
}

export function createPlayerIdentity(
  callsign: unknown = "PILOT-01",
  protocol: unknown = "prospector",
): PlayerIdentity {
  return {
    callsign: normalizeCallsign(callsign),
    protocol: normalizeFieldProtocol(protocol),
  };
}

export function protocolDefinition(protocol: unknown) {
  const normalized = normalizeFieldProtocol(protocol);
  return FIELD_PROTOCOLS.find((definition) => definition.id === normalized)
    || FIELD_PROTOCOLS[1]!;
}

export function applyProtocolVitals(
  vitals: PlayerVitals,
  protocol: unknown,
): PlayerVitals {
  const definition = protocolDefinition(protocol);
  const maxHealth = Math.max(1, vitals.maxHealth + definition.maxHealthBonus);
  const maxEnergy = Math.max(1, vitals.maxEnergy + definition.maxEnergyBonus);
  return {
    health: Math.min(maxHealth, vitals.health + definition.maxHealthBonus),
    maxHealth,
    energy: Math.min(maxEnergy, vitals.energy + definition.maxEnergyBonus),
    maxEnergy,
  };
}

export function miningEnergyForProtocol(protocol: unknown) {
  return protocolDefinition(protocol).miningEnergyPerNode;
}
