const CHAIN_ID = 143;
const CHAIN_ID_HEX = "0x8f";

const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const STAKING_ADDRESS = "0x56daD1ae39d52aae7274C0260D1fA36A41D2Dc69";
const ENERGY_PER_DAY_PER_NFT = 24;
const MAX_SCAN = 1111;
const BATCH_SIZE = 40;

const stakingAbi = [
  "function stake(uint256[] calldata tokenIds)",
  "function unstake(uint256[] calldata tokenIds)",
  "function claimPoints()",
  "function pendingPoints(address user) view returns (uint256)",
  "function tokensOfStaker(address user) view returns (uint256[] memory)",
  "function stakedBalance(address user) view returns (uint256)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function s1Nft() view returns (address)",
  "function pointsPerDay() view returns (uint256)",

  "error EnforcedPause()",
  "error ExpectedPause()",
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnableInvalidOwner(address owner)",
  "error ReentrancyGuardReentrantCall()"
];

const nftAbi = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",

  "error ERC721InvalidOwner(address owner)",
  "error ERC721NonexistentToken(uint256 tokenId)",
  "error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner)",
  "error ERC721InvalidSender(address sender)",
  "error ERC721InvalidReceiver(address receiver)",
  "error ERC721InsufficientApproval(address operator, uint256 tokenId)",
  "error ERC721InvalidApprover(address approver)",
  "error ERC721InvalidOperator(address operator)"
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

async function fetchTokenMetadata(tokenId) {
  try {
    const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);
    let uri = await nft.tokenURI(tokenId);

    if (uri.startsWith("data:application/json;base64,")) {
      const b64 = uri.split(",")[1];
      const json = JSON.parse(atob(b64));
      return {
        image: normalizeIpfs(json.image || ""),
        name: json.name || `DYOOR #${tokenId}`
      };
    }

    uri = normalizeIpfs(uri);
    const res = await fetch(uri);
    const json = await res.json();

    return {
      image: normalizeIpfs(json.image || ""),
      name: json.name || `DYOOR #${tokenId}`
    };
  } catch (err) {
    console.error("metadata error", tokenId, err);
    return {
      image: "",
      name: `DYOOR #${tokenId}`
    };
  }
}

async function getOwnedNfts(owner) {
  try {
    const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);
    const tokenIds = [];
    const ownerChecksum = ethers.getAddress(owner);

    setStatus("Scanning collection ownership...");

    for (let start = 1; start <= MAX_SCAN; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE - 1, MAX_SCAN);
      setStatus(`Scanning collection ownership... ${start}-${end} / ${MAX_SCAN}`);

      const batch = [];
      for (let tokenId = start; tokenId <= end; tokenId++) {
        batch.push(
          nft.ownerOf(tokenId)
            .then((currentOwner) => ({
              tokenId,
              owner: currentOwner
            }))
            .catch(() => null)
        );
      }

      const results = await Promise.all(batch);

      for (const result of results) {
        if (!result) continue;

        try {
          if (ethers.getAddress(result.owner) === ownerChecksum) {
            tokenIds.push(String(result.tokenId));
          }
        } catch {
          // skip malformed address results
        }
      }
    }

    if (!tokenIds.length) return [];

    setStatus(`Found ${tokenIds.length} DYOOR. Loading metadata...`);

    const items = [];
    for (const tokenId of tokenIds) {
      const meta = await fetchTokenMetadata(tokenId);
      items.push({
        tokenId,
        source: "wallet",
        name: meta.name,
        image: meta.image
      });
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
    setStatus(formatError(err, "Failed to load wallet state."));
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
    setStatus(formatError(err, "Connection failed."));
  }
}

async function ensureApproval() {
  const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, signer);

  const approved = await nft.isApprovedForAll(userAddress, STAKING_ADDRESS);
  console.log("isApprovedForAll before:", approved, "owner:", userAddress, "operator:", STAKING_ADDRESS);

  if (approved) return true;

  setStatus("Approval required. Confirm in wallet...");
  const tx = await nft.setApprovalForAll(STAKING_ADDRESS, true);
console.log("approval tx hash:", tx.hash);
await provider.waitForTransaction(tx.hash);

  const approvedAfter = await nft.isApprovedForAll(userAddress, STAKING_ADDRESS);
  console.log("isApprovedForAll after:", approvedAfter);

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

    setStatus(`Preparing ${normalizedIds.length} NFT(s) for ascension...`);
    console.log("ascendTokenIds start");
    console.log("wallet:", userAddress);
    console.log("NFT_ADDRESS:", NFT_ADDRESS);
    console.log("STAKING_ADDRESS:", STAKING_ADDRESS);
    console.log("selected tokenIds:", normalizedIds.map(String));

    await ensureApproval();

    const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);

    for (const id of normalizedIds) {
      try {
        const ownerNow = await nft.ownerOf(id);
        console.log("ownerOf", id.toString(), ownerNow);
      } catch (err) {
        console.error("ownerOf failed for token", id.toString(), err);
      }
    }

    const approvedNow = await nft.isApprovedForAll(userAddress, STAKING_ADDRESS);
    console.log("approvedForAll now:", approvedNow);

    const stakingRead = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

    try {
      const contractOwner = await stakingRead.owner();
      const paused = await stakingRead.paused();
      const s1Nft = await stakingRead.s1Nft();
      const points = await stakingRead.pointsPerDay();

      console.log("staking.owner()", contractOwner);
      console.log("staking.paused()", paused);
      console.log("staking.s1Nft()", s1Nft);
      console.log("staking.pointsPerDay()", points.toString());
    } catch (err) {
      console.error("staking read debug failed", err);
    }

    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, signer);

    try {
      const gas = await staking.stake.estimateGas(normalizedIds);
      console.log("stake gas estimate:", gas.toString());
    } catch (err) {
      console.error("stake estimateGas full error", err);
      throw new Error(formatError(err, "Gas estimation failed before staking."));
    }

    setStatus("Ascension in progress...");
    const tx = await staking.stake(normalizedIds);
console.log("stake tx hash:", tx.hash);
await provider.waitForTransaction(tx.hash);

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
    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, signer);

    try {
      const tx = await staking.unstake(normalizedIds);
console.log("unstake tx hash:", tx.hash);
await provider.waitForTransaction(tx.hash);
    } catch (err) {
      console.error("unstake estimateGas error", err);
      throw new Error(formatError(err, "Gas estimation failed before unstaking."));
    }

    setStatus("Disconnecting from the protocol...");
    const tx = await staking.unstake(normalizedIds);
    console.log("unstake tx hash:", tx.hash);
    await tx.wait();

    setStatus("Disconnect complete.");
    await loadState();
  } catch (err) {
    console.error("disconnectTokenIds error", err);
    setStatus(`Disconnect failed: ${formatError(err, "Unknown unstake error.")}`);
  }
}

async function harvestEnergy() {
  try {
    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, signer);

    try {
      const gas = await staking.claimPoints.estimateGas();
      console.log("claimPoints gas estimate:", gas.toString());
    } catch (err) {
      console.error("estimateGas claim error", err);
      throw new Error(formatError(err, "Gas estimation failed before claim."));
    }

    setStatus("Harvesting Energy...");
    const tx = await staking.claimPoints();
console.log("claimPoints tx hash:", tx.hash);
await provider.waitForTransaction(tx.hash);

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
      emptyState.textContent = "No unstaked DYOOR found in this wallet yet.";
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
