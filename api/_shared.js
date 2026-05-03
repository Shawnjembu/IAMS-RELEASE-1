const { createClient } = require("@supabase/supabase-js");

function getEnv(name) {
  return process.env[name] || "";
}

function getSupabaseAdmin() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in the local .env file.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object") return req.body;
    if (typeof req.body === "string") {
      const s = req.body.trim();
      if (!s) return {};
      try { return JSON.parse(s); } catch { return {}; }
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

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

async function getAuthedContext(req) {
  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) {
    const err = new Error("Missing auth token");
    err.status = 401;
    throw err;
  }
  const user = await verifyToken(auth);
  const sb = getSupabaseAdmin();
  const { data: profile, error } = await sb
    .from("profiles")
    .select("id, role, full_name, email, avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    const err = new Error(error.message);
    err.status = 500;
    throw err;
  }
  if (!profile) {
    const err = new Error("Profile not found");
    err.status = 403;
    throw err;
  }
  return { token: auth, user, profile, sb };
}

function requireRole(profile, allowed) {
  const roles = Array.isArray(allowed) ? allowed : [allowed];
  if (!roles.includes(profile.role)) {
    const err = new Error("Access denied for this role");
    err.status = 403;
    throw err;
  }
}

// Simple in-memory rate limiter for local/demo deployment. In real hosting, move
// this to Redis, a reverse proxy, or Supabase Edge middleware.
const RATE_BUCKETS = new Map();
function getClientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim();
}
function rateLimit(req, res, key, limit, windowMs) {
  const now = Date.now();
  const bucketKey = `${key}:${getClientIp(req)}`;
  const current = RATE_BUCKETS.get(bucketKey) || { count: 0, resetAt: now + windowMs };
  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + windowMs;
  }
  current.count += 1;
  RATE_BUCKETS.set(bucketKey, current);
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - current.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));
  if (current.count > limit) {
    sendJson(res, 429, { ok: false, error: "Too many requests. Please wait and try again." });
    return false;
  }
  return true;
}

function normaliseRole(role) {
  return String(role || "").trim().toLowerCase();
}

module.exports = {
  getSupabaseAdmin,
  sendJson,
  readJson,
  verifyToken,
  getAuthedContext,
  requireRole,
  rateLimit,
  normaliseRole,
  adminClient: getSupabaseAdmin,
  send: sendJson,
  readBody: readJson,
};
