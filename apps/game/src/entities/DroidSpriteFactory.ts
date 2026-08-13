import Phaser from "phaser";
import {
  buildMetadataDroidVisual,
  drawMetadataDroidFrame,
  metadataSpriteTextureKey,
} from "../systems/sprites/MetadataDroidVisual";
import type { CharacterProfile, Direction } from "../types/game";

const FRAME_SIZE = 64;
const FRAMES_PER_DIRECTION = 4;
const DIRECTIONS: Direction[] = ["down", "left", "right", "up"];
const BATTLE_FRAME_SIZE = 128;
const PILOT_ASSETS = [
  {
    profileId: "training-unit-01",
    textureKey: "droid-training-pilot",
    traits: {
      Droid: "Training Alloy",
      Eyes: "Core Scanner",
      Special: "Guest Simulation",
    },
  },
  {
    tokenId: 16,
    textureKey: "droid-holder-green",
    traits: {
      Background: "Grey",
      Droid: "Lime Green",
      Conditions: "None",
      "Stickers/Body art": "None",
      Clothes: "Blue Hoodie",
      Mouth: "Diamond Grill",
      Eyes: "Abyss Laser",
      Hat: "McDYOORs",
      Accessories: "None",
      "Accessories 2": "None",
      Special: "None",
    },
  },
  {
    tokenId: 132,
    textureKey: "droid-holder-red",
    traits: {
      Background: "Kewl",
      Droid: "Red",
      Conditions: "None",
      "Stickers/Body art": "None",
      Clothes: "White Shirt W:Tie",
      Mouth: "Emo Whatever",
      Eyes: "Intense",
      Hat: "None",
      Accessories: "None",
      "Accessories 2": "None",
      Special: "None",
    },
  },
  {
    tokenId: 1100,
    textureKey: "droid-holder-gold",
    traits: {
      Background: "Kinda Blue",
      Droid: "Lime Green",
      Conditions: "None",
      "Stickers/Body art": "None",
      Clothes: "Fur Coat Gold",
      Mouth: "AHHH Tongue",
      Eyes: "Excited",
      Hat: "Halo",
      Accessories: "None",
      "Accessories 2": "None",
      Special: "None",
    },
  },
  {
    tokenId: 17,
    textureKey: "droid-token-17-pilot",
    traits: {
      Background: "Kinda Blue",
      Droid: "Red",
      Conditions: "None",
      "Stickers/Body art": "None",
      Clothes: "Red Hoodie",
      Mouth: "Drool",
      Eyes: "Ricky V",
      Hat: "Halo",
      Accessories: "None",
      "Accessories 2": "None",
      Special: "None",
    },
  },
  {
    profileId: "corrupted-scout-simulation",
    textureKey: "droid-corrupted-scout-pilot",
    traits: {
      Background: "Flash",
      Droid: "Dark Chrome",
      Conditions: "Dirty-Broken",
      "Stickers/Body art": "DYOOR Chest Tat",
      Clothes: "Torn Black Tee",
      Mouth: "AHHHH Flames",
      Eyes: "Radiation Glow (Red)Laser",
      Hat: "Burning Chog",
      Accessories: "None",
      "Accessories 2": "None",
      Special: "None",
    },
  },
] as const;

export type DroidPalette = {
  body: string;
  bodyShadow: string;
  eye: string;
  accent: string;
  outline: string;
};

function pixelRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
) {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function matchingPilotTexture(profile: CharacterProfile) {
  const pilot = PILOT_ASSETS.find((candidate) =>
    ("tokenId" in candidate && candidate.tokenId === profile.tokenId)
    || ("profileId" in candidate && candidate.profileId === profile.id)
  );
  if (!pilot) return null;
  const currentTraits = new Map(
    profile.traits.map((trait) => [
      trait.traitType.trim().toLowerCase(),
      trait.value.trim().toLowerCase(),
    ]),
  );
  const matches = Object.entries(pilot.traits).every(
    ([traitType, value]) => currentTraits.get(traitType.toLowerCase()) === value.toLowerCase(),
  );
  return matches ? pilot.textureKey : null;
}

function drawDroidFrame(
  context: CanvasRenderingContext2D,
  frameX: number,
  frameY: number,
  direction: Direction,
  walkFrame: number,
  palette: DroidPalette,
  variant: "training" | "holder" | "scientist" | "corrupted",
) {
  const bob = walkFrame % 2;
  const stride = walkFrame === 1 ? -2 : walkFrame === 3 ? 2 : 0;
  const x = frameX;
  const y = frameY + bob;

  // Collection-faithful base: tall capsule head, ear pod, segmented neck,
  // compact clothing silhouette, and slim mechanical limbs.
  pixelRect(context, x + 23, y + 5, 18, 2, palette.outline);
  pixelRect(context, x + 21, y + 7, 22, 26, palette.outline);
  pixelRect(context, x + 23, y + 33, 18, 3, palette.outline);
  pixelRect(context, x + 23, y + 7, 18, 26, palette.body);
  pixelRect(context, x + 23, y + 9, 3, 22, palette.bodyShadow);
  pixelRect(context, x + 39, y + 9, 2, 19, palette.accent);

  const earX = direction === "right" ? x + 41 : x + 17;
  pixelRect(context, earX, y + 19, 6, 9, palette.outline);
  pixelRect(context, earX + 2, y + 21, 3, 5, palette.bodyShadow);

  if (direction !== "up") {
    if (direction === "down") {
      pixelRect(context, x + 23, y + 14, 8, 8, palette.eye);
      pixelRect(context, x + 33, y + 14, 8, 8, palette.eye);
      pixelRect(context, x + 27, y + 17, 2, 3, palette.outline);
      pixelRect(context, x + 35, y + 17, 2, 3, palette.outline);
    } else {
      const eyeX = direction === "left" ? x + 21 : x + 35;
      pixelRect(context, eyeX, y + 14, 7, 8, palette.eye);
      pixelRect(context, eyeX + (direction === "left" ? 1 : 4), y + 17, 2, 3, palette.outline);
    }
  } else {
    pixelRect(context, x + 25, y + 11, 14, 3, palette.bodyShadow);
    pixelRect(context, x + 28, y + 25, 8, 5, palette.bodyShadow);
  }

  if (direction !== "up") {
    pixelRect(context, x + 26, y + 26, 13, 3, palette.outline);
    pixelRect(context, x + 28, y + 27, 9, 2, palette.accent);
  }

  pixelRect(context, x + 27, y + 35, 10, 8, palette.outline);
  pixelRect(context, x + 29, y + 35, 6, 8, palette.body);
  pixelRect(context, x + 29, y + 37, 6, 2, palette.bodyShadow);
  pixelRect(context, x + 29, y + 41, 6, 2, palette.bodyShadow);

  const torsoColor = variant === "scientist" ? "#e5eef4" : palette.accent;
  const torsoShadow = variant === "scientist" ? "#46cde5" : palette.bodyShadow;
  pixelRect(context, x + 18, y + 42, 28, 10, palette.outline);
  pixelRect(context, x + 20, y + 43, 24, 8, torsoColor);
  pixelRect(context, x + 20, y + 49, 24, 2, torsoShadow);
  pixelRect(context, x + 14, y + 43, 6, 8, palette.outline);
  pixelRect(context, x + 44, y + 43, 6, 8, palette.outline);
  pixelRect(context, x + 16, y + 44, 3, 6, palette.body);
  pixelRect(context, x + 45, y + 44, 3, 6, palette.body);
  pixelRect(context, x + 22 + stride, y + 51, 8, 6, palette.outline);
  pixelRect(context, x + 34 - stride, y + 51, 8, 6, palette.outline);
  pixelRect(context, x + 20 + stride, y + 56, 11, 2, palette.accent);
  pixelRect(context, x + 33 - stride, y + 56, 11, 2, palette.accent);

  if (variant === "training") {
    pixelRect(context, x + 29, y + 2, 6, 4, palette.accent);
    pixelRect(context, x + 31, y, 2, 3, palette.accent);
  }
  if (variant === "holder") {
    pixelRect(context, x + 19, y + 4, 26, 4, palette.accent);
    pixelRect(context, x + 17, y + 6, 8, 3, palette.accent);
  }
  if (variant === "corrupted") {
    const glitch = walkFrame % 2 ? 3 : -2;
    pixelRect(context, x + 10 + glitch, y + 15, 12, 3, "#ff3fb4");
    pixelRect(context, x + 42 - glitch, y + 29, 12, 3, "#7d4dff");
    pixelRect(context, x + 22, y + 14, 19, 8, "#ff2d52");
  }
}

function registerDroidAnimations(scene: Phaser.Scene, key: string) {
  for (const direction of DIRECTIONS) {
    const animationKey = `${key}-walk-${direction}`;
    if (!scene.anims.exists(animationKey)) {
      scene.anims.create({
        key: animationKey,
        frames: Array.from({ length: FRAMES_PER_DIRECTION }, (_, frame) => ({
          key,
          frame: `${direction}-${frame}`,
        })),
        frameRate: 8,
        repeat: -1,
      });
    }
  }
}

export function registerLoadedDroidSheet(scene: Phaser.Scene, key: string) {
  const texture = scene.textures.get(key);
  const frameNames = new Set(texture.getFrameNames());
  for (let row = 0; row < DIRECTIONS.length; row += 1) {
    const direction = DIRECTIONS[row];
    if (!direction) continue;
    for (let frame = 0; frame < FRAMES_PER_DIRECTION; frame += 1) {
      const frameName = `${direction}-${frame}`;
      if (frameNames.has(frameName)) continue;
      texture.add(
        frameName,
        0,
        frame * FRAME_SIZE,
        row * FRAME_SIZE,
        FRAME_SIZE,
        FRAME_SIZE,
      );
    }
  }
  registerDroidAnimations(scene, key);
}

export function createDroidSheet(
  scene: Phaser.Scene,
  key: string,
  palette: DroidPalette,
  variant: "training" | "holder" | "scientist" | "corrupted" = "holder",
) {
  if (scene.textures.exists(key)) {
    registerLoadedDroidSheet(scene, key);
    return;
  }
  const texture = scene.textures.createCanvas(
    key,
    FRAME_SIZE * FRAMES_PER_DIRECTION,
    FRAME_SIZE * DIRECTIONS.length,
  );
  if (!texture) throw new Error(`Could not create placeholder sprite texture ${key}.`);
  const context = texture.context;
  context.imageSmoothingEnabled = false;

  for (let row = 0; row < DIRECTIONS.length; row += 1) {
    const direction = DIRECTIONS[row];
    if (!direction) continue;
    for (let frame = 0; frame < FRAMES_PER_DIRECTION; frame += 1) {
      const x = frame * FRAME_SIZE;
      const y = row * FRAME_SIZE;
      context.clearRect(x, y, FRAME_SIZE, FRAME_SIZE);
      drawDroidFrame(context, x, y, direction, frame, palette, variant);
      texture.add(`${direction}-${frame}`, 0, x, y, FRAME_SIZE, FRAME_SIZE);
    }
  }
  texture.refresh();
  registerDroidAnimations(scene, key);
}

/**
 * Composes only the active character's current normalized metadata in-browser.
 * The trait hash is part of the key, so a Trait Lab metadata change creates a
 * fresh texture without loading the full 3,333-image collection.
 */
export function createMetadataDroidSheet(
  scene: Phaser.Scene,
  profile: CharacterProfile,
) {
  const pilotKey = matchingPilotTexture(profile);
  if (pilotKey && scene.textures.exists(pilotKey)) {
    registerLoadedDroidSheet(scene, pilotKey);
    return pilotKey;
  }
  const key = metadataSpriteTextureKey(profile);
  if (scene.textures.exists(key)) {
    registerLoadedDroidSheet(scene, key);
    return key;
  }
  const texture = scene.textures.createCanvas(
    key,
    FRAME_SIZE * FRAMES_PER_DIRECTION,
    FRAME_SIZE * DIRECTIONS.length,
  );
  if (!texture) throw new Error(`Could not compose metadata sprite texture ${key}.`);
  const context = texture.context;
  context.imageSmoothingEnabled = false;
  const surface = {
    rect: (
      x: number,
      y: number,
      width: number,
      height: number,
      color: string,
    ) => {
      pixelRect(context, x, y, width, height, color);
    },
  };
  const visual = buildMetadataDroidVisual(profile.traits);
  for (let row = 0; row < DIRECTIONS.length; row += 1) {
    const direction = DIRECTIONS[row];
    if (!direction) continue;
    for (let frame = 0; frame < FRAMES_PER_DIRECTION; frame += 1) {
      const x = frame * FRAME_SIZE;
      const y = row * FRAME_SIZE;
      context.clearRect(x, y, FRAME_SIZE, FRAME_SIZE);
      drawMetadataDroidFrame(surface, x, y, direction, frame, visual);
      texture.add(`${direction}-${frame}`, 0, x, y, FRAME_SIZE, FRAME_SIZE);
    }
  }
  texture.refresh();
  registerDroidAnimations(scene, key);
  return key;
}

/**
 * Battles deliberately use a separate, larger three-frame combat sheet. It
 * shares the metadata visual model with the overworld sprite, but uses a
 * forward-leaning stance, extended core arm, and charge/hit poses.
 */
export function createMetadataBattleSheet(
  scene: Phaser.Scene,
  profile: CharacterProfile,
  facing: "left" | "right",
) {
  const baseKey = metadataSpriteTextureKey(profile);
  const key = `${baseKey}-battle-${facing}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, BATTLE_FRAME_SIZE * 3, BATTLE_FRAME_SIZE);
  if (!texture) throw new Error(`Could not compose battle sprite texture ${key}.`);
  const context = texture.context;
  context.imageSmoothingEnabled = false;
  const visual = buildMetadataDroidVisual(profile.traits);
  const pilotKey = matchingPilotTexture(profile);
  const pilotSource = pilotKey && scene.textures.exists(pilotKey)
    ? scene.textures.get(pilotKey).getSourceImage()
    : null;
  const poses = ["idle", "charge", "hit"] as const;
  poses.forEach((pose, frameIndex) => {
    const frameOriginX = frameIndex * BATTLE_FRAME_SIZE;
    context.clearRect(frameOriginX, 0, BATTLE_FRAME_SIZE, BATTLE_FRAME_SIZE);
    const lean = pose === "charge" ? (facing === "right" ? 3 : -3) : 0;
    const recoil = pose === "hit" ? (facing === "right" ? -3 : 3) : 0;
    const lift = pose === "charge" ? -2 : pose === "hit" ? 1 : 0;
    if (pilotSource) {
      const directionRow = facing === "left" ? 1 : 2;
      const poseColumn = pose === "idle" ? 0 : pose === "charge" ? 2 : 3;
      context.drawImage(
        pilotSource as unknown as CanvasImageSource,
        poseColumn * FRAME_SIZE,
        directionRow * FRAME_SIZE,
        FRAME_SIZE,
        FRAME_SIZE,
        frameOriginX + lean + recoil,
        lift,
        BATTLE_FRAME_SIZE,
        BATTLE_FRAME_SIZE,
      );
    } else {
      const surface = {
        rect: (
          x: number,
          y: number,
          width: number,
          height: number,
          color: string,
        ) => {
          const headLean = y < 40 ? lean : 0;
          pixelRect(
            context,
            frameOriginX + x * 2 + headLean + recoil,
            y * 2 + lift,
            width * 2,
            height * 2,
            color,
          );
        },
      };
      drawMetadataDroidFrame(
        surface,
        0,
        0,
        facing,
        pose === "charge" ? 1 : 0,
        visual,
      );
    }

    if (pose === "charge") {
      const coreX = frameOriginX + (facing === "right" ? 94 : 30);
      pixelRect(context, coreX - 5, 78, 10, 10, "#183f53");
      pixelRect(context, coreX - 3, 80, 6, 6, "#42ffe3");
      pixelRect(context, coreX - 1, 81, 2, 4, "#ffffff");
    }
    texture.add(
      pose,
      0,
      frameOriginX,
      0,
      BATTLE_FRAME_SIZE,
      BATTLE_FRAME_SIZE,
    );
  });
  texture.refresh();
  const animationKey = `${key}-idle`;
  if (!scene.anims.exists(animationKey)) {
    scene.anims.create({
      key: animationKey,
      frames: [
        { key, frame: "idle" },
        { key, frame: "charge" },
        { key, frame: "idle" },
      ],
      frameRate: 2,
      repeat: -1,
    });
  }
  return key;
}

export function createWorldTextures(scene: Phaser.Scene) {
  // All visible characters resolve through metadata-aware pilot selection or
  // the shared Halogen-silhouette compositor. No legacy generic humanoid
  // texture is registered for world use.
  for (const pilot of PILOT_ASSETS) {
    if (scene.textures.exists(pilot.textureKey)) {
      registerLoadedDroidSheet(scene, pilot.textureKey);
    }
  }

  createCoreTexture(scene);
}

function createCoreTexture(scene: Phaser.Scene) {
  if (scene.textures.exists("energy-core")) return;
  const texture = scene.textures.createCanvas("energy-core", 32, 32);
  if (!texture) throw new Error("Could not create Energy Core texture.");
  const context = texture.context;
  context.imageSmoothingEnabled = false;
  pixelRect(context, 12, 2, 8, 4, "#f8ffbd");
  pixelRect(context, 8, 6, 16, 4, "#42ffe2");
  pixelRect(context, 5, 10, 22, 12, "#147aa5");
  pixelRect(context, 8, 9, 16, 15, "#31f6da");
  pixelRect(context, 12, 12, 8, 9, "#ffffff");
  pixelRect(context, 8, 24, 16, 4, "#8e58ff");
  pixelRect(context, 12, 28, 8, 3, "#351f62");
  texture.refresh();
}
