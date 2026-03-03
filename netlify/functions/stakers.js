export default async (request) => {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing Supabase env vars" }),
      { status: 500, headers }
    );
  }

  try {
    // GET = leaderboard
    if (request.method === "GET") {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/soft_stakes?select=wallet,staked_count,is_staking,updated_at&order=staked_count.desc`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE,
            authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
          },
        }
      );

      const data = await res.json();
      return new Response(JSON.stringify({ ok: true, rows: data }), {
        status: 200,
        headers,
      });
    }

    // POST = update staker
    const body = await request.json();
    const wallet = String(body.wallet || "").toLowerCase();
    const staked_count = Number(body.stakedCount || 0);

    if (!wallet.startsWith("0x")) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid wallet" }),
        { status: 400, headers }
      );
    }

    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/soft_stakes?on_conflict=wallet`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE,
          authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
          "content-type": "application/json",
          prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          wallet,
          staked_count,
          is_staking: staked_count > 0,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    const result = await upsertRes.json();

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers,
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e.message) }),
      { status: 500, headers }
    );
  }
};
