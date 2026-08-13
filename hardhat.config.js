import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { defineConfig } from "hardhat/config";
import { fileURLToPath } from "node:url";

const MONAD_RPC_URL = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
const MONAD_TESTNET_RPC_URL = process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
// Hardhat deliberately does not load .env files. Development or broadcast
// commands must inject their environment explicitly; release verification runs
// with no signing variables at all.
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const SOLC_0_8_17 = fileURLToPath(new URL("./node_modules/solc-0.8.17/soljson.js", import.meta.url));
const SOLC_0_8_28 = fileURLToPath(new URL("./node_modules/solc-0.8.28/soljson.js", import.meta.url));
const HOODYOOR_ECONOMIC_COMPILER = {
  version: "0.8.28",
  path: SOLC_0_8_28,
  settings: {
    optimizer: {
      enabled: true,
      runs: 10_000,
    },
    viaIR: true,
  },
};
const HOODYOOR_ECONOMIC_SOURCES = [
  "contracts/hoodyoor/src/economic/HoodYoorDroidRegistry.sol",
  "contracts/hoodyoor/src/economic/HoodYoorAssetRegistry.sol",
  "contracts/hoodyoor/src/economic/HoodYoorRewardsDistributor.sol",
  "contracts/hoodyoor/src/economic/HoodYoorRevenueVault.sol",
  "contracts/hoodyoor/src/economic/HoodYoorStrategyRegistry.sol",
  "contracts/hoodyoor/src/economic/HoodYoorAchievementRegistry.sol",
];

function normalizePrivateKey(value) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

export default defineConfig({
  plugins: [hardhatEthers, hardhatVerify],
  solidity: {
    preferWasm: true,
    splitTestsCompilation: true,
    compilers: [
      {
        version: "0.8.17",
        path: SOLC_0_8_17,
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
      {
        version: "0.8.28",
        path: SOLC_0_8_28,
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
    overrides: Object.fromEntries(
      HOODYOOR_ECONOMIC_SOURCES.map((sourceName) => [
        sourceName,
        HOODYOOR_ECONOMIC_COMPILER,
      ]),
    ),
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
