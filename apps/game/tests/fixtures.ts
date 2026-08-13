export function metadataFixture(tokenId = 1) {
  return {
    name: `D.Y.O.O.R #${tokenId}`,
    description: "Fixture metadata",
    image: `ipfs://bafyfixture/${tokenId}.png`,
    attributes: [
      { trait_type: "Background", value: "Grey" },
      { trait_type: "Droid", value: "Red" },
      { trait_type: "Conditions", value: "None" },
      { trait_type: "Stickers/Body art", value: "None" },
      { trait_type: "Clothes", value: "Lab Coat" },
      { trait_type: "Mouth", value: "Deep Thought" },
      { trait_type: "Eyes", value: "Core Scanner" },
      { trait_type: "Hat", value: "None" },
      { trait_type: "Accessories", value: "None" },
      { trait_type: "Accessories 2", value: "None" },
      { trait_type: "Special", value: "Empty Slot" },
    ],
  };
}
