const CHAIN_ID = 143;
const CHAIN_ID_HEX = "0x8f";
const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const ENERGY_BANK_ADDRESS = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
const MAX_SCAN = 1111;
const WALLET_SCAN_CACHE_MS = 60000;
const STAKED_CACHE_MS = 20000;
const ENERGY_CACHE_MS = 15000;
const FETCH_TIMEOUT_MS = 8000;
const CONTRACT_TIMEOUT_MS = 12000;
const LOAD_DEBOUNCE_MS = 250;

const stakingAbi = [
  "function deposit(uint256[] calldata tokenIds)",
  "function stakeDeposited(uint256[] calldata tokenIds)",
  "function unstake(uint256[] calldata tokenIds)",
  "function claimPoints()",
  "function pendingPoints(address user) view returns (uint256)",
  "function tokensOfStaker(address user) view returns (uint256[] memory)",
  "function stakedBalance(address user) view returns (uint256)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function s1Nft() view returns (address)",
  "function pointsPerDay() view returns (uint256)",
  "event PointsClaimed(address indexed user,uint256 amount)"
];

const energyBankAbi = [
  "function creditWithAuthorization(address user,uint256 amount,bytes32 claimTxHash,uint256 nonce,uint256 deadline,bytes signature)",
  "function spendableEnergy(address user) view returns (uint256)",
  "function lifetimeEnergy(address user) view returns (uint256)",
  "function totalSpent(address user) view returns (uint256)"
];

const nftAbi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function transferFrom(address from, address to, uint256 tokenId)"
];

let provider;
let signer;
let userAddress = null;
let currentTab = "wallet";
let ownedNfts = [];
let stakedNfts = [];
let selectedIds = new Set();

let injectedProvider = null;
let injectedWalletName = null;
let removeWalletListeners = null;

const metadataCache = new Map();
const walletNftCache = new Map();
const stakedIdsCache = new Map();
const energyCache = new Map();
let activeLoadId = 0;
let activeFetchController = null;
let loadStatePromise = null;
let loadDebounceTimer = null;
let lastLoadFailed = false;
let lastLoadStartedAt = 0;
let isHarvesting = false;
let lastPendingRaw = 0n;

const connectBtn = document.getElementById("connectBtn");
const ascendSelectedBtn = document.getElementById("ascendSelectedBtn");
const ascendAllBtn = document.getElementById("ascendAllBtn");
const disconnectSelectedBtn = document.getElementById("disconnectSelectedBtn");
const harvestBtn = document.getElementById("harvestBtn");
const walletStatus = document.getElementById("walletStatus");
const pendingEnergy = document.getElementById("pendingEnergy");
const harvestedEnergy = document.getElementById("harvestedEnergy");
const lifetimeEnergy = document.getElementById("lifetimeEnergy");
const bankedEnergy = document.getElementById("bankedEnergy");
const bankedLifetimeEnergy = document.getElementById("bankedLifetimeEnergy");
const lastHarvestedEnergy = document.getElementById("lastHarvestedEnergy");
const energyRate = document.getElementById("energyRate");
const selectedCount = document.getElementById("selectedCount");
const statusBox = document.getElementById("statusBox");
const nftGrid = document.getElementById("nftGrid");
const emptyState = document.getElementById("emptyState");
const loadMeta = document.getElementById("loadMeta");
const retryLoadBtn = document.getElementById("retryLoadBtn");

function syncStakeGlobals() {
  window.provider = provider;
  window.signer = signer;
  window.userAddress = userAddress;
  window.ownedNfts = ownedNfts;
  window.stakedNfts = stakedNfts;
  window.selectedIds = selectedIds;
  if (!window.loadState || window.loadState === loadState || window.loadState.__dyoorBaseLoadState === loadState) {
    window.loadState = loadState;
  }
  window.setStatus = setStatus;
  window.waitForHash = waitForHash;
  window.currentTab = currentTab;
  window.injectedProvider = injectedProvider;
  window.injectedWalletName = injectedWalletName;
}

function setStatus(message) {
  statusBox.textContent = message;
}

function setLoadMeta(message, options = {}) {
  if (loadMeta) loadMeta.textContent = message;
  if (retryLoadBtn) retryLoadBtn.hidden = !options.retry;
}

