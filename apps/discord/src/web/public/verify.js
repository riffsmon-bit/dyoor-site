const CHAIN_ID = 143;
const CHAIN_HEX = "0x8f";

const statusElement = document.querySelector("#status");
const walletElement = document.querySelector("#wallet");
const connectButton = document.querySelector("#connect");
const verifyButton = document.querySelector("#verify");
const cancelButton = document.querySelector("#cancel");
let walletAddress = null;

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.borderColor = isError ? "#d66b5d" : "#00c805";
}

async function jsonRequest(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

async function ensureChain() {
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (Number.parseInt(current, 16) === CHAIN_ID) return;
  setStatus("Wrong network. Switch to Monad Mainnet.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_HEX }],
    });
  } catch (error) {
    if (error && error.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_HEX,
            chainName: "Monad Mainnet",
            nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
            rpcUrls: ["https://rpc.monad.xyz"],
            blockExplorerUrls: ["https://monadscan.com"],
          },
        ],
      });
      return;
    }
    throw error;
  }
}

connectButton.addEventListener("click", async () => {
  if (!window.ethereum) {
    setStatus("No compatible EVM wallet was detected in this browser.", true);
    return;
  }
  try {
    connectButton.disabled = true;
    await ensureChain();
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    walletAddress = accounts[0] || null;
    if (!walletAddress) throw new Error("No wallet account was selected.");
    walletElement.hidden = false;
    walletElement.textContent = `${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)}`;
    verifyButton.disabled = false;
    setStatus("Wallet connected. Ready for one gas-free authentication signature.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Wallet connection was cancelled.", true);
    connectButton.disabled = false;
  }
});

verifyButton.addEventListener("click", async () => {
  if (!walletAddress) return;
  try {
    verifyButton.disabled = true;
    await ensureChain();
    setStatus("Preparing a short-lived DYØØR authentication message…");
    const prepared = await jsonRequest("/api/verification/prepare", {
      walletAddress,
      chainId: CHAIN_ID,
    });
    const signature = await window.ethereum.request({
      method: "personal_sign",
      params: [prepared.message, walletAddress],
    });
    setStatus("Validating the signature and checking every configured holder source…");
    const result = await jsonRequest("/api/verification/complete", { signature });
    setStatus(result.message);
    connectButton.disabled = true;
    verifyButton.disabled = true;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Verification failed.", true);
    verifyButton.disabled = false;
  }
});

cancelButton.addEventListener("click", async () => {
  try {
    await jsonRequest("/api/verification/cancel", {});
  } catch {
    // Cancellation is intentionally idempotent.
  }
  setStatus("Verification cancelled. You may close this window.");
  connectButton.disabled = true;
  verifyButton.disabled = true;
  cancelButton.disabled = true;
});

window.addEventListener(
  "ethereum#initialized",
  () => setStatus("Wallet detected. Ready when you are."),
  { once: true },
);
