// --- CONFIG ---
const CHAIN_ID_HEX = "0x8f";
const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";

const MAX_SCAN = 1111;
const BATCH_SIZE = 20; // 🔥 LOWER = FASTER ON MOBILE

// --- ABI ---
const stakingAbi = [
  "function stakeDeposited(uint256[] calldata tokenIds)",
  "function unstake(uint256[] calldata tokenIds)",
  "function claimPoints()",
  "function pendingPoints(address user) view returns (uint256)",
  "function tokensOfStaker(address user) view returns (uint256[])",
  "function stakedBalance(address user) view returns (uint256)"
];

const nftAbi = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)"
];

// --- STATE ---
let provider, signer, userAddress;
let injectedProvider;

// --- UI ---
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

// --- WALLET DISCOVERY (FAST + SAFE) ---
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
    const wallet = wallets[0]; // auto-pick first

    injectedProvider = wallet.provider;

    await injectedProvider.request({ method: "eth_requestAccounts" });

    provider = new ethers.BrowserProvider(injectedProvider);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    walletStatus.textContent = shorten(userAddress);
    setStatus("Connected");

    await loadStateFast(); // 🔥 FAST LOAD
  } catch (e) {
    console.error(e);
    setStatus("Connection failed");
  }
}

// --- FAST STATE LOAD ---
async function loadStateFast() {
  if (!userAddress) return;

  // 🔥 STEP 1: LOAD STAKED FIRST (FAST)
  setStatus("Loading ascended NFTs...");

  const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);
  const stakedIds = await staking.tokensOfStaker(userAddress);

  renderNFTs(stakedIds.map(x => x.toString()), "staked");

  // 🔥 STEP 2: LOAD WALLET NFTs IN BACKGROUND
  loadWalletNFTsBackground();
}

// --- BACKGROUND WALLET SCAN ---
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

    // 🔥 update UI progressively
    renderNFTs(owned, "wallet");

    await new Promise(r => setTimeout(r, 50)); // yield thread
  }

  setStatus("Ready");
}

// --- RENDER ---
function renderNFTs(ids, type) {
  if (!ids.length) return;

  nftGrid.innerHTML = "";

  ids.forEach(id => {
    const el = document.createElement("div");
    el.className = "nft-card";

    el.innerHTML = `
      <div class="nft-image">#${id}</div>
      <div class="nft-id">#${id}</div>
    `;

    nftGrid.appendChild(el);
  });
}

// --- BUTTON ---
document.getElementById("connectBtn").onclick = connectWallet;