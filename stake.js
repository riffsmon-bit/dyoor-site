const CHAIN_ID = 143;
const CHAIN_ID_HEX = "0x8f";

const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const STAKING_ADDRESS = "0x23C66179144d5d6D1a24E58BdB97CE6266a0ba8D";
const OPENSEA_PROXY = "/.netlify/functions/opensea";
const ENERGY_PER_DAY_PER_NFT = 24;

const stakingAbi = [
  "function stake(uint256[] calldata tokenIds)",
  "function unstake(uint256[] calldata tokenIds)",
  "function claimPoints()",
  "function pendingPoints(address user) view returns (uint256)",
  "function tokensOfStaker(address user) view returns (uint256[] memory)",
  "function stakedBalance(address user) view returns (uint256)"
];

const nftAbi = [
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)"
];

let provider;
let signer;
let userAddress = null;
let currentTab = "wallet";
let ownedNfts = [];
let stakedNfts = [];
let selectedIds = new Set();

const connectBtn = document.getElementById("connectBtn");
const ascendSelectedBtn = document.getElementById("ascendSelectedBtn");
const ascendAllBtn = document.getElementById("ascendAllBtn");
const disconnectSelectedBtn = document.getElementById("disconnectSelectedBtn");
const harvestBtn = document.getElementById("harvestBtn");
const walletStatus = document.getElementById("walletStatus");
const pendingEnergy = document.getElementById("pendingEnergy");
const energyRate = document.getElementById("energyRate");
const selectedCount = document.getElementById("selectedCount");
const statusBox = document.getElementById("statusBox");
const nftGrid = document.getElementById("nftGrid");
const emptyState = document.getElementById("emptyState");

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

function pickArray(data) {
  return (
    data?.nfts ||
    data?.assets ||
    data?.results ||
    data?.tokens ||
    data?.items ||
    []
  );
}

function extractTokenId(item) {
  return String(
    item?.token_id ??
    item?.identifier ??
    item?.id ??
    item?.tokenId ??
    ""
  );
}

function extractImage(item) {
  return normalizeIpfs(
    item?.image_url ||
    item?.image ||
    item?.display_image_url ||
    item?.image_original_url ||
    item?.metadata?.image ||
    ""
  );
}

function extractName(item, tokenId) {
  return (
    item?.name ||
    item?.metadata?.name ||
    `DYOOR #${tokenId}`
  );
}

async function fetchOwnedNftsFromProxy(owner) {
  const url = `${OPENSEA_PROXY}?chain=monad&address=${NFT_ADDRESS}&owner=${owner}&limit=200`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Proxy failed with ${res.status}`);
  }

  const data = await res.json();
  const items = pickArray(data);

  return items
    .map((item) => {
      const tokenId = extractTokenId(item);
      return {
        tokenId,
        source: "wallet",
        name: extractName(item, tokenId),
        image: extractImage(item)
      };
    })
    .filter((item) => item.tokenId);
}

async function fetchTokenMetadata(tokenId) {
  try {
    const url = `${OPENSEA_PROXY}?chain=monad&address=${NFT_ADDRESS}&tokenId=${tokenId}`;
    const res = await fetch(url);

    if (res.ok) {
      const data = await res.json();
      const nft =
        data?.nft ||
        data?.asset ||
        data?.item ||
        data;

      return {
        image: extractImage(nft),
        name: extractName(nft, tokenId)
      };
    }
  } catch (err) {
    console.error("metadata fetch error", tokenId, err);
  }

  return {
    image: "",
    name: `DYOOR #${tokenId}`
  };
}

async function getOwnedNfts(owner) {
  try {
    return await fetchOwnedNftsFromProxy(owner);
  } catch (err) {
    console.error("getOwnedNfts error", err);
    throw new Error("Wallet connected, but NFT loading failed from the collection API.");
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
    return;
  }

  emptyState.style.display = "none";

  for (const item of items) {
    const card = document.createElement("div");
    card.className = `nft-card ${selectedIds.has(item.tokenId) ? "selected" : ""}`;
    card.dataset.id = item.tokenId;

    card.innerHTML = `
      <div class="nft-image-wrap">
        ${item.image ? `<img src="${item.image}" alt="${item.name}">` : `<span>No Image</span>`}
      </div>
      <div class="nft-meta">
        <div class="nft-name">${item.name}</div>
        <div class="nft-sub">#${item.tokenId}</div>
      </div>
    `;

    card.addEventListener("click", () => {
      if (selectedIds.has(item.tokenId)) {
        selectedIds.delete(item.tokenId);
      } else {
        selectedIds.add(item.tokenId);
      }
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

  try {
    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);
    const pending = await staking.pendingPoints(userAddress);
    const stakedBalance = await staking.stakedBalance(userAddress);

    pendingEnergy.textContent = Number(ethers.formatEther(pending)).toFixed(2);
    energyRate.textContent = `${Number(stakedBalance) * ENERGY_PER_DAY_PER_NFT} / day`;
  } catch (err) {
    console.error("energy error", err);
    pendingEnergy.textContent = "0.00";
    energyRate.textContent = "0 / day";
  }
}

async function loadState() {
  if (!userAddress || !provider) return;

  try {
    setStatus("Loading wallet NFTs...");
    ownedNfts = await getOwnedNfts(userAddress);

    setStatus("Loading ascended NFTs...");
    const stakedIds = await getStakedTokenIds(userAddress);
    stakedNfts = await enrichStakedTokenIds(stakedIds);

    selectedIds.clear();
    updateSelectedCount();
    renderGrid();
    updateButtons();
    await updateEnergy();

    setStatus("Ascension state synchronized.");
  } catch (err) {
    console.error("loadState error", err);
    ownedNfts = [];
    stakedNfts = [];
    selectedIds.clear();
    updateSelectedCount();
    renderGrid();
    updateButtons();
    setStatus(err?.message || "Failed to load wallet state.");
  }
}

async function ensureMonadNetwork() {
  const current = await window.ethereum.request({ method: "eth_chainId" });

  if (current === CHAIN_ID_HEX) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }]
    });
  } catch (err) {
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: "Monad Mainnet",
          nativeCurrency: {
            name: "MON",
            symbol: "MON",
            decimals: 18
          },
          rpcUrls: ["https://rpc.monad.xyz"],
          blockExplorerUrls: ["https://explorer.monad.xyz"]
        }]
      });
    } else {
      throw err;
    }
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus("No wallet found. Install MetaMask or open in a wallet browser.");
    return;
  }

  try {
    setStatus("Connecting wallet...");

    provider = new ethers.BrowserProvider(window.ethereum);

    await ensureMonadNetwork();
    await window.ethereum.request({ method: "eth_requestAccounts" });

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    walletStatus.textContent = shorten(userAddress);
    connectBtn.textContent = "Connected";

    setStatus("Wallet connected.");
    await loadState();
  } catch (err) {
    console.error("connectWallet error:", err);
    setStatus(err?.message || "Connection failed.");
  }
}

