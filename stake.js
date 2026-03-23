// --- CONFIG ---
const CHAIN_ID = 143;
const CHAIN_ID_HEX = "0x8f";

const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const ENERGY_PER_DAY_PER_NFT = 24;
const MAX_SCAN = 1111;
const BATCH_SIZE = 60; // 🔥 faster

// --- ABI ---
const stakingAbi = [
  "function tokensOfStaker(address user) view returns (uint256[])",
  "function pendingPoints(address user) view returns (uint256)",
  "function stakedBalance(address user) view returns (uint256)",
  "function stakeDeposited(uint256[] tokenIds)"
];

const nftAbi = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)"
];

// --- STATE ---
let provider;
let signer;
let userAddress = null;
let currentTab = "wallet";
let ownedNfts = [];
let stakedNfts = [];
let selectedIds = new Set();

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
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function normalizeIpfs(url) {
  if (!url) return "";
  if (url.startsWith("ipfs://")) {
    return "https://ipfs.io/ipfs/" + url.replace("ipfs://", "");
  }
  return url;
}

// --- NETWORK ---
async function ensureMonadNetwork() {
  const chainId = await window.ethereum.request({ method: "eth_chainId" });

  if (chainId !== CHAIN_ID_HEX) {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }]
    });
  }
}

// --- CONNECT (FIXED) ---
async function connectWallet() {
  if (!window.ethereum) {
    setStatus("No wallet found.");
    return;
  }

  try {
    setStatus("Connecting...");

    // ✅ CONNECT FIRST
    await window.ethereum.request({ method: "eth_requestAccounts" });

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    walletStatus.textContent = shorten(userAddress);
    connectBtn.textContent = "Connected";

    // ✅ SWITCH AFTER CONNECT
    try {
      await ensureMonadNetwork();
    } catch {}

    setStatus("Loading...");
    await loadState();

  } catch (err) {
    console.error(err);
    setStatus("Connection failed");
  }
}

// --- FAST NFT SCAN ---
async function getOwnedNfts(owner) {
  const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);
  const owned = [];

  for (let i = 1; i <= MAX_SCAN; i += BATCH_SIZE) {
    const batch = [];

    for (let j = i; j < i + BATCH_SIZE && j <= MAX_SCAN; j++) {
      batch.push(
        nft.ownerOf(j)
          .then(o => (o.toLowerCase() === owner.toLowerCase() ? j : null))
          .catch(() => null)
      );
    }

    const results = await Promise.all(batch);

    for (const id of results) {
      if (id) owned.push(id.toString());
    }

    setStatus(`Scanning ${Math.min(i + BATCH_SIZE, MAX_SCAN)} / ${MAX_SCAN}`);

    await new Promise(r => setTimeout(r, 15));
  }

  return owned;
}

// --- LOAD STATE ---
async function loadState() {
  try {
    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

    setStatus("Loading staked...");
    const stakedIds = await staking.tokensOfStaker(userAddress);
    stakedNfts = stakedIds.map(x => x.toString());

    setStatus("Scanning wallet...");
    ownedNfts = await getOwnedNfts(userAddress);

    await updateEnergy();

    renderNFTs(currentTab === "wallet" ? ownedNfts : stakedNfts);

    setStatus("Ready 🚀");

  } catch (err) {
    console.error(err);
    setStatus("Failed to load wallet state.");
  }
}

// --- ENERGY ---
async function updateEnergy() {
  const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

  const pending = await staking.pendingPoints(userAddress);
  const stakedBalance = await staking.stakedBalance(userAddress);

  document.getElementById("pendingEnergy").textContent =
    Number(ethers.formatEther(pending)).toFixed(2);

  document.getElementById("energyRate").textContent =
    `${Number(stakedBalance) * 24} / day`;
}

// --- RENDER ---
async function renderNFTs(ids) {
  nftGrid.innerHTML = "";

  const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);

  for (const id of ids) {
    const el = document.createElement("div");
    el.className = `nft-card ${selectedIds.has(id) ? "selected" : ""}`;

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
    } catch {}

    el.innerHTML = `
      <div class="nft-thumb">
        ${image ? `<img src="${image}" />` : `<div>#${id}</div>`}
      </div>
      <div>#${id}</div>
    `;

    el.onclick = () => {
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);

      renderNFTs(currentTab === "wallet" ? ownedNfts : stakedNfts);
    };

    nftGrid.appendChild(el);
  }
}

// --- INIT ---
connectBtn.addEventListener("click", connectWallet);

window.ethereum?.on("chainChanged", () => location.reload());