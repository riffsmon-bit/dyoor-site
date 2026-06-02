import {
  ASCENSION_BLUEPRINT_TRAITS,
  checkExactBlueprintMatch,
  normalizeWalletAddress,
  rewardDescriptionForTier
} from "/src/ascensionBlueprintHelpers.js";

const tokenInput = document.getElementById("tokenIdInput");
const checkBtn = document.getElementById("checkBlueprintBtn");
const statusEl = document.getElementById("checkerStatus");
const resultEl = document.getElementById("checkerResult");
const blueprintTraitsEl = document.getElementById("blueprintTraits");
const mintedTraitsEl = document.getElementById("mintedTraits");

let wallet = "";

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function traitGrid(container, traits, comparison = null) {
  if (!container) return;
  container.innerHTML = "";
  const mismatches = new Set((comparison?.mismatchTraits || []).map((item) => item.trait));
  const missing = new Set((comparison?.missingTraits || []).map((item) => item.trait));
  const matched = new Set(comparison?.matchedTraits || []);

  for (const trait of ASCENSION_BLUEPRINT_TRAITS) {
    const div = document.createElement("div");
    div.className = "checkerTrait";
    if (matched.has(trait)) div.classList.add("is-match");
    if (mismatches.has(trait) || missing.has(trait)) div.classList.add("is-mismatch");
    div.innerHTML = `<strong>${trait}</strong><span>${traits?.[trait] || "-"}</span>`;
    container.appendChild(div);
  }
}

async function runCheck() {
  const tokenId = String(tokenInput?.value || "").trim();
  wallet = normalizeWalletAddress(window.userAddress || wallet);

  if (!wallet) {
    setStatus("Connect wallet first.");
    document.getElementById("homeWalletBtn")?.click();
    return;
  }

  if (!tokenId) {
    setStatus("Enter a token ID.");
    return;
  }

  checkBtn.disabled = true;
  setStatus("Checking saved Blueprint and minted metadata...");

  try {
    const result = await checkExactBlueprintMatch(wallet, tokenId);
    traitGrid(blueprintTraitsEl, result.blueprint.traits, result);
    traitGrid(mintedTraitsEl, result.mintedTraits, result);

    const claimStatus = "Claim status: pending admin confirmation";
    const ownership = result.ownershipConfirmed === null
      ? "Ownership/minter data unavailable in metadata."
      : result.ownershipConfirmed
        ? "Ownership/minter wallet confirmed."
        : "Ownership/minter wallet does not match connected wallet.";

    resultEl.innerHTML = result.exactMatch
      ? `<strong>Exact Blueprint Match Confirmed</strong><br>Reward Tier: ${result.rewardTier}<br>${rewardDescriptionForTier(result.rewardTier)}<br>Eligible Wallet: ${result.wallet}<br>Token ID: ${result.tokenId}<br>Matched Traits: ${result.matchedTraits.join(", ")}<br>${ownership}<br>${claimStatus}`
      : `<strong>Not an exact match</strong><br>Completion: ${result.completionPercent}%<br>${ownership}<br>Missing: ${result.missingTraits.length}<br>Mismatches: ${result.mismatchTraits.length}`;

    setStatus("Check complete. Frontend results remain provisional until admin confirmation.");
  } catch (err) {
    traitGrid(blueprintTraitsEl, {});
    traitGrid(mintedTraitsEl, {});
    resultEl.textContent = "No result.";
    setStatus(err?.message || "Could not check Blueprint match.");
  } finally {
    checkBtn.disabled = false;
  }
}

window.addEventListener("dyoor:wallet", (event) => {
  wallet = normalizeWalletAddress(event?.detail?.userAddress || window.userAddress || "");
  setStatus(wallet ? `Connected wallet: ${wallet}` : "Connect wallet and enter a token ID.");
});

checkBtn?.addEventListener("click", runCheck);
traitGrid(blueprintTraitsEl, {});
traitGrid(mintedTraitsEl, {});
