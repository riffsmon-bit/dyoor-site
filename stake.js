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

// --- HELPERS ---
function setStatus(msg) {
  statusBox.textContent = msg;
}

function shorten(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// --- CONNECT (FINAL FIXED) ---
async function connectWallet() {
  if (!window.ethereum) {
    setStatus("No wallet found.");
    return;
  }

  try {
    setStatus("Connecting wallet...");

    // ✅ STEP 1: CONNECT FIRST
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts"
    });

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = accounts[0];

    walletStatus.textContent = shorten(userAddress);
    connectBtn.textContent = "Connected";

    // ✅ STEP 2: ENSURE CORRECT NETWORK
    let chainId = await window.ethereum.request({ method: "eth_chainId" });

    if (chainId !== CHAIN_ID_HEX) {
      setStatus("Switching network...");

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
              nativeCurrency: {
                name: "MON",
                symbol: "MON",
                decimals: 18
              }
            }]
          });
        } else {
          setStatus("⚠️ Please switch to Monad manually");
          return;
        }
      }
    }

    // ✅ STEP 3: NOW LOAD STATE
    setStatus("Loading...");
    await loadState();

    setStatus("Ready 🚀");

  } catch (err) {
    console.error(err);
    setStatus("Connection failed");
  }
}

// --- LOAD STATE (SAFE WRAP) ---
async function loadState() {
  try {
    if (!userAddress) throw new Error("No user");

    const staking = new ethers.Contract(STAKING_ADDRESS, stakingAbi, provider);

    // 🔥 load staked NFTs
    const stakedIds = await staking.tokensOfStaker(userAddress);
    stakedNfts = stakedIds.map(x => x.toString());

    console.log("staked:", stakedNfts);

    // 🔥 test call to ensure contract works
    await staking.stakedBalance(userAddress);

  } catch (err) {
    console.error("LOAD STATE ERROR:", err);
    setStatus("Failed to load wallet state.");
  }
}

// --- INIT ---
connectBtn.addEventListener("click", connectWallet);

// 🔁 reload on network change
window.ethereum?.on("chainChanged", () => window.location.reload());