function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function methodNotAllowed() {
  return json(405, { ok: false, error: "Method not allowed" });
}

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch (_err) {
    return {};
  }
}

export {
  json,
  methodNotAllowed,
  parseBody,
};
