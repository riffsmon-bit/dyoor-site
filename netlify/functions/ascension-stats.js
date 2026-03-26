const { ethers } = require("ethers");

const RPC_URL = "https://rpc.monad.xyz";
const STAKING_ADDRESS = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const MAX_SUPPLY = 1111;

const ABI = [
  "event Staked(address indexed user, uint256 indexed tokenId)",
  "event Unstaked(address indexed user, uint256 indexed tokenId)"
];

exports.handler = async function () {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(STAKING_ADDRESS, ABI, provider);

    const latestBlock = await provider.getBlockNumber();
    const chunkSize = 5000;

    let totalStaked = 0;

    for (let fromBlock = 0; fromBlock <= latestBlock; fromBlock += chunkSize + 1) {
      const toBlock = Math.min(fromBlock + chunkSize, latestBlock);

      const stakedLogs = await contract.queryFilter(
        contract.filters.Staked(),
        fromBlock,
        toBlock
      );

      const unstakedLogs = await contract.queryFilter(
        contract.filters.Unstaked(),
        fromBlock,
        toBlock
      );

      totalStaked += stakedLogs.length;
      totalStaked -= unstakedLogs.length;
    }

    if (totalStaked < 0) totalStaked = 0;

    const percent = Number(((totalStaked / MAX_SUPPLY) * 100).toFixed(2));

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60"
      },
      body: JSON.stringify({
        totalStaked,
        maxSupply: MAX_SUPPLY,
        percent
      })
    };
  } catch (err) {
    console.error("ascension-stats error:", err);

    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        error: "Failed to load ascension stats"
      })
    };
  }
};