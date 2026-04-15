const { createClient } = require("@supabase/supabase-js");

function getEnv(name) {
  return process.env[name] || "";
}

function getSupabaseAdmin() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in Vercel Environment Variables.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  // vercel dev (and some middleware) pre-parses the body onto req.body,
  // consuming the stream before we can read chunks — check that first.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object") return req.body;
    if (typeof req.body === "string") {
      const s = req.body.trim();
      if (!s) return {};
      try { return JSON.parse(s); } catch { return {}; }
    }
  }
  // Fallback: read raw stream (production Vercel runtime)
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Verify a Bearer token using the user-scoped Supabase client.
 * More reliable than adminClient().auth.getUser(token) with new-format publishable keys.
 * Returns the authenticated user object or throws an error.
 */
async function verifyToken(token) {
  const url  = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  const userSb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data, error } = await userSb.auth.getUser();
  if (error || !data || !data.user) throw new Error(error ? error.message : "Invalid token");
  return data.user;
}

module.exports = {
  getSupabaseAdmin,
  sendJson,
  readJson,
  verifyToken,
  adminClient: getSupabaseAdmin,
  send: sendJson,
  readBody: readJson,
};