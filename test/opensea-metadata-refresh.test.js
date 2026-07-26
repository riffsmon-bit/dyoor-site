import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const refreshSource = fs.readFileSync("lib/opensea-metadata-refresh.ts", "utf8");

test("a missing OpenSea API key remains a retryable refresh failure", () => {
  const missingKeyStart = refreshSource.indexOf('const apiKey = readEnv("OPENSEA_API_KEY")');
  const requestStart = refreshSource.indexOf("const controller = new AbortController()", missingKeyStart);
  const missingKeySource = refreshSource.slice(missingKeyStart, requestStart);

  assert.ok(missingKeyStart >= 0 && requestStart > missingKeyStart);
  assert.match(missingKeySource, /status:\s*"failed"/);
  assert.match(missingKeySource, /OPENSEA_API_KEY is not configured/);
  assert.match(missingKeySource, /remains queued/);
  assert.doesNotMatch(missingKeySource, /status:\s*"skipped"/);
});

test("an intentionally disabled OpenSea refresh is a terminal skip", () => {
  const disabledStart = refreshSource.indexOf('if (envFlag(readEnv("OPENSEA_METADATA_REFRESH_DISABLED"');
  const missingKeyStart = refreshSource.indexOf('const apiKey = readEnv("OPENSEA_API_KEY")', disabledStart);
  const disabledSource = refreshSource.slice(disabledStart, missingKeyStart);

  assert.ok(disabledStart >= 0 && missingKeyStart > disabledStart);
  assert.match(disabledSource, /status:\s*"skipped"/);
  assert.match(disabledSource, /disabled by environment/);
});

test("Netlify processes the persistent OpenSea refresh queue every two minutes", () => {
  const source = fs.readFileSync("netlify/functions/opensea-refresh-queue.js", "utf8");
  assert.match(source, /exports\.config\s*=\s*\{\s*schedule:\s*"\*\/2 \* \* \* \*"\s*\}/);
  assert.match(source, /\/api\/s2\/trait-lab\/opensea-refresh/);
});
