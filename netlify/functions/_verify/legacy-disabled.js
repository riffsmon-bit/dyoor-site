const legacyDisabledResponse = () => ({
  statusCode: 410,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  },
  body: JSON.stringify({
    ok: false,
    error: 'This legacy Discord verification route is disabled. Start wallet verification from the official DYØØR Discord bot.'
  })
});

export const legacyDisabledHandler = async () => legacyDisabledResponse();
