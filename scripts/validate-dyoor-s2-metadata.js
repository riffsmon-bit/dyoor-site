import {
  REQUIRED_TRAIT_TYPES,
  buildTokenMetadata,
  getMetadataConfig,
} from "../lib/dyoor-s2-metadata.js";

const config = getMetadataConfig();
const invalid = [];
let valid = 0;
let missingBaseMetadata = 0;
let fallbackMetadata = 0;
let overrideCount = 0;

function validateToken(tokenId) {
  const result = buildTokenMetadata(tokenId, config);
  const metadata = result.metadata;
  const errors = [];

  try {
    JSON.parse(JSON.stringify(metadata));
  } catch {
    errors.push("metadata is not JSON serializable");
  }

  if (!metadata || typeof metadata !== "object") errors.push("metadata is not an object");
  if (!metadata.name || typeof metadata.name !== "string") errors.push("missing name");
  if (!metadata.image || typeof metadata.image !== "string") {
    errors.push("missing image");
  } else if (!metadata.image.startsWith(`ipfs://${config.imageCid}/`)) {
    errors.push(`image does not use expected CID ${config.imageCid}`);
  }
  if (!Array.isArray(metadata.attributes)) errors.push("attributes is not an array");

  const traitTypes = new Set(Array.isArray(metadata.attributes)
    ? metadata.attributes.map((attribute) => String(attribute?.trait_type || ""))
    : []);

  for (const traitType of REQUIRED_TRAIT_TYPES) {
    if (!traitTypes.has(traitType)) {
      errors.push(`missing trait type ${traitType}`);
    }
  }

  if (!result.baseFound) missingBaseMetadata += 1;
  if (result.usedFallback) fallbackMetadata += 1;
  if (result.overrideFound) overrideCount += 1;

  if (errors.length) {
    invalid.push({ tokenId, errors });
  } else {
    valid += 1;
  }
}

for (let tokenId = 1; tokenId <= config.maxSupply; tokenId += 1) {
  validateToken(tokenId);
}

console.log(JSON.stringify({
  checked: config.maxSupply,
  valid,
  invalid: invalid.length,
  missingBaseMetadata,
  fallbackMetadata,
  overrideCount,
  imageCid: config.imageCid,
}, null, 2));

if (invalid.length) {
  console.error(JSON.stringify({ invalid: invalid.slice(0, 25) }, null, 2));
  process.exit(1);
}
