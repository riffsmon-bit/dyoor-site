const COOKIE_NAME = process.env.VERIFY_SESSION_COOKIE || 'dyoor_verify_session';

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

exports.handler = async function (event) {
  try {
    const session = getCookie(event, COOKIE_NAME);

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      },
      body: JSON.stringify({
        ok: true,
        backendReachable: true,
        discordConnected: !!session,
        walletLinked: false,
        roles: [],
        sessionPresent: !!session
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      },
      body: JSON.stringify({
        ok: false,
        error: error?.message || 'discord-status failed'
      })
    };
  }
};