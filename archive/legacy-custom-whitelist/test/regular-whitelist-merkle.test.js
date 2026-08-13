import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWhitelistMerkle,
  parseWhitelistSource,
  verifyProof,
  whitelistLeaf,
  ZERO_ADDRESS,
  DEAD_ADDRESS,
} from "../scripts/regular-whitelist-merkle-lib.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";

test("parses comma-separated whitelist input deterministically", () => {
  const first = buildWhitelistMerkle({
    contents: `${B}, ${A}\r\n${C}\n`,
    expectedCount: 3,
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  const second = buildWhitelistMerkle({
    contents: `${C}\n${B}\n${A}\n`,
    expectedCount: 3,
    generatedAt: "2026-07-12T00:00:00.000Z",
  });

  assert.equal(first.walletCount, 3);
  assert.equal(first.defaultAllowance, "3");
  assert.equal(first.root, second.root);
  assert.deepEqual(first.rows.map((row) => row.lower), [
    A.toLowerCase(),
    B.toLowerCase(),
    C.toLowerCase(),
  ]);
});

test("rejects malformed, zero, dead, and duplicate addresses", () => {
  const duplicate = parseWhitelistSource(`${A},${A}`);
  assert.equal(duplicate.duplicateRows.length, 1);

  assert.throws(
    () => buildWhitelistMerkle({ contents: `${A},not-an-address`, expectedCount: 2 }),
    /Invalid whitelist addresses/,
  );
  assert.throws(
    () => buildWhitelistMerkle({ contents: `${A},${ZERO_ADDRESS}`, expectedCount: 2 }),
    /Excluded burn\/null addresses/,
  );
  assert.throws(
    () => buildWhitelistMerkle({ contents: `${A},${DEAD_ADDRESS}`, expectedCount: 2 }),
    /Excluded burn\/null addresses/,
  );
  assert.throws(
    () => buildWhitelistMerkle({ contents: `${A},${A}`, expectedCount: 2 }),
    /Duplicate whitelist addresses/,
  );
});

test("generates proofs that verify and fail on modified inputs", () => {
  const tree = buildWhitelistMerkle({
    contents: `${A},${B},${C}`,
    expectedCount: 3,
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  const entry = tree.proofs[A.toLowerCase()];

  assert.equal(verifyProof({
    proof: entry.proof,
    root: tree.root,
    leaf: whitelistLeaf(A, 3n),
  }), true);
  assert.equal(verifyProof({
    proof: entry.proof,
    root: tree.root,
    leaf: whitelistLeaf("0x1111111111111111111111111111111111111112", 3n),
  }), false);
  assert.equal(verifyProof({
    proof: entry.proof,
    root: tree.root,
    leaf: whitelistLeaf(A, 4n),
  }), false);
});

test("fails loudly when expected wallet count changes", () => {
  assert.throws(
    () => buildWhitelistMerkle({ contents: `${A},${B}`, expectedCount: 12_612 }),
    /Expected 12612 unique wallets; found 2/,
  );
});
