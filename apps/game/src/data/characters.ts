import type { CharacterProfile, EnemyDefinition } from "../types/game";

export const TRAINING_DROID: CharacterProfile = {
  id: "training-unit-01",
  displayName: "Training Unit 01",
  tokenId: null,
  textureKey: "droid-training",
  placeholder: true,
  traits: [
    { traitType: "Droid", value: "Training Alloy" },
    { traitType: "Eyes", value: "Core Scanner" },
    { traitType: "Special", value: "Guest Simulation" },
  ],
  metadataVersion: "local-training-v1",
  traitHash: "training-unit-01-v1",
};

export const MOCK_HOLDER_DROIDS: CharacterProfile[] = [
  {
    id: "mock-s2-16",
    displayName: "D.Y.O.O.R #16",
    tokenId: 16,
    textureKey: "droid-holder-green",
    placeholder: true,
    traits: [
      { traitType: "Background", value: "Grey" },
      { traitType: "Droid", value: "Lime Green" },
      { traitType: "Conditions", value: "None" },
      { traitType: "Stickers/Body art", value: "None" },
      { traitType: "Clothes", value: "Blue Hoodie" },
      { traitType: "Mouth", value: "Diamond Grill" },
      { traitType: "Eyes", value: "Abyss Laser" },
      { traitType: "Hat", value: "McDYOORs" },
      { traitType: "Accessories", value: "None" },
      { traitType: "Accessories 2", value: "None" },
      { traitType: "Special", value: "None" },
    ],
    metadataVersion: "canonical-cache-2026-07-29",
    traitHash: "ffa79c22620f5fabb23bbd7ec4363c3c494d1746c5c44240ab0931b2f13fd826",
  },
  {
    id: "mock-s2-132",
    displayName: "D.Y.O.O.R #132",
    tokenId: 132,
    textureKey: "droid-holder-red",
    placeholder: true,
    traits: [
      { traitType: "Background", value: "Kewl" },
      { traitType: "Droid", value: "Red" },
      { traitType: "Conditions", value: "None" },
      { traitType: "Stickers/Body art", value: "None" },
      { traitType: "Clothes", value: "White Shirt W:Tie" },
      { traitType: "Mouth", value: "Emo Whatever" },
      { traitType: "Eyes", value: "Intense" },
      { traitType: "Hat", value: "None" },
      { traitType: "Accessories", value: "None" },
      { traitType: "Accessories 2", value: "None" },
      { traitType: "Special", value: "None" },
    ],
    metadataVersion: "canonical-cache-2026-07-29",
    traitHash: "38d4290f08dd3d4dce12ce6bd914000d83813279fa9f9f8804c3f1ed41dfa47f",
  },
];

/**
 * Token #17 is classified as surviving_minted/player_character. Dr. Halogen
 * uses its current appearance as a narrative cameo only; this does not
 * reclassify the NFT, assert ownership, or make the NPC a claimable asset.
 */
export const DR_HALOGEN_APPEARANCE: CharacterProfile = {
  id: "dr-halogen-token-17-cameo",
  displayName: "Dr. Halogen // D.Y.O.O.R #17",
  tokenId: 17,
  textureKey: "droid-token-17-pilot",
  placeholder: true,
  traits: [
    { traitType: "Background", value: "Kinda Blue" },
    { traitType: "Droid", value: "Red" },
    { traitType: "Conditions", value: "None" },
    { traitType: "Stickers/Body art", value: "None" },
    { traitType: "Clothes", value: "Red Hoodie" },
    { traitType: "Mouth", value: "Drool" },
    { traitType: "Eyes", value: "Ricky V" },
    { traitType: "Hat", value: "Halo" },
    { traitType: "Accessories", value: "None" },
    { traitType: "Accessories 2", value: "None" },
    { traitType: "Special", value: "None" },
  ],
  metadataVersion: "canonical-cache-2026-07-29",
  traitHash: "240d4d83e213e2211861f38d483e8b4d9c32f4e5c019abcd01e0bc360764010f",
};

/**
 * Token #1100 is verified as unminted metadata. It is safe to use as a
 * game-controlled character, but it must never be presented as holder-owned.
 */
export const ECHO_SURVEYOR_APPEARANCE: CharacterProfile = {
  id: "echo-surveyor-token-1100",
  displayName: "Echo Surveyor // Unit #1100",
  tokenId: 1100,
  textureKey: "droid-holder-gold",
  placeholder: true,
  traits: [
    { traitType: "Background", value: "Kinda Blue" },
    { traitType: "Droid", value: "Lime Green" },
    { traitType: "Conditions", value: "None" },
    { traitType: "Stickers/Body art", value: "None" },
    { traitType: "Clothes", value: "Fur Coat Gold" },
    { traitType: "Mouth", value: "AHHH Tongue" },
    { traitType: "Eyes", value: "Excited" },
    { traitType: "Hat", value: "Halo" },
    { traitType: "Accessories", value: "None" },
    { traitType: "Accessories 2", value: "None" },
    { traitType: "Special", value: "None" },
  ],
  metadataVersion: "canonical-cache-2026-07-29",
  traitHash: "echo-surveyor-token-1100-v1",
};

export const CORRUPTED_SCOUT: EnemyDefinition = {
  id: "corrupted-scout",
  name: "Corrupted Scout",
  maxHealth: 52,
  attackMin: 6,
  attackMax: 11,
  energyReward: 30,
  itemReward: {
    itemId: "corrupted-circuit",
    quantity: 1,
  },
};

export const CORRUPTED_SCOUT_PROFILE: CharacterProfile = {
  id: "corrupted-scout-simulation",
  displayName: "Corrupted Scout",
  tokenId: null,
  textureKey: "droid-corrupted-scout-pilot",
  placeholder: true,
  traits: [
    { traitType: "Background", value: "Flash" },
    { traitType: "Droid", value: "Dark Chrome" },
    { traitType: "Conditions", value: "Dirty-Broken" },
    { traitType: "Stickers/Body art", value: "DYOOR Chest Tat" },
    { traitType: "Clothes", value: "Torn Black Tee" },
    { traitType: "Mouth", value: "AHHHH Flames" },
    { traitType: "Eyes", value: "Radiation Glow (Red)Laser" },
    { traitType: "Hat", value: "Burning Chog" },
    { traitType: "Accessories", value: "None" },
    { traitType: "Accessories 2", value: "None" },
    { traitType: "Special", value: "None" },
  ],
  metadataVersion: "local-enemy-v1",
  traitHash: "corrupted-scout-v1",
};
