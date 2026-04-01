const { createPublicClient, http, getAddress, isAddress } = require('viem');
const config = require('./config');

const ERC721_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
];

const client = createPublicClient({
  transport: http(config.rpcUrl),
});

function normalizeAddress(address) {
  if (!isAddress(address)) throw new Error('Invalid wallet address.');
  return getAddress(address);
}

async function getWalletS1Balance(walletAddress) {
  return client.readContract({
    address: normalizeAddress(config.s1CollectionAddress),
    abi: ERC721_ABI,
    functionName: 'balanceOf',
    args: [normalizeAddress(walletAddress)],
  });
}

async function getTransferLogs({ fromBlock, toBlock, fromAddress, toAddress }) {
  return client.getLogs({
    address: normalizeAddress(config.s1CollectionAddress),
    event: {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { type: 'address', name: 'from', indexed: true },
        { type: 'address', name: 'to', indexed: true },
        { type: 'uint256', name: 'tokenId', indexed: true },
      ],
    },
    args: {
      from: fromAddress ? normalizeAddress(fromAddress) : undefined,
      to: toAddress ? normalizeAddress(toAddress) : undefined,
    },
    fromBlock,
    toBlock,
  });
}

async function getCurrentStakedCount(walletAddress) {
  const wallet = normalizeAddress(walletAddress);
  const staking = normalizeAddress(config.ascensionContractAddress);
  const latestBlock = await client.getBlockNumber();
  const chunkSize = 50000n;
  let current = 0n;

  for (let start = config.scanFromBlock; start <= latestBlock; start += chunkSize + 1n) {
    const end = start + chunkSize > latestBlock ? latestBlock : start + chunkSize;

    const [deposits, withdrawals] = await Promise.all([
      getTransferLogs({ fromBlock: start, toBlock: end, fromAddress: wallet, toAddress: staking }),
      getTransferLogs({ fromBlock: start, toBlock: end, fromAddress: staking, toAddress: wallet }),
    ]);

    current += BigInt(deposits.length);
    current -= BigInt(withdrawals.length);
  }

  return current < 0n ? 0n : current;
}

async function getVerificationSnapshot(walletAddress) {
  const walletBalance = await getWalletS1Balance(walletAddress);
  const stakedBalance = await getCurrentStakedCount(walletAddress);
  const totalBalance = walletBalance + stakedBalance;

  return {
    wallet: normalizeAddress(walletAddress),
    walletBalance: walletBalance.toString(),
    stakedBalance: stakedBalance.toString(),
    totalBalance: totalBalance.toString(),
    isHolder: walletBalance > 0n,
    isAscended: stakedBalance > 0n,
    isTwentyPlus: totalBalance >= 20n,
    isFiftyPlus: totalBalance >= 50n,
  };
}

async function verifyWalletSignature({ address, message, signature }) {
  return client.verifyMessage({
    address: normalizeAddress(address),
    message,
    signature,
  });
}

module.exports = {
  normalizeAddress,
  getVerificationSnapshot,
  verifyWalletSignature,
};
