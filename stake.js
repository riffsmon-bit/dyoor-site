// --- CONFIG ---
const CHAIN_ID_HEX = "0x8f";
const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";

const MAX_SCAN = 1111;
const BATCH_SIZE = 20;

// --- ABI ---
const stakingAbi = [
  "function tokensOfStaker(address user) view returns (uint256[])",
  "function pendingPoints(address user) view returns (uint256)",
  "function stakedBalance(address user) view returns (uint256)"
];

const nftAbi = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)"
];

// --- STATE ---
let provider, signer, userAddress;
let injectedProvider;

let ownedNfts = [];
let stakedNfts = [];
let selectedIds = new Set();

let currentTab = "wallet";

// --- UI ---
const connectBtn = document.getElementById("connectBtn");
const walletStatus = document.getElementById("walletStatus");
const statusBox = document.getElementById("statusBox");
const nftGrid = document.getElementById("nftGrid");

// --- HELPERS ---
function setStatus(msg) {
  statusBox.textContent = msg;
}

function shorten(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function normalizeIpfs(url) {
  if (!url) return "";
  if (url.startsWith("ipfs://")) {
    return "https://ipfs.io/ipfs/" + url.replace("ipfs://", "");
  }
  return url;
}

// --- WALLET DISCOVERY ---
async function discoverWallets() {
  const wallets = [];

  window.dispatchEvent(new Event("eip6963:requestProvider"));

  window.addEventListener("eip6963:announceProvider", (event) => {
    wallets.push(event.detail);
  });

  await new Promise((r) => setTimeout(r, 300));

  if (!wallets.length && window.ethereum) {
    wallets.push({ provider: window.ethereum, info: { name: "Injected" } });
  }

  return wallets;
}

// --- CONNECT ---
async function connectWallet() {
  try {
    setStatus("Detecting wallets...");

    const wallets = await discoverWallets();
    const wallet = wallets[0];

    injectedProvider = wallet.provider;

    await injectedProvider.request({ method: "eth_requestAccounts" });

    provider = new ethers.BrowserProvider(injectedProvider);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    walletStatus.textContent = shorten(userAddress);
    setStatus("Connected ⚡");

    await loadStateFast();
  } catch (e) {
    console.error(e);
    setStatus("Connection failed");
  }
}

// --- LOAD STATE ---
async function loadStateFast() {
  if (!userAddress) return;

  const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

  setStatus("Loading ascended NFTs...");

  const stakedIds = await staking.tokensOfStaker(userAddress);
  stakedNfts = stakedIds.map(x => x.toString());

  renderNFTs(stakedNfts, "staked");

  await updateEnergy();

  loadWalletNFTsBackground();
}

// --- BACKGROUND SCAN ---
async function loadWalletNFTsBackground() {
  setStatus("Scanning wallet NFTs...");

  const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);
  ownedNfts = [];

  for (let i = 1; i <= MAX_SCAN; i += BATCH_SIZE) {
    const batch = [];

    for (let j = i; j < i + BATCH_SIZE && j <= MAX_SCAN; j++) {
      batch.push(
        nft.ownerOf(j)
          .then(owner => ({ id: j, owner }))
          .catch(() => null)
      );
    }

    const results = await Promise.all(batch);

    for (const r of results) {
      if (!r) continue;
      if (r.owner.toLowerCase() === userAddress.toLowerCase()) {
        ownedNfts.push(r.id.toString());
      }
    }

    if (currentTab === "wallet") {
      renderNFTs(ownedNfts, "wallet");
    }

    await new Promise(r => setTimeout(r, 50));
  }

  setStatus("Ready 🚀");
}

// --- ENERGY ---
async function updateEnergy() {
  try {
    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

    const pending = await staking.pendingPoints(userAddress);
    const stakedBalance = await staking.stakedBalance(userAddress);

    document.getElementById("pendingEnergy").textContent =
      Number(ethers.formatEther(pending)).toFixed(2);

    document.getElementById("energyRate").textContent =
      `${Number(stakedBalance) * 24} / day`;

  } catch (err) {
    console.error("energy error", err);
  }
}

// --- RENDER ---
async function renderNFTs(ids, type) {
  nftGrid.innerHTML = "";

  if (!ids.length) {
    nftGrid.innerHTML = `<p>No NFTs found</p>`;
    return;
  }

  const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);

  for (const id of ids) {
    const el = document.createElement("div");
    el.className = "nft-card";

    let image = "";

    try {
      let uri = await nft.tokenURI(id);

      if (uri.startsWith("data:application/json;base64,")) {
        const json = JSON.parse(atob(uri.split(",")[1]));
        image = normalizeIpfs(json.image);
      } else {
        uri = normalizeIpfs(uri);
        const res = await fetch(uri);
        const json = await res.json();
        image = normalizeIpfs(json.image);
      }
    } catch (e) {}

    el.innerHTML = `
      <div class="nft-thumb">
        ${image ? `<img src="${image}" />` : `<div class="nft-image">#${id}</div>`}
      </div>
      <div class="nft-meta">
        <div class="name">DYOOR</div>
        <div class="sub">#${id}</div>
      </div>
    `;

    nftGrid.appendChild(el);
  }
}

// --- TAB SWITCH ---
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;

    if (currentTab === "wallet") {
      renderNFTs(ownedNfts, "wallet");
    } else {
      renderNFTs(stakedNfts, "staked");
    }
  });
});

// --- INIT ---
connectBtn.addEventListener("click", connectWallet);