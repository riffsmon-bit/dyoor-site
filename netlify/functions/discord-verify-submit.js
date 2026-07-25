const { createPublicClient, http, verifyMessage, getAddress, isAddress } = require('viem');
const DEFAULT_MONAD_RPC_URL = 'https://rpc.monad.xyz';

const ERC721_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }]
  }
];

const STAKING_ABI = [
  {
    type: 'function',
    name: 'tokensOfStaker',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }]
  },
  {
    type: 'function',
    name: 'pendingPoints',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
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

async function getStakedTokens(client, wallet) {
  try {
    const tokens = await client.readContract({
      address: normalizeAddress(process.env.ASCENSION_CONTRACT_ADDRESS),
      abi: STAKING_ABI,
      functionName: 'tokensOfStaker',
      args: [wallet]
    });

    return Array.isArray(tokens) ? tokens : [];
  } catch (e) {
    throw new Error(`tokensOfStaker failed: ${e?.message || e}`);
  }
}

async function getPendingPoints(client, wallet) {
  try {
    const points = await client.readContract({
      address: normalizeAddress(process.env.ASCENSION_CONTRACT_ADDRESS),
      abi: STAKING_ABI,
      functionName: 'pendingPoints',
      args: [wallet]
    });

    return points;
  } catch (e) {
    return 0n;
  }
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
      } catch (e) {
        // ignore remove failures
      }
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
    const signature = String(body.signature || '').trim();

    if (!signature) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ ok: false, error: 'Missing signature' })
      };
    }

    const nonceEncoded = getCookie(event, 'dyoor_verify_nonce');
    if (!nonceEncoded) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ ok: false, error: 'Verification nonce missing' })
      };
    }

    const nonceRecord = JSON.parse(Buffer.from(nonceEncoded, 'base64url').toString('utf8'));

    if (Date.now() > Number(nonceRecord.expiresAt || 0)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ ok: false, error: 'Verification nonce expired' })
      };
    }

    if (normalizeAddress(nonceRecord.wallet) !== wallet) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ ok: false, error: 'Wallet does not match nonce request' })
      };
    }

    const chainId = Number(process.env.CHAIN_ID || '143');

    const message = [
      'DYOOR Verification',
      `Discord User ID: ${discordUserId}`,
      `Discord Username: ${session.username || session.globalName || 'unknown'}`,
      `Wallet: ${wallet}`,
      `Guild ID: ${process.env.DISCORD_GUILD_ID}`,
      `Nonce: ${nonceRecord.nonce}`,
      `Chain ID: ${chainId}`,
      'Purpose: Verify DYOOR holder roles'
    ].join('\n');

    const valid = await verifyMessage({
      address: wallet,
      message,
      signature
    });

    if (!valid) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ ok: false, error: 'Signature verification failed' })
      };
    }

    const client = createPublicClient({
      transport: http(process.env.RPC_URL || DEFAULT_MONAD_RPC_URL)
    });

    const walletBalance = await getWalletS1Balance(client, wallet);
    const stakedTokens = await getStakedTokens(client, wallet);
    const stakedBalance = BigInt(stakedTokens.length);
    const totalBalance = walletBalance + stakedBalance;
    const pendingPoints = await getPendingPoints(client, wallet);

    const snapshot = {
      wallet,
      walletBalance: walletBalance.toString(),
      stakedBalance: stakedBalance.toString(),
      totalBalance: totalBalance.toString(),
      stakedTokenIds: stakedTokens.map((x) => x.toString()),
      pendingPoints: pendingPoints.toString(),
      isHolder: walletBalance > 0n,
      isAscended: stakedBalance > 0n,
      isTwentyPlus: totalBalance >= 20n,
      isFiftyPlus: totalBalance >= 50n,
      updatedAt: Date.now(),
      discordUserId
    };

    await syncRoles(discordUserId, snapshot);

    const clearNonceCookie =
      'dyoor_verify_nonce=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': clearNonceCookie
      },
      multiValueHeaders: {
        'Set-Cookie': [clearNonceCookie]
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
        error: error?.message || 'discord-verify-submit failed'
      })
    };
  }
};
