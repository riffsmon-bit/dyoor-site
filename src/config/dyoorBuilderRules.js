// Trait rule config for the public Droid builder.
// Keep this file data-only so real NFT rules can be pasted in without changing builder code.
//
// Supported rule shapes:
// {
//   type: "disabled",
//   trait: { category: "Mouth", file: "example.png" },
//   message: "This trait is disabled for the public builder."
// }
//
// {
//   type: "incompatible",
//   trait: { category: "Hat", file: "example.png" },
//   with: { category: "Eyes", file: "example-eyes.png" },
//   message: "This hat does not work with those eyes."
// }
//
// {
//   type: "requires",
//   trait: { category: "Accessories", file: "example.png" },
//   requires: { category: "Clothes", file: "example-clothes.png" },
//   message: "This accessory requires the matching clothes."
// }
//
// {
//   type: "onlyWith",
//   trait: { category: "Eyes", file: "example.png" },
//   allowedEmptyCategories: ["Hat"],
//   allowedWith: [
//     { category: "Hat", file: "example-hat.png" }
//   ],
//   message: "These eyes only work with selected hats or no hat."
// }

const SKI_MASKS = [
  "Black Shystie.png",
  "Pink Shystie.png"
];

const FACE_MASKS = [
  ...SKI_MASKS,
  "BOB Mask.png"
];

const LASER_EYES = [
  "Abyss Laser.png",
  "Lazy Laser.png",
  "Radiation Glow.png",
  "Radiation Glow (Red).png",
  "Radiation Glow (Red)Laser.png"
];

const EYEWEAR = [
  "Build Anything Glasses.png",
  "Eye Patch.png",
  "Monad Specs Black.png",
  "Monad Specs Gold.png",
  "Neverland Specs.png",
  "Ricky V.png",
  "Sunglasses.png",
  "Tri-Specs.png",
  "VR Headset.png"
];

const FACE_COVERING_MOUTHS = [
  "Bandana Black.png",
  "Bandana Pink.png"
];

const ACCESSORY_LAYERS = [
  "Accessories",
  "Accessories 2"
];

const ACCESSORIES = [
  "Bandaid.png",
  "Bandana Black.png",
  "Bandana Pink.png",
  "BOB-chain.png",
  "Choker Necklace.png",
  "Molandak.png"
];

const FACE_COVERING_ACCESSORIES = [
  "Bandana Black.png",
  "Bandana Pink.png"
];

const PROTRUDING_MOUTH_PROPS = [
  "Cigar Mouth.png",
  "Displeased toothpick.png",
  "Gold Bar.png",
  "Joint Mouth.png",
  "Meh Cigarette.png",
  "Party Horn Mouth.png",
  "Pipe.png"
];

const TEE_SHIRTS = [
  "Baby Blue Tee.png",
  "Black N White Tee.png",
  "Black N White Tee 2.png",
  "Black Tee.png",
  "Black Tee 2.png",
  "Grey Tee.png",
  "Kuru Tee.png",
  "Neverland Tee.png",
  "PAMPAM Tee.png",
  "Torn Black Tee.png",
  "Torn Tee.png",
  "Torn Tee 2.png",
  "White Tee.png",
  "White Tee 2.png"
];

const DEFAULT_SPECIALS = [
  "Space Suit.png"
];

const CLOTHES_ALLOWED_SPECIALS = [
  "Anime Mask.png",
  "Gimp.png",
  "Green Ski Mask Laser.png",
  "Pink Ski Mask Laser.png"
];

const SKI_MASK_LASER_SPECIALS = [
  "Green Ski Mask Laser.png",
  "Pink Ski Mask Laser.png"
];

function incompatibleWithMany({ category, files, withCategory, withFiles, message }) {
  return files.flatMap((file) => withFiles.map((withFile) => ({
    type: "incompatible",
    trait: { category, file },
    with: { category: withCategory, file: withFile },
    message
  })));
}

function duplicateAccessoryRules() {
  return ACCESSORIES.map((file) => ({
    type: "incompatible",
    trait: { category: "Accessories", file },
    with: { category: "Accessories 2", file },
    message: "The same accessory cannot be equipped in both accessory slots."
  }));
}

function accessoryCrossSlotRules({ files, withFiles, message }) {
  return [
    ...incompatibleWithMany({
      category: "Accessories",
      files,
      withCategory: "Accessories 2",
      withFiles,
      message
    }),
    ...incompatibleWithMany({
      category: "Accessories 2",
      files,
      withCategory: "Accessories",
      withFiles,
      message
    })
  ];
}

