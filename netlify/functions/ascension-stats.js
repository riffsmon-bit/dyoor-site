exports.handler = async function () {
  try {
    // 🔧 CHANGE THIS NUMBER TO YOUR REAL CURRENT ASCENDED TOTAL
    const totalStaked = 0;

    const maxSupply = 1111;
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