exports.handler = async function () {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      ok: true,
      totalStaked: 45,
      maxSupply: 1111,
      percent: 4.05
    })
  };
};