function formatLastUpdated(date = new Date()) {
  return `Last updated ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

function cacheKey(address) {
  return String(address || "").toLowerCase();
}

function getFreshCache(map, key, ttlMs) {
  const entry = map.get(key);
  if (!entry || Date.now() - entry.time > ttlMs) return null;
  return entry.value;
}

function setCache(map, key, value) {
  map.set(key, { value, time: Date.now() });
  return value;
}

function clearWalletCaches(address) {
  const key = cacheKey(address);
  if (!key) return;
  walletNftCache.delete(key);
  stakedIdsCache.delete(key);
  energyCache.delete(key);
}

function resetVisibleDataForWalletChange() {
  ownedNfts = [];
  stakedNfts = [];
  selectedIds.clear();
  pendingEnergy.textContent = "0.00";
  harvestedEnergy.textContent = "0.00";
  lifetimeEnergy.textContent = "0.00";
  if (bankedEnergy) bankedEnergy.textContent = "0.00";
  if (bankedLifetimeEnergy) bankedLifetimeEnergy.textContent = "0.00";
  if (lastHarvestedEnergy) lastHarvestedEnergy.textContent = "0.00";
  lastPendingRaw = 0n;
  energyRate.textContent = "0 / day";
  updateSelectedCount();
  renderGrid();
  updateButtons();
  syncStakeGlobals();
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal.reason);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromExternal);
  }
}

function isCurrentLoad(loadId, address) {
  return loadId === activeLoadId && cacheKey(address) === cacheKey(userAddress);
}

function scheduleLoadState(reason = "refresh", options = {}) {
  if (!userAddress) return Promise.resolve();
  clearTimeout(loadDebounceTimer);
  return new Promise((resolve) => {
    loadDebounceTimer = setTimeout(() => {
      loadState({ ...options, reason }).then(resolve).catch(resolve);
    }, options.immediate ? 0 : LOAD_DEBOUNCE_MS);
  });
}

function shorten(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function updateSelectedCount() {
  selectedCount.textContent = String(selectedIds.size);
}

function getVisibleItems() {
  return currentTab === "wallet" ? ownedNfts : stakedNfts;
}

function normalizeIpfs(url) {
  if (!url) return "";
  if (url.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${url.replace("ipfs://", "")}`;
  }
  return url;
}

function formatError(err, fallback = "Unknown error.") {
  return (
    err?.shortMessage ||
    err?.reason ||
    err?.revert?.name ||
    err?.revert?.signature ||
    err?.info?.error?.message ||
    err?.info?.message ||
    err?.error?.message ||
    err?.message ||
    fallback
  );
}

function formatEnergyValue(value) {
  if (!Number.isFinite(value)) return "0.00";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

async function fetchHarvestedEnergyRaw(address, options = {}) {
  if (!address) return 0n;
  const key = cacheKey(address);
  const cached = !options.force ? getFreshCache(energyCache, `harvested:${key}`, ENERGY_CACHE_MS) : null;
  if (cached !== null) return cached;

  const { res, json } = await fetchJsonWithTimeout(
    `/.netlify/functions/harvested-ledger?address=${encodeURIComponent(address)}`,
    { cache: "no-store", signal: options.signal },
    FETCH_TIMEOUT_MS
  );

  if (!res.ok || json.ok === false) {
    throw new Error(json?.error || "Failed to load harvested energy.");
  }

  return setCache(energyCache, `harvested:${key}`, BigInt(json?.harvestedRaw || "0"));
}

async function fetchAscensionStats(address, options = {}) {
  if (!address) return null;
  const key = cacheKey(address);
  const cached = !options.force ? getFreshCache(energyCache, `stats:${key}`, ENERGY_CACHE_MS) : null;
  if (cached) return cached;

  const { res, json } = await fetchJsonWithTimeout(
    `/.netlify/functions/ascension-stats?address=${encodeURIComponent(address)}`,
    { cache: "no-store", signal: options.signal },
    Math.max(FETCH_TIMEOUT_MS, 20000)
  );

  if (!res.ok || json.ok === false) {
    throw new Error(json?.error || "Failed to load Ascension stats.");
  }

  return setCache(energyCache, `stats:${key}`, json);
}

function bigIntFromJson(value) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

async function recordHarvest(address, amountRaw, txHash) {
  const res = await fetch("/.netlify/functions/harvested-ledger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "recordHarvest",
      address,
      amountRaw: amountRaw.toString(),
      txHash
    })
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json?.error || "Failed to record harvest.");
  }

  return BigInt(json?.harvestedRaw || "0");
}

async function requestEnergyBankAuthorization(address, amountRaw, txHash) {
  const res = await fetch("/.netlify/functions/energy-bank-credit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: address,
      amountRaw: amountRaw.toString(),
      txHash
    })
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json?.error || "Failed to authorize Energy Bank credit.");
  }

  return json;
}

async function creditEnergyBank(address, amountRaw, txHash) {
  setStatus("Crediting Energy Bank...");
  try {
    const res = await fetch("/.netlify/functions/energy-bank-direct-credit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user: address,
        amountRaw: amountRaw.toString(),
        txHash
      })
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok !== false) {
      return json.creditTxHash || txHash;
    }
    console.warn("direct Energy Bank credit unavailable", json?.error || res.status);
  } catch (err) {
    console.warn("direct Energy Bank credit failed", err);
  }

  setStatus("Preparing fallback Energy Bank credit...");
  const auth = await requestEnergyBankAuthorization(address, amountRaw, txHash);

  setStatus("Confirm Energy Bank credit in your wallet...");
  const creditTxHash = await sendContractTx(
    auth.energyBankAddress,
    energyBankAbi,
    "creditWithAuthorization",
    [
      auth.user,
      BigInt(auth.amountRaw),
      auth.claimTxHash,
      BigInt(auth.nonce),
      BigInt(auth.deadline),
      auth.signature
    ]
  );

  await waitForHash(creditTxHash);
  return creditTxHash;
}

