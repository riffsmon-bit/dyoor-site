export default async (request) => {
  try {
    // Basic health response so the endpoint exists.
    // Your swap page can call this and we can expand it to real quote routing next.
    if (request.method === "OPTIONS") {
      return new Response("", {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    return new Response(JSON.stringify({ ok: true, msg: "quote function online" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
    });
  }
};
