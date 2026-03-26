exports.handler = async function () {
  try {
    const rpcUrl = "https://rpc.monad.xyz";
    const contract = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
    const maxSupply = 1111;

    // stakeInfo(uint256) selector from your verified contract
    const STAKE_INFO_SELECTOR = "0x4e533572";
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    function hex32(value) {
      return BigInt(value).toString(16).padStart(64, "0");
    }

    function buildStakeInfoCall(tokenId) {
      return STAKE_INFO_SELECTOR + hex32(tokenId);
    }

    function decodeOwnerFromStakeInfo(result) {
      if (!result || result === "0x") return ZERO_ADDRESS;

      const clean = result.startsWith("0x") ? result.slice(2) : result;

      // public mapping getter for struct returns:
      // owner (32 bytes) + stakedAt (32 bytes)
      if (clean.length < 64) return ZERO_ADDRESS;

      const ownerWord = clean.slice(0, 64);
      const owner = "0x" + ownerWord.slice(24).toLowerCase();

      return owner;
    }

    async function batchEthCall(tokenIds) {
      const payload = tokenIds.map((tokenId, i) => ({
        jsonrpc: "2.0",
        id: i + 1,
        method: "eth_call",
        params: [
          {
            to: contract,
            data: buildStakeInfoCall(tokenId)
          },
          "latest"
        ]
      }));

      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!Array.isArray(json)) {
        throw new Error("Unexpected RPC batch response");
      }

      return json;
    }

    let totalStaked = 0;
    const chunkSize = 100;

    for (let start = 1; start <= maxSupply; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, maxSupply);
      const tokenIds = [];

      for (let tokenId = start; tokenId <= end; tokenId++) {
        tokenIds.push(tokenId);
      }

      const results = await batchEthCall(tokenIds);

      for (const item of results) {
        if (item.error) continue;

        const owner = decodeOwnerFromStakeInfo(item.result);
        if (owner !== ZERO_ADDRESS) {
          totalStaked += 1;
        }
      }
    }

    const percent = Number(((totalStaked / maxSupply) * 100).toFixed(2));

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60"
      },
      body: JSON.stringify({
        totalStaked,
        maxSupply,
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
        error: String(err && err.message ? err.message : err)
      })
    };
  }
};