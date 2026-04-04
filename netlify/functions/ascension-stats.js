const { ethers } = require("ethers");

exports.handler = async function (event) {
  try {
    const rpcUrl = "https://rpc.monad.xyz";
    const contract = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
    const maxSupply = 1111;
    const contractStartBlock = 62912794;

    // Optional: set this in Netlify env for better limits
    const MONADSCAN_API_KEY = process.env.MONADSCAN_API_KEY || "";
    const MONADSCAN_API_BASE = "https://api.monadscan.com/api";

    // stakedBalance(address)
    const STAKED_BALANCE_SELECTOR = "0x60217267";

    // PointsClaimed(address,uint256)
    const POINTS_CLAIMED_TOPIC = ethers.id("PointsClaimed(address,uint256)");

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

    async function getHarvestedForWallet(address) {
      const normalized = normalizeAddress(address);
      if (!normalized) throw new Error("Invalid address");

      const params = new URLSearchParams({
        module: "logs",
        action: "getLogs",
        fromBlock: String(contractStartBlock),
        toBlock: "latest",
        address: contract,
        topic0: POINTS_CLAIMED_TOPIC,
        topic1: "0x" + encodeAddress(normalized)
      });

      if (MONADSCAN_API_KEY) {
        params.set("apikey", MONADSCAN_API_KEY);
      }

      const res = await fetch(`${MONADSCAN_API_BASE}?${params.toString()}`, {
        headers: { accept: "application/json" }
      });

      const json = await res.json().catch(() => ({}));

      // Etherscan-style APIs usually return status/message/result.
      // Treat missing/empty result as no logs.
      if (!res.ok) {
        throw new Error(`Monadscan API failed (${res.status})`);
      }

      const result = Array.isArray(json.result) ? json.result : [];

      let harvested = 0n;
      for (const log of result) {
        if (log && typeof log.data === "string" && log.data !== "0x") {
          harvested += BigInt(log.data);
        }
      }

      return {
        harvested,
        logCount: result.length,
        apiStatus: json.status ?? null,
        apiMessage: json.message ?? null
      };
    }

    const totalStaked = await getTotalStaked();
    const percent = Number(((totalStaked / maxSupply) * 100).toFixed(2));
    const address = normalizeAddress(event?.queryStringParameters?.address || "");

    if (address) {
      const { harvested, logCount, apiStatus, apiMessage } = await getHarvestedForWallet(address);

      return {
        statusCode: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=30"
        },
        body: JSON.stringify({
          ok: true,
          address,
          totalStaked,
          maxSupply,
          percent,
          contractStartBlock,
          eventTopic: POINTS_CLAIMED_TOPIC,
          logCount,
          harvestedRaw: harvested.toString(),
          harvestedEnergy: ethers.formatEther(harvested),
          apiStatus,
          apiMessage
        })
      };
    }

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
        contractStartBlock,
        eventTopic: POINTS_CLAIMED_TOPIC
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