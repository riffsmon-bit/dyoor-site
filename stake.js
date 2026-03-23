// --- CONFIG ---
const CHAIN_ID_HEX = "0x8f";
const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";

const MAX_SCAN = 1111;
const BATCH_SIZE = 20;

// --- ABI ---
const stakingAbi = [
  "function tokensOfStaker(address user) view returns (uint256[])"
];

const nftAbi = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)"
];

// --- STATE ---
let provider, signer, userAddress;
let injectedProvider;

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

// --- FAST LOAD ---
async function loadStateFast() {
  if (!userAddress) return;

  setStatus("Loading staked NFTs...");

  const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);
  const stakedIds = await staking.tokensOfStaker(userAddress);

  renderNFTs(stakedIds.map(x => x.toString()));

  // background wallet load
  loadWalletNFTsBackground();
}

// --- BACKGROUND SCAN ---
async function loadWalletNFTsBackground() {
  setStatus("Scanning wallet NFTs...");

  const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);
  const owned = [];

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
        owned.push(r.id.toString());
      }
    }

    // progressively render
    renderNFTs(owned);

    await new Promise(r => setTimeout(r, 50));
  }

  setStatus("Ready 🚀");
}

// --- RENDER WITH IMAGES ---
async function renderNFTs(ids) {
  nftGrid.innerHTML = "";

  const nft = new ethers.Contract(NFT_ADDRESS, nftAbi, provider);

  for (const id of ids) {
    const el = document.createElement("div");
    el.className = "nft-card";

    let image = "";
    let name = "DYOOR";

    try {
      let uri = await nft.tokenURI(id);

      if (uri.startsWith("data:application/json;base64,")) {
        const json = JSON.parse(atob(uri.split(",")[1]));
        image = normalizeIpfs(json.image);
        name = json.name || name;
      } else {
        uri = normalizeIpfs(uri);
        const res = await fetch(uri);
        const json = await res.json();
        image = normalizeIpfs(json.image);
        name = json.name || name;
      }
    } catch (e) {
      console.log("metadata fail", id);
    }

    el.innerHTML = `
      <div class="nft-thumb">
        ${image ? `<img src="${image}" />` : `<div class="nft-image">#${id}</div>`}
      </div>
      <div class="nft-meta">
        <div class="name">${name}</div>
        <div class="sub">#${id}</div>
      </div>
    `;

    nftGrid.appendChild(el);
  }
}

// --- INIT ---
connectBtn.addEventListener("click", connectWallet);