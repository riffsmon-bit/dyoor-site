// --- CONFIG ---
const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";

const MAX_SCAN = 1111;
const BATCH_SIZE = 20;

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
  "function setApprovalForAll(address operator, bool approved)"
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
const ascendBtn = document.getElementById("ascendSelectedBtn");
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

// --- WALLET ---
async function discoverWallets() {
  const wallets = [];

  window.dispatchEvent(new Event("eip6963:requestProvider"));

  window.addEventListener("eip6963:announceProvider", (event) => {
    wallets.push(event.detail);
  });

  await new Promise(r => setTimeout(r, 300));

  if (!wallets.length && window.ethereum) {
    wallets.push({ provider: window.ethereum });
  }

  return wallets;
}

async function connectWallet() {
  try {
    setStatus("Connecting...");

    const wallets = await discoverWallets();
    injectedProvider = wallets[0].provider;

    await injectedProvider.request({ method: "eth_requestAccounts" });

    provider = new ethers.BrowserProvider(injectedProvider);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    walletStatus.textContent = shorten(userAddress);
    setStatus("Connected ⚡");

    await loadState();
  } catch (err) {
    console.error(err);
    setStatus("Connection failed");
  }
}

// --- LOAD STATE ---
async function loadState() {
  const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

  const stakedIds = await staking.tokensOfStaker(userAddress);
  stakedNfts = stakedIds.map(x => x.toString());

  renderNFTs(stakedNfts);

  await updateEnergy();
  updateBattery();

  loadWalletNFTs();
}

// --- BACKGROUND LOAD ---
async function loadWalletNFTs() {
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
      renderNFTs(ownedNfts);
    }

    await new Promise(r => setTimeout(r, 50));
  }

  updateBattery();
  setStatus("Ready 🚀");
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

// --- BATTERY ---
function updateBattery() {
  const staked = stakedNfts.length;
  const total = stakedNfts.length + ownedNfts.length;

  const percent = total > 0 ? Math.floor((staked / total) * 100) : 0;

  document.querySelector(".battery-percent").textContent = `${percent}%`;
  document.querySelector(".battery-text").textContent =
    `${staked} ascended / ${total} total visible`;

  const bar = document.querySelector(".battery-bar-fill");
  if (bar) {
    bar.style.width = `${percent}%`;
  }
}

// --- RENDER + SELECT ---
async function renderNFTs(ids) {
  nftGrid.innerHTML = "";

  if (!ids.length) {
    nftGrid.innerHTML = `<p>No NFTs found</p>`;
    return;
  }

  const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);

  for (const id of ids) {
    const el = document.createElement("div");

    const isSelected = selectedIds.has(id);
    el.className = `nft-card ${isSelected ? "selected" : ""}`;

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

    // 🔥 CLICK SELECT
    el.onclick = () => {
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }

      updateButtons();
      renderNFTs(currentTab === "wallet" ? ownedNfts : stakedNfts);
    };

    nftGrid.appendChild(el);
  }
}

// --- BUTTON LOGIC ---
function updateButtons() {
  if (!ascendBtn) return;

  ascendBtn.disabled = selectedIds.size === 0;
}

// --- ASCEND ---
async function ascendSelected() {
  if (!selectedIds.size) return;

  const ids = Array.from(selectedIds).map(x => BigInt(x));

  const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, signer);

  setStatus("Approving...");
  await nft.setApprovalForAll(STAKING_ADDRESS, true);

  setStatus("Ascending...");
  const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, signer);
  await staking.stakeDeposited(ids);

  setStatus("Done 🚀");

  selectedIds.clear();
  await loadState();
}

// --- TABS ---
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.onclick = () => {
    currentTab = btn.dataset.tab;

    if (currentTab === "wallet") {
      renderNFTs(ownedNfts);
    } else {
      renderNFTs(stakedNfts);
    }
  };
});

// --- INIT ---
connectBtn.onclick = connectWallet;
if (ascendBtn) ascendBtn.onclick = ascendSelected;