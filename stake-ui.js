(function () {
  const OWNER_ADDRESS = "0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6";
  const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
  const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
  const MAX_SCAN = 1111;
  const ZERO = "0x0000000000000000000000000000000000000000";

  let batteryFill;
  let batteryPercent;
  let batteryMeta;
  let batteryState;

  let progressApproval;
  let progressDeposit;
  let progressRegister;
  let progressApprovalText;
  let progressDepositText;
  let progressRegisterText;

  let recoveryPanel;
  let recoveryList;
  let recoveryText;
  let fixAscensionBtn;

  let adminPanel;
  let snapshotBtn;
  let snapshotUnregisteredBtn;

  let lastKnownUserPending = [];
  let uiBooted = false;
  let statusPatched = false;
  let loadStatePatched = false;

  function safeLower(x) {
    return String(x || "").toLowerCase();
  }

  function cacheDom() {
    batteryFill = document.getElementById("batteryFill");
    batteryPercent = document.getElementById("batteryPercent");
    batteryMeta = document.getElementById("batteryMeta");
    batteryState = document.getElementById("batteryState");

    progressApproval = document.getElementById("progressApproval");
    progressDeposit = document.getElementById("progressDeposit");
    progressRegister = document.getElementById("progressRegister");
    progressApprovalText = document.getElementById("progressApprovalText");
    progressDepositText = document.getElementById("progressDepositText");
    progressRegisterText = document.getElementById("progressRegisterText");

    recoveryPanel = document.getElementById("recoveryPanel");
    recoveryList = document.getElementById("recoveryList");
    recoveryText = recoveryPanel ? recoveryPanel.querySelector(".muted") : null;
    fixAscensionBtn = document.getElementById("fixAscensionBtn");

    adminPanel = document.getElementById("adminPanel");
    snapshotBtn = document.getElementById("snapshotBtn");
    snapshotUnregisteredBtn = document.getElementById("snapshotUnregisteredBtn");
  }

  function setProgressState(stepEl, textEl, state, text) {
    if (!stepEl || !textEl) return;
    stepEl.classList.remove("is-active", "is-done");
    if (state === "active") stepEl.classList.add("is-active");
    if (state === "done") stepEl.classList.add("is-done");
    textEl.textContent = text;
  }

  function resetProgress() {
    setProgressState(progressApproval, progressApprovalText, "", "Waiting");
    setProgressState(progressDeposit, progressDepositText, "", "Waiting");
    setProgressState(progressRegister, progressRegisterText, "", "Waiting");
  }

  function updateBatteryFromPage() {
    const walletCards = Array.isArray(window.ownedNfts) ? window.ownedNfts.length : 0;
    const stakedCards = Array.isArray(window.stakedNfts) ? window.stakedNfts.length : 0;
    const total = walletCards + stakedCards;
    const pct = total > 0 ? Math.round((stakedCards / total) * 100) : 0;

    if (batteryFill) batteryFill.style.width = `${pct}%`;
    if (batteryPercent) batteryPercent.textContent = `${pct}%`;
    if (batteryMeta) batteryMeta.textContent = `${stakedCards} ascended / ${total} total visible`;

    let label = "Dormant";
    if (pct === 100 && total > 0) label = "Fully Ascended ⚡";
    else if (pct >= 50) label = "Stabilizing";
    else if (pct > 0) label = "Charging";

    if (batteryState) batteryState.textContent = label;
  }

  async function showAdminIfOwner() {
    if (!window.provider || !window.userAddress || !window.ethers) return;

    try {
      const staking = new ethers.Contract(
        STAKING_ADDRESS,
        ["function owner() view returns (address)"],
        window.provider
      );
      const owner = await staking.owner();

      if (
        safeLower(owner) === safeLower(window.userAddress) ||
        safeLower(window.userAddress) === safeLower(OWNER_ADDRESS)
      ) {
        adminPanel?.classList.remove("hidden");
        snapshotBtn?.classList.remove("hidden");
        snapshotUnregisteredBtn?.classList.remove("hidden");
      } else {
        adminPanel?.classList.add("hidden");
      }
    } catch {
      adminPanel?.classList.add("hidden");
    }
  }

  async function buildSnapshot() {
    if (!window.provider || !window.ethers) throw new Error("Provider unavailable.");

    const provider = window.provider;
    const nft = new ethers.Contract(
      NFT_ADDRESS,
      ["function ownerOf(uint256 tokenId) view returns (address)"],
      provider
    );

    const staking = new ethers.Contract(
      STAKING_ADDRESS,
      [
        "function stakeInfo(uint256 tokenId) view returns (address owner, uint64 stakedAt)",
        "function pendingPoints(address user) view returns (uint256)"
      ],
      provider
    );

    const stakersMap = new Map();
    const unregistered = [];

    for (let tokenId = 1; tokenId <= MAX_SCAN; tokenId++) {
      let owner;
      try {
        owner = await nft.ownerOf(tokenId);
      } catch {
        continue;
      }

      if (safeLower(owner) !== safeLower(STAKING_ADDRESS)) continue;

      try {
        const info = await staking.stakeInfo(tokenId);
        const trackedOwner = info.owner;

        if (trackedOwner && safeLower(trackedOwner) !== safeLower(ZERO)) {
          const key = ethers.getAddress(trackedOwner);
          if (!stakersMap.has(key)) {
            stakersMap.set(key, {
              wallet: key,
              tokenIds: [],
              firstStakedAt: Number(info.stakedAt) || 0,
              pendingPoints: "0"
            });
          }
          const row = stakersMap.get(key);
          row.tokenIds.push(tokenId);
          if (Number(info.stakedAt) && (!row.firstStakedAt || Number(info.stakedAt) < row.firstStakedAt)) {
            row.firstStakedAt = Number(info.stakedAt);
          }
        } else {
          unregistered.push(tokenId);
        }
      } catch {
        unregistered.push(tokenId);
      }
    }

    for (const [, row] of stakersMap) {
      try {
        const pending = await staking.pendingPoints(row.wallet);
        row.pendingPoints = ethers.formatEther(pending);
      } catch {
        row.pendingPoints = "0";
      }
    }

    return {
      stakers: Array.from(stakersMap.values()).sort((a, b) => b.tokenIds.length - a.tokenIds.length),
      unregistered
    };
  }

  function downloadFile(filename, body) {
    const blob = new Blob([body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleSnapshot() {
    const { stakers } = await buildSnapshot();
    let csv = "wallet,tokenIds,count,pendingPoints,firstStakedAt\n";
    stakers.forEach((s) => {
      csv += `${s.wallet},"${s.tokenIds.join("|")}",${s.tokenIds.length},${s.pendingPoints},${s.firstStakedAt}\n`;
    });
    downloadFile("dyoor_stakers_snapshot.csv", csv);
  }

  async function handleSnapshotUnregistered() {
    const { unregistered } = await buildSnapshot();
    let csv = "tokenId\n";
    unregistered.forEach((id) => {
      csv += `${id}\n`;
    });
    downloadFile("dyoor_unregistered_deposits.csv", csv);
  }

  function tokenIdTopic(tokenId) {
    return ethers.zeroPadValue(ethers.toBeHex(tokenId), 32);
  }

  async function getLatestDepositorForToken(tokenId) {
    if (!window.provider || !window.ethers) return null;

    const provider = window.provider;
    const transferTopic = ethers.id("Transfer(address,address,uint256)");
    const stakingTopic = ethers.zeroPadValue(STAKING_ADDRESS, 32);
    const topicTokenId = tokenIdTopic(tokenId);

    try {
      const logs = await provider.getLogs({
        address: NFT_ADDRESS,
        fromBlock: 0,
        toBlock: "latest",
        topics: [transferTopic, null, stakingTopic, topicTokenId]
      });

      if (!logs.length) return null;

      const last = logs[logs.length - 1];
      const fromTopic = last.topics[1];
      const depositor = ethers.getAddress("0x" + fromTopic.slice(26));
      return depositor;
    } catch (err) {
      console.warn(`Could not resolve depositor for token #${tokenId}`, err);
      return null;
    }
  }

  async function findPendingDepositsForCurrentWallet() {
    if (!window.provider || !window.ethers || !window.userAddress) {
      return { mine: [], all: [] };
    }

    const provider = window.provider;
    const nft = new ethers.Contract(
      NFT_ADDRESS,
      ["function ownerOf(uint256 tokenId) view returns (address)"],
      provider
    );

    const staking = new ethers.Contract(
      STAKING_ADDRESS,
      ["function stakeInfo(uint256 tokenId) view returns (address owner, uint64 stakedAt)"],
      provider
    );

    const allPending = [];
    const mine = [];

    for (let tokenId = 1; tokenId <= MAX_SCAN; tokenId++) {
      let owner;
      try {
        owner = await nft.ownerOf(tokenId);
      } catch {
        continue;
      }

      if (safeLower(owner) !== safeLower(STAKING_ADDRESS)) continue;

      try {
        const info = await staking.stakeInfo(tokenId);
        if (info.owner && safeLower(info.owner) !== safeLower(ZERO)) {
          continue;
        }
      } catch {
        // treat as pending if stakeInfo can't be read cleanly
      }

      allPending.push(tokenId);

      const depositor = await getLatestDepositorForToken(tokenId);
      if (depositor && safeLower(depositor) === safeLower(window.userAddress)) {
        mine.push(tokenId);
      }
    }

    return { mine, all: allPending };
  }

  function renderRecovery(result) {
    const mine = result?.mine || [];
    const all = result?.all || [];
    lastKnownUserPending = mine.slice();

    if (!mine.length) {
      recoveryPanel?.classList.add("hidden");
      if (recoveryList) recoveryList.innerHTML = "";
      return;
    }

    recoveryPanel?.classList.remove("hidden");

    if (recoveryText) {
      recoveryText.textContent =
        `NFTs you deposited into the staking contract but have not yet fully registered. ` +
        `Detected ${mine.length} pending token${mine.length === 1 ? "" : "s"} for this wallet.`;
    }

    if (recoveryList) {
      recoveryList.innerHTML = mine
        .map((id) => `<span class="token-chip">#${id}</span>`)
        .join("");
    }

    if (fixAscensionBtn) {
      fixAscensionBtn.textContent =
        mine.length > 1 ? `Fix All (${mine.length})` : "Complete Registration";
      fixAscensionBtn.disabled = mine.length === 0;
      fixAscensionBtn.title =
        all.length > mine.length
          ? "Only your pending deposits are shown and fixable from this wallet."
          : "Register your pending deposits.";
    }
  }

  async function handleFixRegistration() {
    if (!lastKnownUserPending.length) {
      alert("No pending deposits found for this wallet.");
      return;
    }

    if (!window.userAddress || !window.ethereum || !window.ethers) {
      alert("Connect wallet first.");
      return;
    }

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{
        from: window.userAddress,
        to: STAKING_ADDRESS,
        gas: "0xC3500",
        data: new ethers.Interface([
          "function stakeDeposited(uint256[] calldata tokenIds)"
        ]).encodeFunctionData("stakeDeposited", [lastKnownUserPending.map((x) => BigInt(x))])
      }]
    });

    if (typeof window.waitForHash === "function") {
      await window.waitForHash(txHash);
    }
    location.reload();
  }

  function patchStatusForProgress() {
    if (statusPatched || typeof window.setStatus !== "function") return;
    statusPatched = true;

    const originalSetStatus = window.setStatus;
    window.setStatus = function patchedSetStatus(message) {
      originalSetStatus(message);

      const text = String(message || "");
      if (text.includes("Approval required")) {
        setProgressState(progressApproval, progressApprovalText, "active", "Confirm");
      } else if (text.includes("Preparing")) {
        resetProgress();
        setProgressState(progressApproval, progressApprovalText, "active", "Checking");
      } else if (text.includes("Depositing")) {
        setProgressState(progressApproval, progressApprovalText, "done", "Done");
        setProgressState(progressDeposit, progressDepositText, "active", "Processing");
      } else if (text.includes("Registering")) {
        setProgressState(progressDeposit, progressDepositText, "done", "Done");
        setProgressState(progressRegister, progressRegisterText, "active", "Processing");
      } else if (text.includes("Ascension complete")) {
        setProgressState(progressApproval, progressApprovalText, "done", "Done");
        setProgressState(progressDeposit, progressDepositText, "done", "Done");
        setProgressState(progressRegister, progressRegisterText, "done", "Done");
      } else if (text.includes("Ascension state synchronized")) {
        updateBatteryFromPage();
      }
    };
  }

  async function refreshUiPanels() {
    updateBatteryFromPage();
    await showAdminIfOwner();
    const pending = await findPendingDepositsForCurrentWallet();
    renderRecovery(pending);
  }

  function bindEvents() {
    fixAscensionBtn?.addEventListener("click", handleFixRegistration);
    snapshotBtn?.addEventListener("click", handleSnapshot);
    snapshotUnregisteredBtn?.addEventListener("click", handleSnapshotUnregistered);
  }

  function patchLoadState() {
    if (loadStatePatched || typeof window.loadState !== "function") return;
    loadStatePatched = true;

    const originalLoadState = window.loadState;
    window.loadState = async function wrappedLoadState(...args) {
      const result = await originalLoadState.apply(this, args);
      await refreshUiPanels();
      return result;
    };
  }

  function coreReady() {
    return (
      typeof window.loadState === "function" &&
      typeof window.setStatus === "function" &&
      !!window.ethers
    );
  }

  function boot() {
    if (uiBooted) return;
    cacheDom();

    if (!coreReady()) {
      setTimeout(boot, 400);
      return;
    }

    uiBooted = true;
    patchStatusForProgress();
    patchLoadState();
    bindEvents();
    resetProgress();

    setTimeout(async () => {
      try {
        await refreshUiPanels();
      } catch (err) {
        console.warn("stake-ui refresh warning:", err);
      }
    }, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();