async function fetchEnergyBankState(address, options = {}) {
  const energyBankAddress = window.ENERGY_BANK_ADDRESS || ENERGY_BANK_ADDRESS;
  if (!address || !energyBankAddress || !ethers.isAddress(energyBankAddress)) {
    return { spendable: 0n, lifetime: 0n, spent: 0n };
  }
  const key = cacheKey(address);
  const cached = !options.force ? getFreshCache(energyCache, `bank:${key}`, ENERGY_CACHE_MS) : null;
  if (cached) return cached;

  const bank = new ethers.Contract(energyBankAddress, energyBankAbi, provider);
  const [spendable, lifetime, spent] = await withTimeout(Promise.all([
    bank.spendableEnergy(address),
    bank.lifetimeEnergy(address),
    bank.totalSpent(address)
  ]), CONTRACT_TIMEOUT_MS, "Energy Bank");

  return setCache(energyCache, `bank:${key}`, { spendable, lifetime, spent });
}

async function seedKnownHistoricalHarvestIfNeeded(address) {
  const normalized = String(address || "").toLowerCase();
  const target = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";

  if (normalized !== target) return;

  try {
    await fetch("/.netlify/functions/harvested-ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "seedHarvest",
        address: target,
        txHash: "0xfd96fc78bc4663899e79f5135874209d31af4b5a856e583e2e29892f982118ad",
        amountRaw: "15003705173611111111107"
      })
    });
  } catch {}
}

function getInjectedProviderOrThrow() {
  if (!injectedProvider?.request) {
    throw new Error("No wallet provider selected.");
  }
  return injectedProvider;
}

async function waitForHash(txHash, timeoutMs = 180000, pollMs = 1500) {
  if (!txHash) throw new Error("Missing transaction hash.");

  const injected = getInjectedProviderOrThrow();
  setStatus(`Waiting for confirmation...\n${txHash.slice(0, 10)}...`);

  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const receipt = await injected.request({
      method: "eth_getTransactionReceipt",
      params: [txHash]
    });

    if (receipt) {
      if (receipt.status === "0x1") return receipt;
      if (receipt.status === "0x0") throw new Error(`Transaction failed: ${txHash}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Timed out waiting for confirmation: ${txHash}`);
}

async function sendContractTx(to, abi, fnName, args = []) {
  const injected = getInjectedProviderOrThrow();
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData(fnName, args);

  const txHash = await injected.request({
    method: "eth_sendTransaction",
    params: [{ from: userAddress, to, data }]
  });

  return txHash;
}

function getHarvestAmountFromReceipt(receipt) {
  const iface = new ethers.Interface(stakingAbi);
  const user = userAddress ? ethers.getAddress(userAddress) : "";

  for (const log of receipt?.logs || []) {
    try {
      if (String(log.address || "").toLowerCase() !== STAKING_ADDRESS.toLowerCase()) continue;
      const parsed = iface.parseLog(log);
      if (parsed?.name !== "PointsClaimed") continue;
      if (ethers.getAddress(parsed.args.user) !== user) continue;
      return parsed.args.amount;
    } catch {}
  }

  return 0n;
}

async function fetchTokenMetadata(tokenId) {
  const cacheKey = String(tokenId);
  if (metadataCache.has(cacheKey)) {
    return metadataCache.get(cacheKey);
  }

  try {
    const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);
    let uri = await nft.tokenURI(tokenId);

    let result;

    if (uri.startsWith("data:application/json;base64,")) {
      const b64 = uri.split(",")[1];
      const json = JSON.parse(atob(b64));
      result = {
        image: normalizeIpfs(json.image || ""),
        name: json.name || `DYOOR #${tokenId}`
      };
    } else {
      uri = normalizeIpfs(uri);
      const { res, json } = await fetchJsonWithTimeout(uri, { cache: "force-cache" }, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`Metadata HTTP ${res.status}`);
      result = {
        image: normalizeIpfs(json.image || ""),
        name: json.name || `DYOOR #${tokenId}`
      };
    }

    metadataCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error("metadata error", tokenId, err);
    const fallback = { image: "", name: `DYOOR #${tokenId}` };
    metadataCache.set(cacheKey, fallback);
    return fallback;
  }
}

