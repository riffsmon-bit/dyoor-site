import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const manifest = JSON.parse(fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-mainnet-launch-manifest.json",
  "utf8",
));
const bundleRoot = path.join(
  "data",
  "robinhood",
  "security-review",
  `hoodyoor-mainnet-${manifest.sourceTree.canonicalKeccak256.slice(2, 18)}`,
);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("HoodYØØR review bundle is exact-source, checksummed, and never self-approving", () => {
  const scope = JSON.parse(fs.readFileSync(path.join(bundleRoot, "REVIEW_SCOPE.json"), "utf8"));
  assert.equal(
    scope.approvalPolicy.productionSourceTreeKeccak256,
    manifest.sourceTree.canonicalKeccak256,
  );
  assert.equal(scope.approvalPolicy.automaticApproval, false);
  assert.equal(scope.publicBlockhashCanary.status, "validated");
  assert.equal(scope.ownerDecisions.securityReview.status, "explicit-owner-waiver");
  assert.equal(scope.ownerDecisions.securityReview.independentlyReviewed, false);

  const checksumLines = fs.readFileSync(path.join(bundleRoot, "CHECKSUMS.sha256"), "utf8")
    .trim()
    .split("\n");
  assert.ok(checksumLines.length > 100);
  for (const line of checksumLines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    assert.ok(match, line);
    const [, expected, relativePath] = match;
    assert.equal(sha256(fs.readFileSync(path.join(bundleRoot, relativePath))), expected, relativePath);
    assert.doesNotMatch(relativePath, /data\/game\/private/);
    if (!relativePath.endsWith("/.env.example")) {
      assert.doesNotMatch(relativePath, /(^|\/)\.env($|\.)/);
    }
  }

  const attestation = fs.readFileSync(
    path.join(bundleRoot, "REVIEW_ATTESTATION_TEMPLATE.md"),
    "utf8",
  );
  assert.match(attestation, /not an approval/i);
  assert.match(attestation, new RegExp(manifest.sourceTree.canonicalKeccak256, "i"));
});
