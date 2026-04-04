const { createPublicClient, http, getAddress, isAddress } = require('viem');

const ERC721_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }]
  }
];

function normalizeAddress(address) {
  if (!isAddress(address)) throw new Error('Invalid wallet address');
  return getAddress(address);
}

function getCookie(event, name) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  const parts = raw.split(';').map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return '';
}

async function discordRequest(path, options = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text}`);
  }

  if (res.status === 204) return null;
  return await res.json();
}

async function addRole(guildId, userId, roleId) {
  return discordRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: 'PUT'
  });
}

async function removeRole(guildId, userId, roleId) {
  return discordRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: 'DELETE'
  });
}

async function getWalletS1Balance(client, wallet) {
  return await client.readContract({
    address: normalizeAddress(process.env.S1_COLLECTION_ADDRESS),
    abi: ERC721_ABI,
    functionName: 'balanceOf',
    args: [wallet]
  });
}

async function getTransferLogs(client, fromBlock, toBlock, fromAddress, toAddress) {
  return await client.getLogs({
    address: normalizeAddress(process.env.S1_COLLECTION_ADDRESS),
    event: {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { type: 'address', name: 'from', indexed: true },
        { type: 'address', name: 'to', indexed: true },
        { type: 'uint256', name: 'tokenId', indexed: true }
      ]
    },
    args: {
      from: fromAddress ? normalizeAddress(fromAddress) : undefined,
      to: toAddress ? normalizeAddress(toAddress) : undefined
    },
    fromBlock,
    toBlock
  });
}

async function getCurrentStakedCountFast(client, wallet) {
  const staking = normalizeAddress(process.env.ASCENSION_CONTRACT_ADDRESS);
  const latestBlock = await client.getBlockNumber();
  const startBlock = BigInt(process.env.SCAN_FROM_BLOCK || '0');
  const chunkSize = 99n;
  const maxChunks = 80;

  let current = 0n;
  let chunks = 0;

  for (let start = startBlock; start <= latestBlock; start += chunkSize + 1n) {
    const end = start + chunkSize > latestBlock ? latestBlock : start + chunkSize;

    const deposits = await getTransferLogs(client, start, end, wallet, staking);
    const withdrawals = await getTransferLogs(client, start, end, staking, wallet);

    current += BigInt(deposits.length);
    current -= BigInt(withdrawals.length);

    chunks++;
    if (chunks >= maxChunks) {
      throw new Error(
        `Stake scan exceeded safe limit. Move SCAN_FROM_BLOCK forward. Current start: ${startBlock.toString()}`
      );
    }
  }

  return current < 0n ? 0n : current;
}

async function syncRoles(discordUserId, snapshot) {
  const guildId = process.env.DISCORD_GUILD_ID;

  const roleMap = [
    [process.env.HOLDER_ROLE_ID, snapshot.isHolder],
    [process.env.ASCENDED_ROLE_ID, snapshot.isAscended],
    [process.env.TWENTY_PLUS_ROLE_ID, snapshot.isTwentyPlus],
    [process.env.FIFTY_PLUS_ROLE_ID, snapshot.isFiftyPlus]
  ];

  for (const [roleId, shouldHave] of roleMap) {
    if (!roleId) continue;
    if (shouldHave) {
      await addRole(guildId, discordUserId, roleId);
    } else {
      try {
        await removeRole(guildId, discordUserId, roleId);
      } catch (e) {}
    }
  }
}

exports.handler = async function (event) {
  try {
    const sessionCookieName = process.env.VERIFY_SESSION_COOKIE || 'dyoor_verify_session';
    const sessionEncoded = getCookie(event, sessionCookieName);

    if (!sessionEncoded) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ ok: false, error: 'Discord session missing' })
      };
    }

    const session = JSON.parse(Buffer.from(sessionEncoded, 'base64url').toString('utf8'));
    const discordUserId = session?.discordUserId;

    if (!discordUserId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ ok: false, error: 'Invalid Discord session' })
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const wallet = normalizeAddress(String(body.wallet || '').trim());

    const client = createPublicClient({
      transport: http(process.env.RPC_URL)
    });

    const walletBalance = await getWalletS1Balance(client, wallet);

    let stakedBalance = 0n;
    let stakedScanWarning = '';

    try {
      stakedBalance = await getCurrentStakedCountFast(client, wallet);
    } catch (e) {
      stakedScanWarning = e?.message || 'Staked scan timed out';
    }

    const totalBalance = walletBalance + stakedBalance;

    const snapshot = {
      wallet,
      walletBalance: walletBalance.toString(),
      stakedBalance: stakedBalance.toString(),
      totalBalance: totalBalance.toString(),
      isHolder: walletBalance > 0n,
      isAscended: stakedBalance > 0n,
      isTwentyPlus: totalBalance >= 20n,
      isFiftyPlus: totalBalance >= 50n,
      updatedAt: Date.now(),
      discordUserId,
      stakedScanWarning
    };

    await syncRoles(discordUserId, snapshot);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        ok: true,
        snapshot
      })
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        ok: false,
        error: error?.message || 'discord-refresh failed'
      })
    };
  }
};