async function getOwnedNfts(owner, options = {}) {
  try {
    const key = cacheKey(owner);
    const cached = !options.force ? getFreshCache(walletNftCache, key, WALLET_SCAN_CACHE_MS) : null;
    if (cached) {
      setStatus("Showing cached wallet scan while refreshing...");
      return cached;
    }

    const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);
    const tokenIds = [];
    const ownerChecksum = ethers.getAddress(owner);
    const scanBatchSize = 75;
    const metadataBatchSize = 16;

    setStatus("Scanning wallet...");
    setLoadMeta("Checking wallet balance before full scan...");

    try {
      const balance = await withTimeout(nft.balanceOf(owner), CONTRACT_TIMEOUT_MS, "Wallet balance");
      if (balance === 0n) {
        return setCache(walletNftCache, key, []);
      }
    } catch (err) {
      console.warn("balanceOf precheck failed; falling back to owner scan", err);
      setLoadMeta("RPC is slow, scanning directly...");
    }

    async function ownerOfWithRetry(tokenId) {
      try {
        return await withTimeout(nft.ownerOf(tokenId), CONTRACT_TIMEOUT_MS, `ownerOf #${tokenId}`);
      } catch {
        try {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return await withTimeout(nft.ownerOf(tokenId), CONTRACT_TIMEOUT_MS, `ownerOf retry #${tokenId}`);
        } catch {
          return null;
        }
      }
    }

    for (let start = 1; start <= MAX_SCAN; start += scanBatchSize) {
      if (options.loadId && !isCurrentLoad(options.loadId, owner)) return [];
      const end = Math.min(start + scanBatchSize - 1, MAX_SCAN);
      setStatus(`Scanning wallet...\n${start}-${end} / ${MAX_SCAN}`);
      setLoadMeta(`Scanning wallet range ${start}-${end}. Already-loaded data stays visible.`);

      const batch = [];
      for (let tokenId = start; tokenId <= end; tokenId++) {
        batch.push(
          ownerOfWithRetry(tokenId).then((currentOwner) => {
            if (!currentOwner) return null;
            try {
              return ethers.getAddress(currentOwner) === ownerChecksum ? String(tokenId) : null;
            } catch {
              return null;
            }
          })
        );
      }

      const results = await Promise.all(batch);
      for (const tokenId of results) {
        if (tokenId) tokenIds.push(tokenId);
      }

      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    if (!tokenIds.length) return setCache(walletNftCache, key, []);

    setStatus(`Found ${tokenIds.length} DYOOR.\nLoading metadata...`);

    const items = [];
    for (let i = 0; i < tokenIds.length; i += metadataBatchSize) {
      if (options.loadId && !isCurrentLoad(options.loadId, owner)) return [];
      const slice = tokenIds.slice(i, i + metadataBatchSize);

      const chunk = await Promise.all(
        slice.map(async (tokenId) => {
          const meta = await fetchTokenMetadata(tokenId);
          return {
            tokenId,
            source: "wallet",
            name: meta.name,
            image: meta.image
          };
        })
      );

      items.push(...chunk);

      if (currentTab === "wallet") {
        ownedNfts = [...items];
        renderGrid();
        updateButtons();
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return setCache(walletNftCache, key, items);
  } catch (err) {
    console.error("getOwnedNfts error", err);
    throw new Error("Wallet connected, but direct NFT scan failed.");
  }
}

async function getStakedTokenIds(owner, options = {}) {
  const key = cacheKey(owner);
  const cached = !options.force ? getFreshCache(stakedIdsCache, key, STAKED_CACHE_MS) : null;
  if (cached) return cached;
  const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

  try {
    const ids = await withTimeout(staking.tokensOfStaker(owner), CONTRACT_TIMEOUT_MS, "Ascension status");
    return setCache(stakedIdsCache, key, ids.map((x) => x.toString()));
  } catch (err) {
    console.error("getStakedTokenIds error", err);
    throw new Error("Wallet connected, but staked NFT loading failed.");
  }
}

async function enrichStakedTokenIds(tokenIds) {
  const items = [];
  const metadataBatchSize = 16;
  for (let i = 0; i < tokenIds.length; i += metadataBatchSize) {
    const slice = tokenIds.slice(i, i + metadataBatchSize);
    const chunk = await Promise.all(slice.map(async (tokenId) => {
      const meta = await fetchTokenMetadata(tokenId);
      return {
        tokenId,
        source: "staked",
        name: meta.name,
        image: meta.image
      };
    }));
    items.push(...chunk);
  }
  return items;
}

function renderGrid() {
  const items = getVisibleItems();
  nftGrid.innerHTML = "";

  if (!items.length) {
    emptyState.style.display = "block";
    emptyState.textContent =
      currentTab === "wallet"
        ? "No unstaked DYOOR found in this wallet yet."
        : "No ascended DYOOR found for this wallet yet.";
    return;
  }

  emptyState.style.display = "none";

  for (const item of items) {
    const card = document.createElement("div");
    card.className = `nft-card ${selectedIds.has(item.tokenId) ? "selected" : ""}`;
    card.dataset.id = item.tokenId;

    card.innerHTML = `
      ${item.image ? `<img src="${item.image}" alt="${item.name}" loading="lazy" />` : `<div class="no-image">Artwork unavailable</div>`}
      <div class="nft-name">${item.name}</div>
      <div class="nft-id">#${item.tokenId}</div>
    `;

    card.addEventListener("click", () => {
      if (selectedIds.has(item.tokenId)) {
        selectedIds.delete(item.tokenId);
      } else {
        selectedIds.add(item.tokenId);
      }

      syncStakeGlobals();
      updateSelectedCount();
      renderGrid();
      updateButtons();
    });

    nftGrid.appendChild(card);
  }
}

function setGridLoading(message) {
  if (getVisibleItems().length) return;
  emptyState.style.display = "block";
  emptyState.textContent = message;
}

function updateButtons() {
  const hasWalletItems = ownedNfts.length > 0;
  const selectedVisible = getVisibleItems().filter((x) => selectedIds.has(x.tokenId)).length > 0;

  ascendSelectedBtn.disabled = !(currentTab === "wallet" && selectedVisible && userAddress);
  ascendAllBtn.disabled = !(currentTab === "wallet" && hasWalletItems && userAddress);
  disconnectSelectedBtn.disabled = !(currentTab === "staked" && selectedVisible && userAddress);
  harvestBtn.textContent = isHarvesting ? "Harvesting..." : "Harvest Energy";
  harvestBtn.disabled = !userAddress || isHarvesting || lastPendingRaw <= 0n;
  harvestBtn.title = lastPendingRaw <= 0n && userAddress
    ? "No pending Energy to harvest."
    : "";
}

async function updateEnergy(options = {}) {
  if (!userAddress) return;

  const address = userAddress;
  const key = cacheKey(address);
  const cached = !options.force ? getFreshCache(energyCache, `summary:${key}`, ENERGY_CACHE_MS) : null;
  if (cached) {
    applyEnergySummary(cached);
    return cached;
  }

  const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

  try {
    setLoadMeta("Fetching energy...");
    await seedKnownHistoricalHarvestIfNeeded(address);

    try {
      const stats = await fetchAscensionStats(address, options);
      if (stats) {
        const summary = {
          pending: bigIntFromJson(stats.pendingRaw),
          stakedBalance: bigIntFromJson(stats.totalStakedRaw ?? stats.totalStaked),
          pointsPerDayRaw: bigIntFromJson(stats.pointsPerDayRaw) || ethers.parseEther("24"),
          harvestedRaw: bigIntFromJson(stats.harvestedRaw),
          lifetimeRaw: bigIntFromJson(stats.lifetimeRaw),
          lastHarvestRaw: bigIntFromJson(stats.lastHarvestRaw),
          bankState: {
            spendable: bigIntFromJson(stats.bankedRaw),
            lifetime: bigIntFromJson(stats.bankLifetimeRaw),
            spent: bigIntFromJson(stats.bankSpentRaw)
          }
        };
        setCache(energyCache, `summary:${key}`, summary);
        applyEnergySummary(summary);
        return summary;
      }
    } catch (statsErr) {
      console.warn("ascension stats load failed; falling back to direct reads", statsErr);
    }

    const results = await Promise.allSettled([
      withTimeout(staking.pendingPoints(address), CONTRACT_TIMEOUT_MS, "Pending Energy"),
      withTimeout(staking.stakedBalance(address), CONTRACT_TIMEOUT_MS, "Ascension balance"),
      withTimeout(staking.pointsPerDay(), CONTRACT_TIMEOUT_MS, "Energy rate"),
      fetchHarvestedEnergyRaw(address, options),
      fetchEnergyBankState(address, options)
    ]);

    const pending = results[0].status === "fulfilled" ? results[0].value : 0n;
    const stakedBalance = results[1].status === "fulfilled" ? results[1].value : BigInt(stakedNfts.length);
    const pointsPerDayRaw = results[2].status === "fulfilled" ? results[2].value : ethers.parseEther("24");
    const harvestedRaw = results[3].status === "fulfilled" ? results[3].value : 0n;
    const bankState = results[4].status === "fulfilled" ? results[4].value : { spendable: 0n, lifetime: 0n, spent: 0n };

    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) {
      console.warn("partial energy load failure", failed.map((result) => result.reason));
      setLoadMeta("RPC is slow, showing partial energy data.");
    }

    const summary = {
      pending,
      stakedBalance,
      pointsPerDayRaw,
      harvestedRaw,
      lifetimeRaw: pending + harvestedRaw,
      lastHarvestRaw: 0n,
      bankState
    };
    setCache(energyCache, `summary:${key}`, summary);
    applyEnergySummary(summary);
    return summary;
  } catch (err) {
    console.error("energy error", err);
    setStatus(`Energy load failed: ${formatError(err)}`);
  }
}

function applyEnergySummary(summary) {
  const pending = summary?.pending || 0n;
  const harvestedRaw = summary?.harvestedRaw || 0n;
  const lifetimeRaw = summary?.lifetimeRaw ?? (pending + harvestedRaw);
  const lastHarvestRaw = summary?.lastHarvestRaw || 0n;
  const bankState = summary?.bankState || { spendable: 0n, lifetime: 0n };
  const stakedBalance = summary?.stakedBalance || 0n;
  const pointsPerDayRaw = summary?.pointsPerDayRaw || ethers.parseEther("24");
  const pendingDisplay = Number(ethers.formatEther(pending));
  const harvestedDisplay = Number(ethers.formatEther(harvestedRaw));
  const lifetimeDisplay = Number(ethers.formatEther(lifetimeRaw));
  const lastHarvestDisplay = Number(ethers.formatEther(lastHarvestRaw));
  const pointsPerDayPerNft = Number(ethers.formatEther(pointsPerDayRaw));
  const totalRate = Number(stakedBalance) * pointsPerDayPerNft;

  pendingEnergy.textContent = formatEnergyValue(pendingDisplay);
  harvestedEnergy.textContent = formatEnergyValue(harvestedDisplay);
  lifetimeEnergy.textContent = formatEnergyValue(lifetimeDisplay);
  if (bankedEnergy) bankedEnergy.textContent = formatEnergyValue(Number(ethers.formatEther(bankState.spendable || 0n)));
  if (bankedLifetimeEnergy) bankedLifetimeEnergy.textContent = formatEnergyValue(Number(ethers.formatEther(bankState.lifetime || 0n)));
  if (lastHarvestedEnergy) lastHarvestedEnergy.textContent = formatEnergyValue(lastHarvestDisplay);
  energyRate.textContent = Number.isInteger(totalRate)
    ? `${totalRate} / day`
    : `${totalRate.toFixed(2)} / day`;
  lastPendingRaw = pending;
  updateButtons();
}

async function loadState(options = {}) {
  if (!userAddress || !provider) {
    syncStakeGlobals();
    return;
  }

  if (loadStatePromise && !options.force) return loadStatePromise;

  const loadId = ++activeLoadId;
  const address = userAddress;
  lastLoadStartedAt = Date.now();
  lastLoadFailed = false;
  if (activeFetchController) activeFetchController.abort();
  activeFetchController = new AbortController();

  const nextLoadPromise = (async () => {
  try {
    setStatus("Checking Ascension status...");
    setLoadMeta("Checking Ascension status...");
    setGridLoading("Checking Ascension status...");

    const stakedTask = (async () => {
      const stakedIds = await getStakedTokenIds(address, options);
      const items = await enrichStakedTokenIds(stakedIds);
      if (!isCurrentLoad(loadId, address)) return null;
      stakedNfts = items;
      selectedIds.clear();
      updateSelectedCount();
      renderGrid();
      updateButtons();
      syncStakeGlobals();
      setLoadMeta("Ascended NFTs loaded. Fetching energy...");
      return items;
    })();

    const energyTask = updateEnergy({
      ...options,
      signal: activeFetchController.signal
    }).catch((err) => {
      console.warn("energy task failed", err);
      setLoadMeta("Energy RPC is slow, keeping the previous values visible.");
      return null;
    });

    await Promise.allSettled([stakedTask, energyTask]);
    if (!isCurrentLoad(loadId, address)) return;

    setStatus("Scanning wallet...");
    setGridLoading("Scanning wallet...");
    const existingWalletCache = getFreshCache(walletNftCache, cacheKey(address), WALLET_SCAN_CACHE_MS);
    if (existingWalletCache) {
      ownedNfts = existingWalletCache;
      renderGrid();
      updateButtons();
      syncStakeGlobals();
      setLoadMeta("Showing cached wallet data while checking for updates...");
    }

    const walletItems = await getOwnedNfts(address, {
      ...options,
      loadId,
      signal: activeFetchController.signal
    });
    if (!isCurrentLoad(loadId, address)) return;
    ownedNfts = walletItems;

    selectedIds.clear();
    updateSelectedCount();
    renderGrid();
    updateButtons();
    syncStakeGlobals();

    setStatus("Ascension state synchronized.");
    setLoadMeta(formatLastUpdated());
  } catch (err) {
    if (!isCurrentLoad(loadId, address)) return;
    console.error("loadState error", err);
    lastLoadFailed = true;
    syncStakeGlobals();
    setStatus(formatError(err, "Failed to load wallet state."));
    setLoadMeta("Load failed. Already-loaded data is still shown when available.", { retry: true });
  } finally {
    if (isCurrentLoad(loadId, address)) {
      lastLoadStartedAt = 0;
    }
    if (loadStatePromise === nextLoadPromise) loadStatePromise = null;
  }
  })();

  loadStatePromise = nextLoadPromise;
  return loadStatePromise;
}

async function ensureMonadNetwork() {
  const injected = getInjectedProviderOrThrow();
  const current = await injected.request({ method: "eth_chainId" });

  if (current === CHAIN_ID_HEX) return;

  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }]
    });
  } catch (err) {
    if (err.code === 4902) {
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: "Monad Mainnet",
            nativeCurrency: {
              name: "MON",
              symbol: "MON",
              decimals: 18
            },
            rpcUrls: ["https://rpc.monad.xyz"],
            blockExplorerUrls: ["https://explorer.monad.xyz"]
          }
        ]
      });
    } else {
      throw err;
    }
  }
}

