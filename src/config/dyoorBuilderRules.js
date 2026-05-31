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
export const DYOOR_BUILDER_RULES = [
  {
    type: "disabled",
    trait: { category: "Mouth", file: "Bendette.png" },
    message: "This mouth trait is disabled for the public builder."
  },
  {
    type: "onlyWith",
    trait: { category: "Accessories", file: "BOB-chain.png" },
    allowedEmptyCategories: ["Clothes"],
    allowedWith: [
      { category: "Clothes", file: "Baby Blue Tee.png" },
      { category: "Clothes", file: "Black N White Tee.png" },
      { category: "Clothes", file: "Black N White Tee 2.png" },
      { category: "Clothes", file: "Black Tee.png" },
      { category: "Clothes", file: "Black Tee 2.png" },
      { category: "Clothes", file: "Grey Tee.png" },
      { category: "Clothes", file: "Kuru Tee.png" },
      { category: "Clothes", file: "Torn Black Tee.png" },
      { category: "Clothes", file: "Torn Tee.png" },
      { category: "Clothes", file: "Torn Tee 2.png" },
      { category: "Clothes", file: "White Tee.png" },
      { category: "Clothes", file: "White Tee 2.png" }
    ],
    message: "BOB Chain only works with tee shirts or no clothing."
  }
];
