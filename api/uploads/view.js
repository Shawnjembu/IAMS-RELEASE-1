// GET /api/uploads/view?path=...&bucket=iams-attachments
// Role-safe redirect to a short-lived signed URL for private Supabase Storage files.
const { adminClient, send } = require("../_shared");

const DEFAULT_BUCKET = "iams-attachments";

function extractPath(value, bucket) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, "");
  try {
    const u = new URL(raw);
    const markers = [
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/authenticated/${bucket}/`,
    ];
    for (const marker of markers) {
      const idx = u.pathname.indexOf(marker);
      if (idx >= 0) return decodeURIComponent(u.pathname.slice(idx + marker.length));
    }
  } catch (_) {}
  return "";
}

async function canAccessFile(sb, profile, userId, storagePath) {
  if (!storagePath) return false;
  if (profile.role === "coordinator") return true;
  if (storagePath.startsWith(userId + "/")) return true;

  // Find which student owns the report/logbook using this file path.
  let studentId = null;
  const { data: report } = await sb
    .from("industrial_reports")
    .select("student_id")
    .eq("file_url", storagePath)
    .maybeSingle();
  if (report) studentId = report.student_id;

  if (!studentId) {
    const { data: logbook } = await sb
      .from("logbook_entries")
      .select("student_id")
      .eq("file_url", storagePath)
      .maybeSingle();
    if (logbook) studentId = logbook.student_id;
  }
  if (!studentId) return false;

  if (profile.role === "student") return studentId === userId;

  if (profile.role === "university_supervisor") {
    const { data } = await sb
      .from("supervisor_assignments")
      .select("id")
      .eq("student_id", studentId)
      .eq("university_supervisor_id", userId)
      .maybeSingle();
    return !!data;
  }

  if (profile.role === "industrial_supervisor") {
    const { data } = await sb
      .from("supervisor_assignments")
      .select("id")
      .eq("student_id", studentId)
      .eq("industrial_supervisor_id", userId)
      .maybeSingle();
    return !!data;
  }

  if (profile.role === "organization") {
    const { data } = await sb
      .from("placements")
      .select("id")
      .eq("student_id", studentId)
      .eq("org_id", userId)
      .eq("status", "assigned")
      .maybeSingle();
    return !!data;
  }

  return false;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return send(res, 405, { ok: false, error: "Method Not Allowed" });
    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    // Browser links cannot easily attach Authorization, so accept token query fallback for app-generated links.
    const url = new URL(req.url, "http://localhost");
    const token = auth || String(url.searchParams.get("token") || "").trim();
    if (!token) return send(res, 401, { ok: false, error: "Missing auth token" });

    const sb = adminClient();
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return send(res, 401, { ok: false, error: "Invalid token" });

    const { data: profile, error: pErr } = await sb
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();
    if (pErr) return send(res, 500, { ok: false, error: pErr.message });
    if (!profile) return send(res, 403, { ok: false, error: "Profile not found" });

    const bucket = String(url.searchParams.get("bucket") || DEFAULT_BUCKET);
    const storagePath = extractPath(url.searchParams.get("path"), bucket);
    if (!storagePath) return send(res, 400, { ok: false, error: "Missing file path" });

    const allowed = await canAccessFile(sb, profile, user.id, storagePath);
    if (!allowed) return send(res, 403, { ok: false, error: "You are not allowed to view this file." });

    const { data, error } = await sb.storage.from(bucket).createSignedUrl(storagePath, 60 * 10);
    if (error) return send(res, 500, { ok: false, error: error.message });
    res.statusCode = 302;
    res.setHeader("Location", data.signedUrl);
    res.end();
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