function clearWalletState(disconnectMessage = "Disconnected.") {
  activeLoadId++;
  if (activeFetchController) activeFetchController.abort();
  loadStatePromise = null;
  clearTimeout(loadDebounceTimer);
  userAddress = null;
  signer = null;
  provider = null;
  ownedNfts = [];
  stakedNfts = [];
  selectedIds.clear();

  walletStatus.textContent = "Not Connected";
  connectBtn.textContent = "Connect Wallet";
  pendingEnergy.textContent = "0.00";
  harvestedEnergy.textContent = "0.00";
  lifetimeEnergy.textContent = "0.00";
  if (bankedEnergy) bankedEnergy.textContent = "0.00";
  if (bankedLifetimeEnergy) bankedLifetimeEnergy.textContent = "0.00";
  if (lastHarvestedEnergy) lastHarvestedEnergy.textContent = "0.00";
  lastPendingRaw = 0n;
  energyRate.textContent = "0 / day";
  nftGrid.innerHTML = "";
  emptyState.style.display = "block";
  emptyState.textContent = "No unstaked DYOOR found in this wallet yet.";

  updateSelectedCount();
  updateButtons();

  if (removeWalletListeners) {
    removeWalletListeners();
    removeWalletListeners = null;
  }

  injectedProvider = null;
  injectedWalletName = null;

  syncStakeGlobals();
  setStatus(disconnectMessage);
  setLoadMeta("Connect wallet to scan Ascension state.");
}

