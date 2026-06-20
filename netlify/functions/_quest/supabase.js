import * as config from "./config.js";

function hasSupabase() {
  return Boolean(config.supabaseUrl && config.supabaseKey);
}

async function request(path, options = {}) {
  if (!hasSupabase()) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  const url = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: config.supabaseKey,
      authorization: `Bearer ${config.supabaseKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.message || body?.hint || `Supabase request failed: ${res.status}`;
    const err = new Error(message);
    err.statusCode = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function eq(column, value) {
  return `${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`;
}

function select(table, query = "") {
  return request(`${table}?${query}`);
}

function insert(table, rows, prefer = "return=representation") {
  return request(table, {
    method: "POST",
    headers: { prefer },
    body: JSON.stringify(rows),
  });
}

function patch(table, query, values) {
  return request(`${table}?${query}`, {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

function upsert(table, rows, onConflict) {
  const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  return request(`${table}${query}`, {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
}

export {
  hasSupabase,
  request,
  eq,
  select,
  insert,
  patch,
  upsert,
};
