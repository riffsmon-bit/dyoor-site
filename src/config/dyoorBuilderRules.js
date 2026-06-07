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
  "Torn Black Tee.png",
  "Torn Tee.png",
  "Torn Tee 2.png",
  "White Tee.png",
  "White Tee 2.png"
];

function incompatibleWithMany({ category, files, withCategory, withFiles, message }) {
  return files.flatMap((file) => withFiles.map((withFile) => ({
    type: "incompatible",
    trait: { category, file },
    with: { category: withCategory, file: withFile },
    message
  })));
}

export const DYOOR_BUILDER_RULES = [
  {
    type: "disabled",
    trait: { category: "Mouth", file: "Bendette.png" },
    message: "This mouth trait is disabled for the public builder."
  },
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
  ...incompatibleWithMany({
    category: "Accessories",
    files: ["Bandaid.png"],
    withCategory: "Hat",
    withFiles: FACE_MASKS,
    message: "Bandaid does not work with face masks."
  }),
  {
    type: "incompatible",
    trait: { category: "Accessories", file: "Bandaid.png" },
    with: { category: "Eyes", file: "VR Headset.png" },
    message: "Bandaid does not work with VR headset."
  },
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
  ...incompatibleWithMany({
    category: "Accessories",
    files: ["BOB-chain.png"],
    withCategory: "Mouth",
    withFiles: FACE_COVERING_MOUTHS,
    message: "BOB Chain does not work with bandannas."
  }),
  ...incompatibleWithMany({
    category: "Accessories",
    files: ["Choker Necklace.png"],
    withCategory: "Mouth",
    withFiles: FACE_COVERING_MOUTHS,
    message: "Choker Necklace does not work with bandannas."
  }),
  {
    type: "onlyWith",
    trait: { category: "Accessories", file: "BOB-chain.png" },
    allowedEmptyCategories: ["Clothes"],
    allowedWith: TEE_SHIRTS.map((file) => ({ category: "Clothes", file })),
    message: "BOB Chain only works with tee shirts or no clothing."
  }
];
