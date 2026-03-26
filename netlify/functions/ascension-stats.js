exports.handler = async function () {
  try {
    const rpcUrl = "https://rpc.monad.xyz";
    const contract = "0xf9611226c1CcCcCa37951938d6f358D3d5106549".toLowerCase();
    const maxSupply = 1111;

    // contract creation block from MonadScan
    const START_BLOCK = 62912794;

    // event topics from your staking contract
    const stakedTopic = "0x9e71bc8eea02a63969f509818f2dafb9254532904319f9dbda79b67bd34a5f3d";
    const unstakedTopic = "0x0f5bb82176feb1b5e747e28471aa92156a04d9f3ab9f45f28e2d704232b93f75";

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

    const latestHex = await rpc("eth_blockNumber", []);
    const latest = parseInt(latestHex, 16);

    const CHUNK_SIZE = 100;
    let totalStaked = 0;

    for (let from = START_BLOCK; from <= latest; from += CHUNK_SIZE + 1) {
      const to = Math.min(from + CHUNK_SIZE, latest);

      const stakedLogs = await rpc("eth_getLogs", [{
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
        address: contract,
        topics: [stakedTopic]
      }]);

      const unstakedLogs = await rpc("eth_getLogs", [{
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
        address: contract,
        topics: [unstakedTopic]
      }]);

      // ✅ FIXED LINE (this was your bug)
      totalStaked += Array.isArray(stakedLogs) ? stakedLogs.length : 0;
      totalStaked -= Array.isArray(unstakedLogs) ? unstakedLogs.length : 0;
    }

    if (totalStaked < 0) totalStaked = 0;

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