async function ensureApproval() {
  const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, signer);
  const approved = await nft.isApprovedForAll(userAddress, STAKING_ADDRESS);

  if (approved) return;

  setStatus("Approval required. Confirm in wallet...");
  const tx = await nft.setApprovalForAll(STAKING_ADDRESS, true);
  await tx.wait();
}

async function ascendTokenIds(tokenIds) {
  if (!tokenIds.length) return;

  try {
    await ensureApproval();

    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, signer);
    setStatus("Ascension in progress...");
    const tx = await staking.stake(tokenIds);
    await tx.wait();

    setStatus("Ascension complete.");
    await loadState();
  } catch (err) {
    console.error("ascendTokenIds error", err);
    setStatus("Ascension failed.");
  }
}

async function disconnectTokenIds(tokenIds) {
  if (!tokenIds.length) return;

  try {
    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, signer);
    setStatus("Disconnecting from the protocol...");
    const tx = await staking.unstake(tokenIds);
    await tx.wait();

    setStatus("Disconnect complete.");
    await loadState();
  } catch (err) {
    console.error("disconnectTokenIds error", err);
    setStatus("Disconnect failed.");
  }
}

async function harvestEnergy() {
  try {
    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, signer);
    setStatus("Harvesting Energy...");
    const tx = await staking.claimPoints();
    await tx.wait();

    setStatus("Energy harvested.");
    await loadState();
  } catch (err) {
    console.error("harvestEnergy error", err);
    setStatus("Harvest failed.");
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
    updateSelectedCount();
    renderGrid();
    updateButtons();
  });
});

document.getElementById("selectAllVisibleBtn").addEventListener("click", () => {
  getVisibleItems().forEach((item) => selectedIds.add(item.tokenId));
  updateSelectedCount();
  renderGrid();
  updateButtons();
});

document.getElementById("clearSelectionBtn").addEventListener("click", () => {
  selectedIds.clear();
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
  await ascendTokenIds(selectedVisibleTokenIds());
});

ascendAllBtn.addEventListener("click", async () => {
  await ascendTokenIds(ownedNfts.map((x) => x.tokenId));
});

disconnectSelectedBtn.addEventListener("click", async () => {
  await disconnectTokenIds(selectedVisibleTokenIds());
});

harvestBtn.addEventListener("click", harvestEnergy);

if (window.ethereum) {
  window.ethereum.on("accountsChanged", async (accounts) => {
    if (!accounts.length) {
      userAddress = null;
      signer = null;
      provider = null;
      ownedNfts = [];
      stakedNfts = [];
      selectedIds.clear();
      walletStatus.textContent = "Not Connected";
      connectBtn.textContent = "Connect Wallet";
      pendingEnergy.textContent = "0.00";
      energyRate.textContent = "0 / day";
      nftGrid.innerHTML = "";
      emptyState.style.display = "block";
      updateSelectedCount();
      updateButtons();
      setStatus("Disconnected.");
      return;
    }

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = accounts[0];
    walletStatus.textContent = shorten(userAddress);
    connectBtn.textContent = "Connected";
    setStatus("Account changed.");
    await loadState();
  });

  window.ethereum.on("chainChanged", async () => {
    try {
      provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await window.ethereum.request({ method: "eth_accounts" });

      if (!accounts.length) {
        userAddress = null;
        signer = null;
        walletStatus.textContent = "Not Connected";
        connectBtn.textContent = "Connect Wallet";
        setStatus("Wallet disconnected.");
        return;
      }

      signer = await provider.getSigner();
      userAddress = accounts[0];
      walletStatus.textContent = shorten(userAddress);
      connectBtn.textContent = "Connected";
      setStatus("Network changed.");
      await loadState();
    } catch (err) {
      console.error("chainChanged error", err);
      setStatus("Switch to Monad Mainnet to continue.");
    }
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  if (!window.ethereum) {
    updateButtons();
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });

    if (accounts.length) {
      provider = new ethers.BrowserProvider(window.ethereum);
      signer = await provider.getSigner();
      userAddress = accounts[0];
      walletStatus.textContent = shorten(userAddress);
      connectBtn.textContent = "Connected";
      setStatus("Restoring session...");
      await loadState();
    } else {
      updateButtons();
    }
  } catch (err) {
    console.error("restore error:", err);
  }
});