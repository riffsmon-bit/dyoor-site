// --- CONFIG ---
const CHAIN_ID = 143;
const CHAIN_ID_HEX = "0x8f";

const NFT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const ENERGY_PER_DAY_PER_NFT = 24;
const MAX_SCAN = 1111;
const BATCH_SIZE = 40;

// --- ABI ---
const stakingAbi = [
  "function deposit(uint256[] calldata tokenIds)",
  "function stakeDeposited(uint256[] calldata tokenIds)",
  "function unstake(uint256[] calldata tokenIds)",
  "function claimPoints()",
  "function pendingPoints(address user) view returns (uint256)",
  "function tokensOfStaker(address user) view returns (uint256[] memory)",
  "function stakedBalance(address user) view returns (uint256)"
];

const nftAbi = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function transferFrom(address from, address to, uint256 tokenId)"
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

// --- HELPERS ---
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
  return err?.message || fallback;
}

// --- CONNECT (FINAL FIX) ---
async function connectWallet() {
  if (!window.ethereum) {
    setStatus("No wallet found. Open in a wallet browser.");
    return;
  }

  try {
    setStatus("Connecting wallet...");

    // ✅ CONNECT ONLY (NO NETWORK FORCE)
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts"
    });

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = accounts[0];

    walletStatus.textContent = shorten(userAddress);
    connectBtn.textContent = "Connected";

    // ✅ CHECK NETWORK (DON’T FORCE)
    const chainId = await window.ethereum.request({ method: "eth_chainId" });

    if (chainId !== CHAIN_ID_HEX) {
      setStatus("⚠️ Switch to Monad network.");
      return;
    }

    setStatus("Wallet connected.");
    await loadState();

  } catch (err) {
    console.error("connectWallet error:", err);

    if (err.code === 4001) {
      setStatus("User rejected connection.");
    } else {
      setStatus("Connection failed.");
    }
  }
}

// --- LOAD STATE (UNCHANGED CORE) ---
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
    setStatus("Failed to load wallet state.");
  }
}

// --- KEEP EVERYTHING ELSE FROM YOUR ORIGINAL FILE ---
// (renderGrid, getOwnedNfts, ascendTokenIds, etc stay EXACTLY the same)

connectBtn.addEventListener("click", connectWallet);

// --- AUTO RELOAD ON NETWORK CHANGE ---
window.ethereum?.on("chainChanged", () => {
  window.location.reload();
});