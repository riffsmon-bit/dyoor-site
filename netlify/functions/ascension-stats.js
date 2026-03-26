exports.handler = async function () {
  try {
    const rpcUrl = "https://rpc.monad.xyz";
    const contract = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
    const maxSupply = 1111;

    // stakedBalance(address) selector
    const STAKED_BALANCE_SELECTOR = "0x60217267";

    // wallets seen staking into this contract
    const stakers = [
      "0x245E3D068bCD5dD059bB8c23cCa1Af6d2877a3bE",
      "0x48477b50818b75f4b4a5c86d5fcbb35d3c0fb14d",
      "0x49b9e94f9841da5df27cb44ede19d963b8ff6e78",
      "0x7179af9dbe43f1dbfed8733b83260ecac18515c4",
      "0x447d3809ab984e75431854432f9d7b9325112e07",
      "0xa26f5dc12bae4b0a8a684526a3beb77f34f99426",
      "0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6"
    ];

    function encodeAddress(address) {
      return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    }

    async function ethCall(data) {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            {
              to: contract,
              data
            },
            "latest"
          ]
        })
      });

      const json = await res.json();
      if (json.error) throw new Error(json.error.message || "RPC error");
      return json.result;
    }

    let totalStaked = 0;

    for (const wallet of stakers) {
      const data = STAKED_BALANCE_SELECTOR + encodeAddress(wallet);
      const result = await ethCall(data);

      const value = result && result !== "0x" ? parseInt(result, 16) : 0;
      totalStaked += Number.isFinite(value) ? value : 0;
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