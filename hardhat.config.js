import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import "dotenv/config";
import { defineConfig } from "hardhat/config";

const MONAD_RPC_URL = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

function normalizePrivateKey(value) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    monad: {
      type: "http",
      chainType: "l1",
      url: MONAD_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [normalizePrivateKey(DEPLOYER_PRIVATE_KEY)] : [],
    },
  },
});
