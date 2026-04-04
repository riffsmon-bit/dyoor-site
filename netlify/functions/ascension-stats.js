const { ethers } = require("ethers");

exports.handler = async function (event) {
  try {
    const rpcUrl = "https://rpc.monad.xyz";
    const contract = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
    const maxSupply = 1111;

    // stakedBalance(address)
    const STAKED_BALANCE_SELECTOR = "0x60217267";

    // candidate event topics
    const POINTS_CLAIMED_TOPIC = ethers.id("PointsClaimed(address,uint256)");
    const CLAIMED_TOPIC = ethers.id("Claimed(address,uint256)");
    const REWARDS_CLAIMED_TOPIC = ethers.id("RewardsClaimed(address,uint256)");
    const ENERGY_CLAIMED_TOPIC = ethers.id("EnergyClaimed(address,uint256)");

    const stakers = [
      "0x245E3D068bCD5dD059bB8c23cCa1Af6d2877a3bE",
      "0x48477b50818b75f4b4a5c86d5fcbb35d3c0fb14d",
      "0x49b9e94f9841da5df27cb44ede19d963b8ff6e78",
      "0x7179af9dbe43f1dbfed8733b83260ecac18515c4",
      "0x447d3809ab984e75431854432f9d7b9325112e07",
      "0xa26f5dc12bae4b0a8a684526a3beb77f34f99426",
      "0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6"
    ];

    function normalizeAddress(address) {
      if (typeof address !== "string") return null;
      const trimmed = address.trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
      return ethers.getAddress(trimmed);
    }

    function encodeAddress(address) {
      return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    }

    function toHexBlock(blockNumber) {
      return "0x" + blockNumber.toString(16);
    }

    async function rpc(method, params) {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params
        })
      });

      const json = await res.json();
      if (json.error) throw new Error(json.error.message || "RPC error");
      return json.result;
    }

    async function ethCall(data) {
      return rpc("eth_call", [{ to: contract, data }, "latest"]);
    }

    async function getLogs(params) {
      return rpc("eth_getLogs", [params]);
    }

    async function getLatestBlockNumber() {
      const hex = await rpc("eth_blockNumber", []);
      return parseInt(hex, 16);
    }

    async function getTotalStaked() {
      let totalStaked = 0;

      for (const wallet of stakers) {
        const data = STAKED_BALANCE_SELECTOR + encodeAddress(wallet);
        const result = await ethCall(data);
        const value = result && result !== "0x" ? parseInt(result, 16) : 0;
        totalStaked += Number.isFinite(value) ? value : 0;
      }

      return totalStaked;
    }

    function parseAmountFromLog(log) {
      try {
        if (log?.data && log.data !== "0x") {
          return BigInt(log.data);
        }

        if (Array.isArray(log?.topics) && log.topics.length > 2 && log.topics[2] && log.topics[2] !== "0x") {
          return BigInt(log.topics[2]);
        }

        return 0n;
      } catch {
        return 0n;
      }
    }

    async function scanTopicForWallet(topic0, address) {
      const latestBlock = await getLatestBlockNumber();
      const chunkSize = 25000;
      const userTopic = "0x" + encodeAddress(address);

      let harvested = 0n;
      let logCount = 0;
      const sample = [];

      for (let fromBlock = 0; fromBlock <= latestBlock; fromBlock += chunkSize) {
        const toBlock = Math.min(fromBlock + chunkSize - 1, latestBlock);

        const logs = await getLogs({
          address: contract,
          fromBlock: toHexBlock(fromBlock),
          toBlock: toHexBlock(toBlock),
          topics: [topic0, userTopic]
        });

        logCount += logs.length;

        for (const log of logs) {
          const amount = parseAmountFromLog(log);
          harvested += amount;

          if (sample.length < 5) {
            sample.push({
              blockNumber: parseInt(log.blockNumber, 16),
              txHash: log.transactionHash,
              topic0: log.topics?.[0] || null,
              topic1: log.topics?.[1] || null,
              topic2: log.topics?.[2] || null,
              data: log.data,
              parsedAmount: amount.toString()
            });
          }
        }
      }

      return {
        harvested,
        logCount,
        sample
      };
    }

    const totalStaked = await getTotalStaked();
    const percent = Number(((totalStaked / maxSupply) * 100).toFixed(2));
    const address = normalizeAddress(event?.queryStringParameters?.address || "");

    if (!address) {
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=60"
        },
        body: JSON.stringify({
          ok: true,
          totalStaked,
          maxSupply,
          percent,
          topics: {
            POINTS_CLAIMED_TOPIC,
            CLAIMED_TOPIC,
            REWARDS_CLAIMED_TOPIC,
            ENERGY_CLAIMED_TOPIC
          }
        })
      };
    }

    const scans = {
      pointsClaimed: await scanTopicForWallet(POINTS_CLAIMED_TOPIC, address),
      claimed: await scanTopicForWallet(CLAIMED_TOPIC, address),
      rewardsClaimed: await scanTopicForWallet(REWARDS_CLAIMED_TOPIC, address),
      energyClaimed: await scanTopicForWallet(ENERGY_CLAIMED_TOPIC, address)
    };

    let best = scans.pointsClaimed;
    for (const value of Object.values(scans)) {
      if (value.harvested > best.harvested) best = value;
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=15"
      },
      body: JSON.stringify({
        ok: true,
        address,
        totalStaked,
        maxSupply,
        percent,
        harvestedRaw: best.harvested.toString(),
        harvestedEnergy: ethers.formatEther(best.harvested),
        scans: {
          pointsClaimed: {
            topic: POINTS_CLAIMED_TOPIC,
            logCount: scans.pointsClaimed.logCount,
            harvestedRaw: scans.pointsClaimed.harvested.toString(),
            harvestedEnergy: ethers.formatEther(scans.pointsClaimed.harvested),
            sample: scans.pointsClaimed.sample
          },
          claimed: {
            topic: CLAIMED_TOPIC,
            logCount: scans.claimed.logCount,
            harvestedRaw: scans.claimed.harvested.toString(),
            harvestedEnergy: ethers.formatEther(scans.claimed.harvested),
            sample: scans.claimed.sample
          },
          rewardsClaimed: {
            topic: REWARDS_CLAIMED_TOPIC,
            logCount: scans.rewardsClaimed.logCount,
            harvestedRaw: scans.rewardsClaimed.harvested.toString(),
            harvestedEnergy: ethers.formatEther(scans.rewardsClaimed.harvested),
            sample: scans.rewardsClaimed.sample
          },
          energyClaimed: {
            topic: ENERGY_CLAIMED_TOPIC,
            logCount: scans.energyClaimed.logCount,
            harvestedRaw: scans.energyClaimed.harvested.toString(),
            harvestedEnergy: ethers.formatEther(scans.energyClaimed.harvested),
            sample: scans.energyClaimed.sample
          }
        }
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
        ok: false,
        error: String(err && err.message ? err.message : err)
      })
    };
  }
};