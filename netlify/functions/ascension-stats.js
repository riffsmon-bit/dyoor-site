exports.handler = async function () {
  try {
    const totalStaked = 420; // TEMP TEST VALUE
    const maxSupply = 1111;

    const percent = Number(((totalStaked / maxSupply) * 100).toFixed(2));

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalStaked,
        maxSupply,
        percent
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};