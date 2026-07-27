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

test("targeted OpenSea refreshes are secret-protected and contract-allowlisted", () => {
  const source = fs.readFileSync(
    "app/api/s2/trait-lab/opensea-refresh/route.ts",
    "utf8",
  );

  assert.match(source, /action\s*===\s*"refresh-token"/);
  assert.match(source, /verifyTraitBountyProcessorSecret/);
  assert.match(source, /x-dyoor-bounty-secret/);
  assert.match(source, /refreshOpenSeaTokenMetadataNowAndLater/);
  assert.match(source, /getAddress\(dyoorS2Contract\)/);
  assert.match(source, /DEFAULT_WORLD_NAMES_CONTRACT/);
  assert.match(source, /That contract is not eligible for metadata refreshes/);
  assert.match(source, /A valid uint256 token ID is required/);
});
