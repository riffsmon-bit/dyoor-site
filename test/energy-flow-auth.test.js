import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import {
  canonicalTraitLabPreviewAction,
  traitLabConfirmationAuthorizationMessage,
  traitLabForfeitAuthorizationMessage,
  traitLabPreviewAuthorizationMessage,
} from "../lib/s2-trait-lab-auth.ts";

test("Trait Lab roll authorization binds the wallet and requested mutation", async () => {
  const signer = ethers.Wallet.createRandom();
  const timestamp = "1784682000000";
  const nonce = "f7a70e70-f9b4-46d0-b303-d17bffaf91bf";
  const message = traitLabPreviewAuthorizationMessage({
    wallet: signer.address,
    tokenId: 42,
    traitType: "Eyes",
    action: "reroll",
    timestamp,
    nonce,
  });
  const signature = await signer.signMessage(message);

  assert.equal(ethers.verifyMessage(message, signature), signer.address);
  assert.notEqual(
    ethers.verifyMessage(message, signature),
    ethers.verifyMessage(traitLabPreviewAuthorizationMessage({
      wallet: signer.address,
      tokenId: 43,
      traitType: "Eyes",
      action: "reroll",
      timestamp,
      nonce,
    }), signature),
  );
  assert.match(message, /Token ID: 42/);
  assert.match(message, /Action: reroll/);
});

test("Trait Lab legacy action aliases have one canonical signed representation", () => {
  assert.equal(canonicalTraitLabPreviewAction("remove"), "recycle");
  assert.equal(canonicalTraitLabPreviewAction("reroll-all"), "rerollAll");
  assert.equal(canonicalTraitLabPreviewAction("unlock"), "unlock");
});

test("Trait Lab confirmation authorization binds the paid preview and proposed result", async () => {
  const signer = ethers.Wallet.createRandom();
  const input = {
    wallet: signer.address,
    tokenId: 42,
    traitType: "Eyes",
    action: "reroll",
    paymentMode: "energy",
    proposedValue: "Laser Eyes",
    costLabel: "100 Energy",
    costRaw: "100000000000000000000",
    previewId: "preview.payload.signature",
    timestamp: "1784682000000",
    nonce: "93c14bc8-e728-4e04-bf7d-52ac403c9c84",
  };
  const message = traitLabConfirmationAuthorizationMessage(input);
  const signature = await signer.signMessage(message);

  assert.equal(ethers.verifyMessage(message, signature), signer.address);
  assert.notEqual(
    ethers.verifyMessage(traitLabConfirmationAuthorizationMessage({
      ...input,
      proposedValue: "Different Eyes",
    }), signature),
    signer.address,
  );
  assert.notEqual(
    ethers.verifyMessage(traitLabConfirmationAuthorizationMessage({
      ...input,
      previewId: "different.preview.signature",
    }), signature),
    signer.address,
  );
});

test("Trait Lab leave-result authorization binds the exact roll and preview", async () => {
  const signer = ethers.Wallet.createRandom();
  const input = {
    wallet: signer.address,
    tokenId: 42,
    rollId: `0x${"a".repeat(64)}`,
    previewId: "preview.payload.signature",
    timestamp: "1784682000000",
    nonce: "161d9e38-5d4e-473e-a2bb-a92242dc91fd",
  };
  const message = traitLabForfeitAuthorizationMessage(input);
  const signature = await signer.signMessage(message);

  assert.equal(ethers.verifyMessage(message, signature), signer.address);
  assert.notEqual(
    ethers.verifyMessage(traitLabForfeitAuthorizationMessage({
      ...input,
      rollId: `0x${"b".repeat(64)}`,
    }), signature),
    signer.address,
  );
  assert.notEqual(
    ethers.verifyMessage(traitLabForfeitAuthorizationMessage({
      ...input,
      previewId: "another.preview.signature",
    }), signature),
    signer.address,
  );
});
