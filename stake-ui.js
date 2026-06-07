(function () {
  const OWNER_ADDRESS = "0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6";
  const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
  const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
  const MAX_SCAN = 1111;
  const RECOVERY_SCAN_CHUNK = 4000n;
  const RECOVERY_STORAGE_KEY = "dyoor-recovery-approvals";
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
  let recoveryStatus;
  let fixAscensionBtn;
  let copyRecoveryBtn;
  let downloadRecoveryBtn;

  let adminPanel;
  let snapshotBtn;
  let snapshotUnregisteredBtn;
  let scanUnregisteredBtn;
  let recoverUnregisteredBtn;
  let adminRecoveryList;
  let adminRecoveryStatus;

  let recoveryCandidates = [];
  let adminUnregisteredCandidates = [];
  const recoveryScanCache = new Map();

  let uiBooted = false;
  let statusPatched = false;
  let loadStatePatched = false;

  function safeLower(x) {
    return String(x || "").toLowerCase();
  }

  function recoveryCacheKey(address) {
    return safeLower(address);
  }

  function normalizeTokenList(tokenIds) {
    return Array.from(
      new Set(
        (Array.isArray(tokenIds) ? tokenIds : [])
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  }

  function sameTokenList(a, b) {
    const left = normalizeTokenList(a);
    const right = normalizeTokenList(b);
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }

  function buildRecoveryMessage(wallet, tokenIds, requestId) {
    const normalizedWallet = ethers.getAddress(wallet);
    const normalizedTokens = normalizeTokenList(tokenIds);
    return [
      "DYOOR Ascension Recovery Approval",
      `Wallet: ${normalizedWallet}`,
      `Token IDs: ${normalizedTokens.join(", ")}`,
      `Request ID: ${requestId}`,
      "This signature approves manual review and repair of missing Ascension registration records."
    ].join("\n");
  }

  function readStoredRecoveryApproval(wallet) {
    if (!wallet) return null;
    try {
      const raw = window.localStorage?.getItem(RECOVERY_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const record = parsed?.[recoveryCacheKey(wallet)];
      if (!record || typeof record !== "object") return null;
      return record;
    } catch {
      return null;
    }
  }

  function writeStoredRecoveryApproval(record) {
    if (!record?.wallet) return;
    try {
      const raw = window.localStorage?.getItem(RECOVERY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[recoveryCacheKey(record.wallet)] = record;
      window.localStorage?.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(parsed));
    } catch (err) {
      console.warn("Unable to persist recovery approval", err);
    }
  }

  function recoveryDownloadPayload(record) {
    return JSON.stringify(record, null, 2);
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
    recoveryStatus = document.getElementById("recoveryStatus");
    fixAscensionBtn = document.getElementById("fixAscensionBtn");
    copyRecoveryBtn = document.getElementById("copyRecoveryBtn");
    downloadRecoveryBtn = document.getElementById("downloadRecoveryBtn");

    adminPanel = document.getElementById("adminPanel");
    snapshotBtn = document.getElementById("snapshotBtn");
    snapshotUnregisteredBtn = document.getElementById("snapshotUnregisteredBtn");
    scanUnregisteredBtn = document.getElementById("scanUnregisteredBtn");
    recoverUnregisteredBtn = document.getElementById("recoverUnregisteredBtn");
    adminRecoveryList = document.getElementById("adminRecoveryList");
    adminRecoveryStatus = document.getElementById("adminRecoveryStatus");
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
        scanUnregisteredBtn?.classList.remove("hidden");
        recoverUnregisteredBtn?.classList.remove("hidden");
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

  function downloadFile(filename, body, mimeType = "text/csv;charset=utf-8;") {
    const blob = new Blob([body], { type: mimeType });
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

  function setAdminRecoveryStatus(message) {
    if (adminRecoveryStatus) adminRecoveryStatus.textContent = message || "";
  }

  function renderAdminRecoveryList(tokenIds) {
    adminUnregisteredCandidates = normalizeTokenList(tokenIds);

    if (adminRecoveryList) {
      adminRecoveryList.innerHTML = adminUnregisteredCandidates.length
        ? adminUnregisteredCandidates.map((id) => `<span class="token-chip">#${id}</span>`).join("")
        : "";
    }

    if (recoverUnregisteredBtn) {
      recoverUnregisteredBtn.disabled = adminUnregisteredCandidates.length === 0;
    }
  }

  function chunkArray(values, size) {
    const out = [];
    for (let i = 0; i < values.length; i += size) {
      out.push(values.slice(i, i + size));
    }
    return out;
  }

  async function handleScanUnregistered() {
    if (!window.provider || !window.ethers) {
      setAdminRecoveryStatus("Connect the owner wallet first.");
      return;
    }

    try {
      scanUnregisteredBtn && (scanUnregisteredBtn.disabled = true);
      recoverUnregisteredBtn && (recoverUnregisteredBtn.disabled = true);
      setAdminRecoveryStatus("Scanning staking contract for unregistered deposits...");
      const { unregistered } = await buildSnapshot();
      renderAdminRecoveryList(unregistered);
      setAdminRecoveryStatus(unregistered.length
        ? `Found ${unregistered.length} unregistered deposit${unregistered.length === 1 ? "" : "s"}.`
        : "No unregistered deposits found.");
    } catch (err) {
      console.error("handleScanUnregistered error", err);
      renderAdminRecoveryList([]);
      setAdminRecoveryStatus(formatError(err, "Recovery scan failed."));
    } finally {
      scanUnregisteredBtn && (scanUnregisteredBtn.disabled = false);
    }
  }

  async function handleRecoverUnregistered() {
    if (!window.signer || !window.ethers || !window.waitForHash) {
      setAdminRecoveryStatus("Connect the owner wallet first.");
      return;
    }

    const tokenIds = normalizeTokenList(adminUnregisteredCandidates);
    if (!tokenIds.length) {
      setAdminRecoveryStatus("Scan first. No recovery tokens are loaded.");
      return;
    }

    try {
      recoverUnregisteredBtn && (recoverUnregisteredBtn.disabled = true);
      scanUnregisteredBtn && (scanUnregisteredBtn.disabled = true);

      const staking = new ethers.Contract(
        STAKING_ADDRESS,
        ["function stakeDeposited(uint256[] calldata tokenIds)"],
        window.signer
      );
      const batches = chunkArray(tokenIds, 25);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i].map((id) => BigInt(id));
        setAdminRecoveryStatus(`Recovering batch ${i + 1} / ${batches.length}: ${batches[i].join(", ")}`);
        await staking.stakeDeposited.staticCall(batch);
        const tx = await staking.stakeDeposited(batch);
        await window.waitForHash(tx.hash);
      }

      setAdminRecoveryStatus(`Recovered ${tokenIds.length} deposit${tokenIds.length === 1 ? "" : "s"}. Refreshing state...`);
      renderAdminRecoveryList([]);
      if (typeof window.loadState === "function") await window.loadState({ force: true });
    } catch (err) {
      console.error("handleRecoverUnregistered error", err);
      setAdminRecoveryStatus(formatError(err, "Owner recovery failed."));
    } finally {
      scanUnregisteredBtn && (scanUnregisteredBtn.disabled = false);
      recoverUnregisteredBtn && (recoverUnregisteredBtn.disabled = adminUnregisteredCandidates.length === 0);
    }
  }

  async function scanRecoveryCandidates(wallet) {
    if (!window.provider || !window.ethers || !wallet) return [];

    const cacheKey = recoveryCacheKey(wallet);
    const cached = recoveryScanCache.get(cacheKey);
    if (cached && Date.now() - cached.time < 45000) {
      return cached.value;
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

    const latestBlock = BigInt(await provider.getBlockNumber());
    const transferTopic = ethers.id("Transfer(address,address,uint256)");
    const fromTopic = ethers.zeroPadValue(ethers.getAddress(wallet), 32);
    const toTopic = ethers.zeroPadValue(ethers.getAddress(STAKING_ADDRESS), 32);
    const discovered = new Set();

    for (let fromBlock = 0n; fromBlock <= latestBlock; fromBlock += RECOVERY_SCAN_CHUNK + 1n) {
      const toBlock = fromBlock + RECOVERY_SCAN_CHUNK > latestBlock
        ? latestBlock
        : fromBlock + RECOVERY_SCAN_CHUNK;

      let logs = [];
      try {
        logs = await provider.getLogs({
          address: NFT_ADDRESS,
          fromBlock: ethers.toQuantity(fromBlock),
          toBlock: ethers.toQuantity(toBlock),
          topics: [transferTopic, fromTopic, toTopic]
        });
      } catch (err) {
        console.warn("recovery log scan chunk failed", err);
        continue;
      }

      for (const log of logs || []) {
        try {
          const tokenId = BigInt(log.topics?.[3] || "0x0");
          if (tokenId > 0n) discovered.add(tokenId.toString());
        } catch {}
      }
    }

    const recovery = [];
    for (const tokenIdText of Array.from(discovered).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))) {
      const tokenId = BigInt(tokenIdText);
      try {
        const owner = await nft.ownerOf(tokenId);
        if (safeLower(owner) !== safeLower(STAKING_ADDRESS)) continue;
      } catch {
        continue;
      }

      try {
        const info = await staking.stakeInfo(tokenId);
        if (info?.owner && safeLower(info.owner) !== safeLower(ZERO)) continue;
      } catch {}

      recovery.push(tokenIdText);
    }

    recoveryScanCache.set(cacheKey, { time: Date.now(), value: recovery });
    return recovery;
  }

  function setRecoveryStatus(message) {
    if (recoveryStatus) recoveryStatus.textContent = message || "";
  }

  function renderRecoveryApproval(record, tokenIds) {
    if (!record) return "No approval saved yet.";
    if (!sameTokenList(record.tokenIds, tokenIds)) {
      return "Saved approval no longer matches the currently detected deposits.";
    }
    return `Approved ${new Date(record.approvedAt).toLocaleString()}.`;
  }

  async function refreshRecoveryPanel() {
    if (!recoveryPanel || !recoveryList || !fixAscensionBtn) return;

    if (!window.userAddress || !window.provider || !window.ethers) {
      recoveryPanel.classList.add("hidden");
      recoveryList.innerHTML = "";
      setRecoveryStatus("");
      return;
    }

    let candidates = [];
    try {
      candidates = await scanRecoveryCandidates(window.userAddress);
    } catch (err) {
      console.warn("refreshRecoveryPanel failed", err);
      recoveryPanel.classList.add("hidden");
      recoveryList.innerHTML = "";
      setRecoveryStatus("Recovery scan unavailable right now.");
      return;
    }

    recoveryCandidates = candidates;

    if (!candidates.length) {
      recoveryPanel.classList.add("hidden");
      recoveryList.innerHTML = "";
      setRecoveryStatus("");
      return;
    }

    recoveryPanel.classList.remove("hidden");
    recoveryList.innerHTML = candidates.map((id) => `<span class="token-chip">#${id}</span>`).join("");

    const storedApproval = readStoredRecoveryApproval(window.userAddress);
    const approvalState = renderRecoveryApproval(storedApproval, candidates);
    if (recoveryText) {
      recoveryText.textContent = `Found ${candidates.length} pending deposit${candidates.length === 1 ? "" : "s"} that need a signed recovery approval.`;
    }
    setRecoveryStatus(approvalState);

    const approved = storedApproval && sameTokenList(storedApproval.tokenIds, candidates);
    fixAscensionBtn.disabled = false;
    fixAscensionBtn.title = approved ? "Re-sign recovery approval." : "Sign a recovery approval for these deposits.";
    fixAscensionBtn.textContent = approved ? "Re-sign Recovery" : "Approve Recovery";
    if (copyRecoveryBtn) copyRecoveryBtn.disabled = !approved;
    if (downloadRecoveryBtn) downloadRecoveryBtn.disabled = !approved;
  }

  async function handleFixRegistration() {
    if (!window.userAddress || !window.signer) {
      setStatus("Connect a wallet first.");
      return;
    }

    if (!Array.isArray(recoveryCandidates) || recoveryCandidates.length === 0) {
      setStatus("No pending recovery deposits were detected for this wallet.");
      return;
    }

    try {
      fixAscensionBtn && (fixAscensionBtn.disabled = true);
      const requestId = (window.crypto && typeof window.crypto.randomUUID === "function")
        ? window.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const message = buildRecoveryMessage(window.userAddress, recoveryCandidates, requestId);
      const signature = await window.signer.signMessage(message);
      const record = {
        wallet: ethers.getAddress(window.userAddress),
        tokenIds: normalizeTokenList(recoveryCandidates),
        requestId,
        message,
        signature,
        approvedAt: new Date().toISOString()
      };

      writeStoredRecoveryApproval(record);
      setRecoveryStatus(`Approved ${record.tokenIds.length} deposit${record.tokenIds.length === 1 ? "" : "s"} at ${new Date(record.approvedAt).toLocaleString()}.`);
      setStatus("Recovery approval signed and saved in this browser.");
      await refreshRecoveryPanel();
    } catch (err) {
      console.error("handleFixRegistration error", err);
      setRecoveryStatus("");
      setStatus(`Recovery approval failed: ${formatError(err, "Unknown recovery error.")}`);
    } finally {
      fixAscensionBtn && (fixAscensionBtn.disabled = false);
    }
  }

  async function handleCopyRecovery() {
    if (!window.userAddress) return;
    const record = readStoredRecoveryApproval(window.userAddress);
    if (!record) {
      setStatus("No saved recovery approval to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(recoveryDownloadPayload(record));
      setStatus("Recovery approval copied to clipboard.");
    } catch (err) {
      console.warn("copy recovery failed", err);
      setStatus(`Copy failed: ${formatError(err, "Unable to copy recovery approval.")}`);
    }
  }

  function handleDownloadRecovery() {
    if (!window.userAddress) return;
    const record = readStoredRecoveryApproval(window.userAddress);
    if (!record) {
      setStatus("No saved recovery approval to download.");
      return;
    }

    downloadFile("dyoor-recovery-approval.json", recoveryDownloadPayload(record), "application/json;charset=utf-8;");
    setStatus("Recovery approval downloaded.");
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
    await refreshRecoveryPanel();
  }

  function bindEvents() {
    fixAscensionBtn?.addEventListener("click", handleFixRegistration);
    copyRecoveryBtn?.addEventListener("click", handleCopyRecovery);
    downloadRecoveryBtn?.addEventListener("click", handleDownloadRecovery);
    snapshotBtn?.addEventListener("click", handleSnapshot);
    snapshotUnregisteredBtn?.addEventListener("click", handleSnapshotUnregistered);
    scanUnregisteredBtn?.addEventListener("click", handleScanUnregistered);
    recoverUnregisteredBtn?.addEventListener("click", handleRecoverUnregistered);
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
    window.loadState.__dyoorBaseLoadState = originalLoadState;
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