function bindProviderEvents() {
  if (!injectedProvider?.on) return;

  if (removeWalletListeners) {
    removeWalletListeners();
    removeWalletListeners = null;
  }

  const handleAccountsChanged = async (accounts) => {
    try {
      if (!accounts.length) {
        clearWalletState("Disconnected.");
        return;
      }

      provider = new ethers.BrowserProvider(injectedProvider);
      signer = await provider.getSigner();
      userAddress = accounts[0];

      walletStatus.textContent = shorten(userAddress);
      connectBtn.textContent = `Connected: ${injectedWalletName || "Wallet"}`;

      resetVisibleDataForWalletChange();
      setStatus("Account changed.");
      clearWalletCaches(userAddress);
      await scheduleLoadState("account changed", { force: true, immediate: true });
    } catch (err) {
      console.error("accountsChanged error", err);
      setStatus("Failed to refresh wallet session.");
    }
  };

  const handleChainChanged = async () => {
    try {
      provider = new ethers.BrowserProvider(injectedProvider);
      const accounts = await injectedProvider.request({ method: "eth_accounts" });

      if (!accounts.length) {
        clearWalletState("Wallet disconnected.");
        return;
      }

      signer = await provider.getSigner();
      userAddress = accounts[0];

      syncStakeGlobals();
      walletStatus.textContent = shorten(userAddress);
      connectBtn.textContent = `Connected: ${injectedWalletName || "Wallet"}`;
      resetVisibleDataForWalletChange();
      setStatus("Network changed.");

      clearWalletCaches(userAddress);
      await scheduleLoadState("network changed", { force: true, immediate: true });
    } catch (err) {
      console.error("chainChanged error", err);
      setStatus("Switch to Monad Mainnet to continue.");
    }
  };

  const handleDisconnect = () => {
    clearWalletState("Wallet disconnected.");
  };

  injectedProvider.on("accountsChanged", handleAccountsChanged);
  injectedProvider.on("chainChanged", handleChainChanged);
  injectedProvider.on("disconnect", handleDisconnect);

  removeWalletListeners = () => {
    try {
      injectedProvider?.removeListener?.("accountsChanged", handleAccountsChanged);
      injectedProvider?.removeListener?.("chainChanged", handleChainChanged);
      injectedProvider?.removeListener?.("disconnect", handleDisconnect);
    } catch {}
  };
}

