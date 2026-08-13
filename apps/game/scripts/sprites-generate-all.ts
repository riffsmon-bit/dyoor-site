import { printReadOnlyBanner, positiveIntegerArg } from "./lib/cli";
import { loadAllMetadata } from "./lib/metadata";
import { generateTokenSprite, loadTraitManifest } from "./lib/sprites";

printReadOnlyBanner("Regenerate only changed droid sprite sheets");

const metadata = await loadAllMetadata();
if (metadata.failures.length) {
  throw new Error(`Sprite generation requires complete metadata; ${metadata.failures.length} record(s) failed.`);
}
const manifest = await loadTraitManifest();
const limit = positiveIntegerArg("--limit", metadata.records.length, metadata.records.length);
const records = metadata.records.slice(0, limit);
const concurrency = positiveIntegerArg("--concurrency", 4, 8);
let cursor = 0;
let completed = 0;
let cached = 0;
let placeholders = 0;
let ready = 0;

async function worker() {
  while (cursor < records.length) {
    const index = cursor;
    cursor += 1;
    const metadataRecord = records[index];
    if (!metadataRecord) continue;
    const result = await generateTokenSprite(metadataRecord, manifest);
    completed += 1;
    if (result.cached) cached += 1;
    if (result.status === "placeholder") placeholders += 1;
    else ready += 1;
    if (completed % 100 === 0 || completed === records.length) {
      console.log(`sprites ${completed}/${records.length} · cached=${cached} · placeholder=${placeholders} · ready=${ready}`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
console.log(JSON.stringify({ completed, cached, placeholders, ready }, null, 2));