function accessoryLayerRules({ files, withCategory, withFiles, message }) {
  return ACCESSORY_LAYERS.flatMap((category) => incompatibleWithMany({
    category,
    files,
    withCategory,
    withFiles,
    message
  }));
}

function specialEmptyRules(files, allowedEmptyCategories, message) {
  return files.map((file) => ({
    type: "onlyWith",
    trait: { category: "Special", file },
    allowedEmptyCategories,
    message
  }));
}

export const DYOOR_BUILDER_RULES = [
  {
    type: "disabled",
    trait: { category: "Mouth", file: "Bendette.png" },
    message: "This mouth trait is disabled for the public builder."
  },
  ...duplicateAccessoryRules(),
  ...accessoryCrossSlotRules({
    files: ["Choker Necklace.png"],
    withFiles: FACE_COVERING_ACCESSORIES,
    message: "Choker Necklace does not work with bandannas."
  }),
  ...incompatibleWithMany({
    category: "Eyes",
    files: LASER_EYES,
    withCategory: "Hat",
    withFiles: FACE_MASKS,
    message: "Laser eyes do not work with face masks."
  }),
  ...incompatibleWithMany({
    category: "Eyes",
    files: EYEWEAR,
    withCategory: "Hat",
    withFiles: FACE_MASKS,
    message: "Glasses and specs do not work with face masks."
  }),
  ...accessoryLayerRules({
    files: ["Bandaid.png"],
    withCategory: "Hat",
    withFiles: FACE_MASKS,
    message: "Bandaid does not work with face masks."
  }),
  ...ACCESSORY_LAYERS.map((category) => ({
    type: "incompatible",
    trait: { category, file: "Bandaid.png" },
    with: { category: "Eyes", file: "VR Headset.png" },
    message: "Bandaid does not work with VR headset."
  })),
  ...incompatibleWithMany({
    category: "Mouth",
    files: FACE_COVERING_MOUTHS,
    withCategory: "Hat",
    withFiles: FACE_MASKS,
    message: "Bandannas do not work with face masks."
  }),
  ...incompatibleWithMany({
    category: "Mouth",
    files: PROTRUDING_MOUTH_PROPS,
    withCategory: "Hat",
    withFiles: FACE_MASKS,
    message: "This mouth prop does not work with face masks."
  }),
  ...accessoryLayerRules({
    files: FACE_COVERING_ACCESSORIES,
    withCategory: "Mouth",
    withFiles: PROTRUDING_MOUTH_PROPS,
    message: "Bandannas do not work with mouth props."
  }),
  ...accessoryLayerRules({
    files: ["BOB-chain.png"],
    withCategory: "Mouth",
    withFiles: FACE_COVERING_MOUTHS,
    message: "BOB Chain does not work with bandannas."
  }),
  ...accessoryLayerRules({
    files: ["Choker Necklace.png"],
    withCategory: "Mouth",
    withFiles: FACE_COVERING_MOUTHS,
    message: "Choker Necklace does not work with bandannas."
  }),
  ...ACCESSORY_LAYERS.map((category) => ({
    type: "onlyWith",
    trait: { category, file: "BOB-chain.png" },
    allowedEmptyCategories: ["Clothes"],
    allowedWith: TEE_SHIRTS.map((file) => ({ category: "Clothes", file })),
    message: "BOB Chain only works with tee shirts or no clothing."
  })),
  ...specialEmptyRules(
    DEFAULT_SPECIALS,
    ["Clothes", "Hat", "Accessories", "Accessories 2"],
    "This special trait hides clothes, hats, and accessories."
  ),
  ...specialEmptyRules(
    CLOTHES_ALLOWED_SPECIALS,
    ["Eyes", "Mouth", "Hat", "Accessories", "Accessories 2"],
    "This special trait hides eyes, mouth, hats, and accessories."
  ),
  ...incompatibleWithMany({
    category: "Special",
    files: ["Space Suit.png"],
    withCategory: "Eyes",
    withFiles: LASER_EYES,
    message: "Space Suit does not work with laser eyes."
  }),
  ...incompatibleWithMany({
    category: "Special",
    files: ["Space Suit.png"],
    withCategory: "Mouth",
    withFiles: ["AHHHH Flames.png", "Party Horn Mouth.png"],
    message: "Space Suit does not work with this mouth trait."
  }),
  ...incompatibleWithMany({
    category: "Special",
    files: SKI_MASK_LASER_SPECIALS,
    withCategory: "Mouth",
    withFiles: ["Pipe.png"],
    message: "Ski mask laser specials do not work with Pipe mouth."
  })
];
