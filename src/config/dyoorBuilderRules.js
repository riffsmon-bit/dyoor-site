// Trait rule config for the public Droid builder.
// Keep this file data-only so real NFT rules can be pasted in without changing builder code.
//
// Supported rule shapes:
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
//   allowedWith: [
//     { category: "Hat", file: "example-hat.png" }
//   ],
//   message: "These eyes only work with selected hats."
// }
export const DYOOR_BUILDER_RULES = [];
