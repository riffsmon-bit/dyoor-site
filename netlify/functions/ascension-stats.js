const { ethers } = require("ethers");

const RPC = "https://rpc.monad.xyz";
const CONTRACT = "0xD24cd2aE86381B8a7E38bd1E0E6822620d930aB1"; // your staking contract

const ABI = [
  "event Staked(address indexed user, uint256 indexed tokenId)",
  "event Unstaked(address indexed user, uint256 indexed tokenId)"
];

exports.handler = async function () {
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const contract = new ethers.Contract(CONTRACT, ABI, provider);

    const staked = await contract.queryFilter("Staked");
    const unstaked = await contract.queryFilter("Unstaked");

    const active = new Set();

    for (const e of staked) {
      active.add(e.args.tokenId.toString());
    }

    for (const e of unstaked) {
      active.delete(e.args.tokenId.toString());
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalStaked: active.size
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};