async function connectWallet() {
  connectBtn.disabled = true;
  try {
    setStatus("Opening wallet chooser...");
    if (!window.DyoorWalletChooser?.connect) {
      throw new Error("Wallet chooser failed to load.");
    }

    const chosenWallet = await window.DyoorWalletChooser.connect({
      title: "Connect Wallet",
      copy: "Use the same Monad wallet flow across Ascension, swap, and verification."
    });

    injectedProvider = chosenWallet.provider;
    injectedWalletName = chosenWallet.label;
    provider = chosenWallet.browserProvider;
    signer = chosenWallet.signer;
    userAddress = chosenWallet.account;

    walletStatus.textContent = shorten(userAddress);
    connectBtn.textContent = `Connected: ${chosenWallet.label}`;

    bindProviderEvents();
    resetVisibleDataForWalletChange();
    setStatus(`Wallet connected: ${chosenWallet.label}`);

    await scheduleLoadState("connect", { force: true, immediate: true });
  } catch (err) {
    console.error("connectWallet error:", err);
    setStatus(formatError(err, "Connection failed."));
  } finally {
    connectBtn.disabled = false;
  }
}

async function ensureApproval() {
  const nftRead = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);
  const approved = await nftRead.isApprovedForAll(userAddress, STAKING_ADDRESS);

  if (approved) return true;

  setStatus("Approval required.\nConfirm in wallet...");
  const txHash = await sendContractTx(
    NFT_ADDRESS,
    nftAbi,
    "setApprovalForAll",
    [STAKING_ADDRESS, true]
  );

  await waitForHash(txHash);

  const approvedAfter = await nftRead.isApprovedForAll(userAddress, STAKING_ADDRESS);
  if (!approvedAfter) {
    throw new Error("Approval did not complete.");
  }

  return true;
}

async function ascendTokenIds(tokenIds) {
  try {
    if (!tokenIds || tokenIds.length === 0) {
      setStatus("Nothing selected for ascension.");
      return;
    }

    const normalizedIds = tokenIds.map((id) => BigInt(String(id)));
    const nftRead = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);

    setStatus(`Preparing ${normalizedIds.length} NFT(s) for ascension...`);
    await ensureApproval();

    for (const id of normalizedIds) {
      const ownerNow = await nftRead.ownerOf(id);
      if (ethers.getAddress(ownerNow) !== ethers.getAddress(userAddress)) {
        throw new Error(`Token #${id.toString()} is not in your wallet.`);
      }
    }

    setStatus("Depositing NFT(s) into staking contract...");
    for (const id of normalizedIds) {
      const txHash = await sendContractTx(
        NFT_ADDRESS,
        nftAbi,
        "transferFrom",
        [userAddress, STAKING_ADDRESS, id]
      );
      await waitForHash(txHash);
    }

    setStatus("Registering deposited NFT(s)...");
    const registerHash = await sendContractTx(
      STAKING_ADDRESS,
      stakingAbi,
      "stakeDeposited",
      [normalizedIds]
    );

    await waitForHash(registerHash);

    setStatus("Ascension complete.");
    clearWalletCaches(userAddress);
    await loadState({ force: true });
  } catch (err) {
    console.error("ascendTokenIds error", err);
    setStatus(`Ascension failed: ${formatError(err, "Unknown staking error.")}`);
  }
}

