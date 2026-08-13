import { describe, expect, it } from "vitest";
import {
  buildMetadataDroidVisual,
  metadataSpriteTextureKey,
} from "../src/systems/sprites/MetadataDroidVisual";
import type { CharacterProfile, Trait } from "../src/types/game";

function traits(values: Partial<Record<string, string>>): Trait[] {
  return Object.entries({
    Background: "Grey",
    Droid: "Lime Green",
    Conditions: "None",
    "Stickers/Body art": "None",
    Clothes: "None",
    Mouth: "None",
    Eyes: "Okay",
    Hat: "None",
    Accessories: "None",
    "Accessories 2": "None",
    Special: "None",
    ...values,
  }).map(([traitType, value]) => ({ traitType, value }));
}

describe("metadata-driven Droid visual model", () => {
  it("maps token 16's verified traits into distinct pixel archetypes", () => {
    const visual = buildMetadataDroidVisual(traits({
      Droid: "Lime Green",
      Clothes: "Blue Hoodie",
      Mouth: "Diamond Grill",
      Eyes: "Abyss Laser",
      Hat: "McDYOORs",
    }));
    expect(visual.body).toBe("#5ce53f");
    expect(visual.clothing.kind).toBe("hoodie");
    expect(visual.mouth.kind).toBe("grill");
    expect(visual.eyes.kind).toBe("laser");
    expect(visual.hat.kind).toBe("cap");
  });

  it("maps the accepted token 1100 silhouette traits", () => {
    const visual = buildMetadataDroidVisual(traits({
      Clothes: "Fur Coat Gold",
      Mouth: "AHHH Tongue",
      Eyes: "Excited",
      Hat: "Halo",
    }));
    expect(visual.clothing.kind).toBe("fur");
    expect(visual.mouth.kind).toBe("tongue");
    expect(visual.eyes.kind).toBe("excited");
    expect(visual.hat.kind).toBe("halo");
  });

  it("maps Dr. Halogen's token 17 metadata without changing its token identity", () => {
    const visual = buildMetadataDroidVisual(traits({
      Droid: "Red",
      Clothes: "Red Hoodie",
      Mouth: "Drool",
      Eyes: "Ricky V",
      Hat: "Halo",
    }));
    expect(visual.body).toBe("#df3447");
    expect(visual.clothing.kind).toBe("hoodie");
    expect(visual.mouth.kind).toBe("drool");
    expect(visual.eyes.kind).toBe("glasses");
    expect(visual.hat.kind).toBe("halo");
  });

  it("uses the metadata trait hash in the runtime texture cache key", () => {
    const profile: CharacterProfile = {
      id: "s2-16",
      displayName: "D.Y.O.O.R #16",
      tokenId: 16,
      textureKey: "untrusted-host-key",
      placeholder: true,
      traits: traits({ Droid: "Lime Green" }),
      metadataVersion: "1",
      traitHash: "fnv1a-12345678",
    };
    const original = metadataSpriteTextureKey(profile);
    const changed = metadataSpriteTextureKey({
      ...profile,
      traitHash: "fnv1a-87654321",
    });
    expect(original).toBe("droid-meta-token-16-fnv1a-12345678");
    expect(changed).not.toBe(original);
  });
});
