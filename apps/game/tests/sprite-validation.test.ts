import path from "node:path";
import { describe, expect, it } from "vitest";
import { PILOT_SPRITE_ROOT } from "../scripts/lib/paths";
import { validateSpriteSheet } from "../scripts/lib/sprites";
import {
  DIRECTION_ORDER,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  defaultSidecar,
  validateSpriteLayout,
} from "../scripts/lib/sprite-spec";

describe("sprite frame validation", () => {
  it("accepts the 4x4 directional sheet and fixed foot anchor", () => {
    expect(validateSpriteLayout({
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      sidecar: defaultSidecar(true),
    })).toEqual({ valid: true, errors: [], frameCount: 16 });
  });

  it("detects dimensions, direction order, and anchor drift", () => {
    const sidecar = defaultSidecar(false);
    sidecar.directions = [...DIRECTION_ORDER].reverse();
    sidecar.footAnchor = { x: 31, y: 57 };
    const result = validateSpriteLayout({ width: 128, height: 256, sidecar });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Expected 256x256|direction order|anchor/i);
  });

  it.each(["16", "17", "132", "1100", "training-unit-01", "corrupted-scout"])(
    "validates Dr. Halogen-style pilot %s",
    async (assetId) => {
      const result = await validateSpriteSheet(
        path.join(PILOT_SPRITE_ROOT, `dyoor-${assetId}-walk-v1.png`),
      );
      expect(result.valid).toBe(true);
      expect(result.width).toBe(SHEET_WIDTH);
      expect(result.height).toBe(SHEET_HEIGHT);
      expect(result.frameCount).toBe(16);
      expect(result.placeholder).toBe(true);
      expect(result.warnings).toEqual([]);
    },
  );
});
