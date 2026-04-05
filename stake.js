const CHAIN_ID = 143;
const CHAIN_ID_HEX = "0x8f";
const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const MAX_SCAN = 1111;

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
  "function pointsPerDay() view returns (uint256)"
];

const nftAbi = [
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

const connectBtn = document.getElementById("connectBtn");
const ascendSelectedBtn = document.getElementById("ascendSelectedBtn");
const ascendAllBtn = document.getElementById("ascendAllBtn");
const disconnectSelectedBtn = document.getElementById("disconnectSelectedBtn");
const harvestBtn = document.getElementById("harvestBtn");
const walletStatus = document.getElementById("walletStatus");
const pendingEnergy = document.getElementById("pendingEnergy");
const harvestedEnergy = document.getElementById("harvestedEnergy");
const lifetimeEnergy = document.getElementById("lifetimeEnergy");
const energyRate = document.getElementById("energyRate");
const selectedCount = document.getElementById("selectedCount");
const statusBox = document.getElementById("statusBox");
const nftGrid = document.getElementById("nftGrid");
const emptyState = document.getElementById("emptyState");

function syncStakeGlobals() {
  window.provider = provider;
  window.signer = signer;
  window.userAddress = userAddress;
  window.ownedNfts = ownedNfts;
  window.stakedNfts = stakedNfts;
  window.selectedIds = selectedIds;
  window.loadState = loadState;
  window.setStatus = setStatus;
  window.waitForHash = waitForHash;
  window.currentTab = currentTab;
  window.injectedProvider = injectedProvider;
  window.injectedWalletName = injectedWalletName;
}

function setStatus(message) {
  statusBox.textContent = message;
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

async function fetchHarvestedEnergyRaw(address) {
  if (!address) return 0n;

  const res = await fetch(
    `/.netlify/functions/ascension-stats?address=${encodeURIComponent(address)}`,
    { cache: "no-store" }
  );

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json.ok === false) {
    throw new Error(json?.error || "Failed to load harvested energy.");
  }

  return BigInt(json?.harvestedRaw || "0");
}

async function recordHarvest(address, amountRaw, txHash) {
  const res = await fetch("/.netlify/functions/ascension-stats", {
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

async function seedKnownHistoricalHarvestIfNeeded(address) {
  const normalized = String(address || "").toLowerCase();
  const target = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";

  if (normalized !== target) return;

  const res = await fetch("/.netlify/functions/ascension-stats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "seedHarvest",
      address: target,
      txHash: "0xfd96fc78bc4663899e79f5135874209d31af4b5a856e583e2e29892f982118ad",
      amountRaw: "15003705173611111111107"
    })
  });

  await res.json().catch(() => ({}));
}

function getInjectedProviderOrThrow() {
  if (!injectedProvider?.request) {
    throw new Error("No wallet provider selected.");
  }
  return injectedProvider;
}

function detectLegacyWalletName(providerLike) {
  if (!providerLike) return "Injected Wallet";
  if (providerLike.isBackpack) return "Backpack";
  if (providerLike.isOkxWallet || providerLike.isOKExWallet) return "OKX Wallet";
  if (providerLike.isTokenPocket || providerLike.isTPWallet) return "TokenPocket";
  if (providerLike.isMetaMask) return "MetaMask";
  if (providerLike.isPhantom) return "Phantom";
  if (providerLike.isRabby) return "Rabby";
  return "Injected Wallet";
}

function normalizeAnnouncedWallet(detail) {
  if (!detail?.info || !detail?.provider) return null;

  return {
    uuid: detail.info.uuid || `${detail.info.name || "wallet"}-${Math.random()}`,
    name: detail.info.name || "Injected Wallet",
    icon: detail.info.icon || "",
    rdns: detail.info.rdns || "",
    provider: detail.provider
  };
}

async function discoverWallets(timeoutMs = 500) {
  const announced = new Map();

  function onAnnounce(event) {
    const wallet = normalizeAnnouncedWallet(event.detail);
    if (!wallet) return;
    announced.set(wallet.uuid, wallet);
  }

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));

  window.removeEventListener("eip6963:announceProvider", onAnnounce);

  let wallets = Array.from(announced.values());

  if (!wallets.length && window.ethereum) {
    wallets = [
      {
        uuid: "legacy-window-ethereum",
        name: detectLegacyWalletName(window.ethereum),
        icon: "",
        rdns: "",
        provider: window.ethereum
      }
    ];
  }

  const seen = new Set();
  wallets = wallets.filter((wallet) => {
    const key = `${wallet.name}|${wallet.rdns}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return wallets;
}

async function pickWallet(wallets) {
  if (!wallets.length) {
    throw new Error("No compatible wallet found. Install Backpack, OKX, TokenPocket, MetaMask, or another EVM wallet.");
  }

  if (wallets.length === 1) {
    return wallets[0];
  }

  const options = wallets.map((w, i) => `${i + 1}. ${w.name}`).join("\n");
  const choice = window.prompt(`Choose wallet:\n${options}`, "1");
  const index = Number(choice) - 1;

  if (!wallets[index]) {
    throw new Error("Invalid wallet selection.");
  }

  return wallets[index];
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
      const res = await fetch(uri, { cache: "force-cache" });
      const json = await res.json();
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

async function getOwnedNfts(owner) {
  try {
    const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);
    const tokenIds = [];
    const ownerChecksum = ethers.getAddress(owner);
    const scanBatchSize = 50;
    const metadataBatchSize = 12;

    setStatus("Scanning collection ownership...");

    async function ownerOfWithRetry(tokenId) {
      try {
        return await nft.ownerOf(tokenId);
      } catch {
        try {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return await nft.ownerOf(tokenId);
        } catch {
          return null;
        }
      }
    }

    for (let start = 1; start <= MAX_SCAN; start += scanBatchSize) {
      const end = Math.min(start + scanBatchSize - 1, MAX_SCAN);
      setStatus(`Scanning collection ownership...\n${start}-${end} / ${MAX_SCAN}`);

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

    if (!tokenIds.length) return [];

    setStatus(`Found ${tokenIds.length} DYOOR.\nLoading metadata...`);

    const items = [];
    for (let i = 0; i < tokenIds.length; i += metadataBatchSize) {
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

    return items;
  } catch (err) {
    console.error("getOwnedNfts error", err);
    throw new Error("Wallet connected, but direct NFT scan failed.");
  }
}

async function getStakedTokenIds(owner) {
  const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

  try {
    const ids = await staking.tokensOfStaker(owner);
    return ids.map((x) => x.toString());
  } catch (err) {
    console.error("getStakedTokenIds error", err);
    throw new Error("Wallet connected, but staked NFT loading failed.");
  }
}

async function enrichStakedTokenIds(tokenIds) {
  const items = [];
  for (const tokenId of tokenIds) {
    const meta = await fetchTokenMetadata(tokenId);
    items.push({
      tokenId,
      source: "staked",
      name: meta.name,
      image: meta.image
    });
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
      ${item.image ? `<img src="${item.image}" alt="${item.name}" loading="lazy" />` : `<div class="no-image">No Image</div>`}
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

function updateButtons() {
  const hasWalletItems = ownedNfts.length > 0;
  const selectedVisible = getVisibleItems().filter((x) => selectedIds.has(x.tokenId)).length > 0;

  ascendSelectedBtn.disabled = !(currentTab === "wallet" && selectedVisible && userAddress);
  ascendAllBtn.disabled = !(currentTab === "wallet" && hasWalletItems && userAddress);
  disconnectSelectedBtn.disabled = !(currentTab === "staked" && selectedVisible && userAddress);
  harvestBtn.disabled = !userAddress;
}

async function updateEnergy() {
  if (!userAddress) return;

  const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

  try {
    await seedKnownHistoricalHarvestIfNeeded(userAddress);

    const [pending, stakedBalance, pointsPerDayRaw, harvestedRaw] = await Promise.all([
      staking.pendingPoints(userAddress),
      staking.stakedBalance(userAddress),
      staking.pointsPerDay(),
      fetchHarvestedEnergyRaw(userAddress).catch(() => 0n)
    ]);

    const pendingDisplay = Number(ethers.formatEther(pending));
    const harvestedDisplay = Number(ethers.formatEther(harvestedRaw));
    const lifetimeDisplay = Number(ethers.formatEther(pending + harvestedRaw));
    const pointsPerDayPerNft = Number(ethers.formatEther(pointsPerDayRaw));
    const totalRate = Number(stakedBalance) * pointsPerDayPerNft;

    pendingEnergy.textContent = formatEnergyValue(pendingDisplay);
    harvestedEnergy.textContent = formatEnergyValue(harvestedDisplay);
    lifetimeEnergy.textContent = formatEnergyValue(lifetimeDisplay);
    energyRate.textContent = Number.isInteger(totalRate)
      ? `${totalRate} / day`
      : `${totalRate.toFixed(2)} / day`;
  } catch (err) {
    console.error("energy error", err);
    pendingEnergy.textContent = "0.00";
    harvestedEnergy.textContent = "0.00";
    lifetimeEnergy.textContent = "0.00";
    energyRate.textContent = "0 / day";
    setStatus(`Energy load failed: ${formatError(err)}`);
  }
}

async function loadState() {
  if (!userAddress || !provider) {
    syncStakeGlobals();
    return;
  }

  try {
    setStatus("Loading ascended NFTs...");
    const stakedIds = await getStakedTokenIds(userAddress);
    stakedNfts = await enrichStakedTokenIds(stakedIds);

    selectedIds.clear();
    updateSelectedCount();
    renderGrid();
    updateButtons();
    await updateEnergy();
    syncStakeGlobals();

    setStatus("Loading wallet NFTs...");
    ownedNfts = await getOwnedNfts(userAddress);

    selectedIds.clear();
    updateSelectedCount();
    renderGrid();
    updateButtons();
    await updateEnergy();
    syncStakeGlobals();

    setStatus("Ascension state synchronized.");
  } catch (err) {
    console.error("loadState error", err);
    ownedNfts = [];
    stakedNfts = [];
    selectedIds.clear();
    updateSelectedCount();
    renderGrid();
    updateButtons();
    syncStakeGlobals();
    setStatus(formatError(err, "Failed to load wallet state."));
  }
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

      syncStakeGlobals();
      setStatus("Account changed.");
      await loadState();
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
      setStatus("Network changed.");

      await loadState();
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
  try {
    setStatus("Looking for wallets...");
    const wallets = await discoverWallets();
    const chosenWallet = await pickWallet(wallets);

    injectedProvider = chosenWallet.provider;
    injectedWalletName = chosenWallet.name;

    setStatus(`Connecting ${chosenWallet.name}...`);

    const accounts = await injectedProvider.request({
      method: "eth_requestAccounts"
    });

    if (!accounts || !accounts.length) {
      throw new Error("No accounts returned from wallet.");
    }

    provider = new ethers.BrowserProvider(injectedProvider);
    signer = await provider.getSigner();
    userAddress = accounts[0];

    walletStatus.textContent = shorten(userAddress);
    connectBtn.textContent = `Connected: ${chosenWallet.name}`;

    try {
      await ensureMonadNetwork();
    } catch (err) {
      console.warn("Network switch skipped or failed:", err);
    }

    bindProviderEvents();
    syncStakeGlobals();
    setStatus(`Wallet connected: ${chosenWallet.name}`);

    await loadState();
  } catch (err) {
    console.error("connectWallet error:", err);
    setStatus(formatError(err, "Connection failed."));
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
    await loadState();
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
    await loadState();
  } catch (err) {
    console.error("disconnectTokenIds error", err);
    setStatus(`Disconnect failed: ${formatError(err, "Unknown unstake error.")}`);
  }
}

async function harvestEnergy() {
  try {
    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);
    const claimableBefore = await staking.pendingPoints(userAddress);

    setStatus("Harvesting Energy...");
    const txHash = await sendContractTx(
      STAKING_ADDRESS,
      stakingAbi,
      "claimPoints",
      []
    );

    await waitForHash(txHash);

    if (claimableBefore > 0n) {
      try {
        await recordHarvest(userAddress, claimableBefore, txHash);
      } catch (recordErr) {
        console.warn("recordHarvest failed", recordErr);
      }
    }

    setStatus("Energy harvested.");
    await loadState();
  } catch (err) {
    console.error("harvestEnergy error", err);
    setStatus(`Harvest failed: ${formatError(err, "Unknown claim error.")}`);
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
  await loadState();
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