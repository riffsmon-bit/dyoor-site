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

// --- NETWORK ---
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
          rpcUrls: ["https://rpc.monad.xyz"],
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }
        }]
      });
    } else {
      throw err;
    }
  }
}

// --- FIXED CONNECT ---
async function connectWallet() {
  if (!window.ethereum) {
    setStatus("No wallet found. Open in a wallet browser.");
    return;
  }

  try {
    setStatus("Connecting wallet...");

    // ✅ CONNECT FIRST (CRITICAL FIX)
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts"
    });

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = accounts[0];

    walletStatus.textContent = shorten(userAddress);
    connectBtn.textContent = "Connected";

    // ✅ SWITCH AFTER CONNECT
    try {
      await ensureMonadNetwork();
    } catch (err) {
      console.warn("Network switch skipped:", err);
    }

    setStatus("Wallet connected.");
    await loadState();

  } catch (err) {
    console.error("connectWallet error:", err);

    if (err.code === 4001) {
      setStatus("User rejected connection.");
    } else {
      setStatus(formatError(err, "Connection failed."));
    }
  }
}

// --- KEEP EVERYTHING ELSE SAME ---