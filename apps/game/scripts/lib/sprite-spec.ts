export const SPRITE_SPEC_VERSION = "dyoor-overworld-v1";
export const FRAME_WIDTH = 64;
export const FRAME_HEIGHT = 64;
export const FRAMES_PER_DIRECTION = 4;
export const DIRECTION_ORDER = ["down", "left", "right", "up"] as const;
export const FRAME_ORDER = [0, 1, 2, 3] as const;
export const SHEET_WIDTH = FRAME_WIDTH * FRAMES_PER_DIRECTION;
export const SHEET_HEIGHT = FRAME_HEIGHT * DIRECTION_ORDER.length;
export const FRAME_COUNT = FRAMES_PER_DIRECTION * DIRECTION_ORDER.length;
export const FOOT_ANCHOR = { x: 32, y: 58 } as const;

export type SpriteSidecar = {
  specVersion: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  directions: readonly string[];
  framesPerDirection: number;
  footAnchor: { x: number; y: number };
  placeholder: boolean;
  traitHash?: string;
  rendererVersion?: string;
  tokenId?: number;
  assetId?: string;
  assetStatus?: "metadata-driven-procedural-placeholder" | "approved-directional-layer-composite" | "ai-assisted-pilot";
  productionReady?: boolean;
};

export function defaultSidecar(placeholder: boolean): SpriteSidecar {
  return {
    specVersion: SPRITE_SPEC_VERSION,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    frameCount: FRAME_COUNT,
    directions: DIRECTION_ORDER,
    framesPerDirection: FRAMES_PER_DIRECTION,
    footAnchor: { ...FOOT_ANCHOR },
    placeholder,
  };
}

export function validateSpriteLayout(input: {
  width: number;
  height: number;
  sidecar: SpriteSidecar | null;
}) {
  const errors: string[] = [];
  if (input.width !== SHEET_WIDTH || input.height !== SHEET_HEIGHT) {
    errors.push(`Expected ${SHEET_WIDTH}x${SHEET_HEIGHT}.`);
  }
  const frameCount = (input.width / FRAME_WIDTH) * (input.height / FRAME_HEIGHT);
  if (frameCount !== FRAME_COUNT) errors.push(`Expected ${FRAME_COUNT} frames.`);
  if (!input.sidecar) errors.push("Sprite sidecar is missing.");
  else {
    if (input.sidecar.specVersion !== SPRITE_SPEC_VERSION) errors.push("Sprite spec version is incorrect.");
    if (input.sidecar.frameCount !== FRAME_COUNT) errors.push("Sidecar frame count is incorrect.");
    if (JSON.stringify(input.sidecar.directions) !== JSON.stringify(DIRECTION_ORDER)) {
      errors.push("Sidecar direction order is incorrect.");
    }
    if (
      input.sidecar.footAnchor.x !== FOOT_ANCHOR.x
      || input.sidecar.footAnchor.y !== FOOT_ANCHOR.y
    ) {
      errors.push("Foot anchor is misaligned.");
    }
  }
  return { valid: errors.length === 0, errors, frameCount };
}