async function disconnectTokenIds(tokenIds) {
  if (!tokenIds || tokenIds.length === 0) {
    setStatus("Nothing selected to disconnect.");
    return;
  }

  try {
    const normalizedIds = tokenIds.map((id) => BigInt(String(id)));

    setStatus("Disconnecting from the protocol...");
    const txHash = await sendContractTx(
      STAKING_ADDRESS,
      stakingAbi,
      "unstake",
      [normalizedIds]
    );

    await waitForHash(txHash);

    setStatus("Disconnect complete.");
    clearWalletCaches(userAddress);
    await loadState({ force: true });
  } catch (err) {
    console.error("disconnectTokenIds error", err);
    setStatus(`Disconnect failed: ${formatError(err, "Unknown unstake error.")}`);
  }
}

async function harvestEnergy() {
  if (isHarvesting) return;

  try {
    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);
    const claimableBefore = await staking.pendingPoints(userAddress);
    lastPendingRaw = claimableBefore;
    updateButtons();

    if (claimableBefore <= 0n) {
      setStatus("No pending Energy to harvest.");
      return;
    }

    isHarvesting = true;
    updateButtons();
    setStatus("Harvesting Energy...");
    const txHash = await sendContractTx(
      STAKING_ADDRESS,
      stakingAbi,
      "claimPoints",
      []
    );

    const receipt = await waitForHash(txHash);
    const harvestedAmount = getHarvestAmountFromReceipt(receipt) || claimableBefore;

    if (harvestedAmount > 0n) {
      try {
        await recordHarvest(userAddress, harvestedAmount, txHash);
      } catch (recordErr) {
        console.warn("recordHarvest failed", recordErr);
      }

      try {
        const bankTxHash = await creditEnergyBank(userAddress, harvestedAmount, txHash);
        setStatus(`Energy harvested and banked on-chain.\n${bankTxHash.slice(0, 10)}...`);
      } catch (bankErr) {
        console.warn("creditEnergyBank failed", bankErr);
        setStatus(`Energy harvested. On-chain bank credit not completed: ${formatError(bankErr)}`);
      }
    } else {
      setStatus("Energy harvested.");
    }
    clearWalletCaches(userAddress);
    await loadState({ force: true });
  } catch (err) {
    console.error("harvestEnergy error", err);
    setStatus(`Harvest failed: ${formatError(err, "Unknown claim error.")}`);
  } finally {
    isHarvesting = false;
    updateButtons();
  }
}

function selectedVisibleTokenIds() {
  return getVisibleItems()
    .filter((item) => selectedIds.has(item.tokenId))
    .map((item) => item.tokenId);
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    selectedIds.clear();
    syncStakeGlobals();
    updateSelectedCount();
    renderGrid();
    updateButtons();
  });
});

document.getElementById("selectAllVisibleBtn").addEventListener("click", () => {
  getVisibleItems().forEach((item) => selectedIds.add(item.tokenId));
  syncStakeGlobals();
  updateSelectedCount();
  renderGrid();
  updateButtons();
});

document.getElementById("clearSelectionBtn").addEventListener("click", () => {
  selectedIds.clear();
  syncStakeGlobals();
  updateSelectedCount();
  renderGrid();
  updateButtons();
});

document.getElementById("refreshBtn").addEventListener("click", async () => {
  if (!userAddress) return;
  await loadState({ force: true });
});

retryLoadBtn?.addEventListener("click", async () => {
  if (!userAddress) return;
  await loadState({ force: true });
});

connectBtn.addEventListener("click", connectWallet);

ascendSelectedBtn.addEventListener("click", async () => {
  const ids = selectedVisibleTokenIds();
  if (!ids.length) {
    setStatus("No NFTs selected.");
    return;
  }
  await ascendTokenIds(ids);
});

ascendAllBtn.addEventListener("click", async () => {
  const ids = ownedNfts.map((x) => x.tokenId);
  if (!ids.length) {
    setStatus("No NFTs available to ascend.");
    return;
  }
  await ascendTokenIds(ids);
});

disconnectSelectedBtn.addEventListener("click", async () => {
  const ids = selectedVisibleTokenIds();
  if (!ids.length) {
    setStatus("No NFTs selected.");
    return;
  }
  await disconnectTokenIds(ids);
});

harvestBtn.addEventListener("click", harvestEnergy);

window.addEventListener("DOMContentLoaded", () => {
  syncStakeGlobals();
  updateButtons();
});
