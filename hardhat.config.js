import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import "dotenv/config";
import { defineConfig } from "hardhat/config";

const MONAD_RPC_URL = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
const MONAD_TESTNET_RPC_URL = process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

function normalizePrivateKey(value) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

export default defineConfig({
  plugins: [hardhatEthers, hardhatVerify],
  solidity: {
    preferWasm: true,
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  paths: {
    tests: "hardhat-tests",
  },
  networks: {
    monad: {
      type: "http",
      chainType: "l1",
      url: MONAD_RPC_URL,
      chainId: 143,
      accounts: DEPLOYER_PRIVATE_KEY ? [normalizePrivateKey(DEPLOYER_PRIVATE_KEY)] : [],
    },
    monadTestnet: {
      type: "http",
      chainType: "l1",
      url: MONAD_TESTNET_RPC_URL,
      chainId: 10143,
      accounts: DEPLOYER_PRIVATE_KEY ? [normalizePrivateKey(DEPLOYER_PRIVATE_KEY)] : [],
    },
  },
  verify: {
    blockscout: {
      enabled: false,
    },
    etherscan: {
      enabled: Boolean(ETHERSCAN_API_KEY),
      apiKey: ETHERSCAN_API_KEY,
    },
    sourcify: {
      enabled: true,
      apiUrl: "https://sourcify-api-monad.blockvision.org",
    },
  },
  chainDescriptors: {
    143: {
      name: "MonadMainnet",
      blockExplorers: {
        etherscan: {
          name: "MonadScan",
          url: "https://monadscan.com",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
  },
});
