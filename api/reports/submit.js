// POST /api/reports/submit
// Student submits (or updates) their final industrial attachment report.
// Body: { title, content?, file_url? }
//
// GET /api/reports/submit  — student fetches their own report
// GET /api/reports/submit?student_id=  — supervisor/coordinator fetches a student's report
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey    = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !anonKey) return send(res, 500, { ok: false, error: "Missing env vars" });
    const userSb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${auth}` } } });
    const { data: authData, error: uerr } = await userSb.auth.getUser();
    if (uerr || !authData || !authData.user) return send(res, 401, { ok: false, error: uerr ? uerr.message : "Invalid token" });
    const user = authData.user;

    const sb = adminClient();
    const { data: profile } = await sb
      .from("profiles").select("role").eq("id", user.id).single();
    if (!profile) return send(res, 403, { ok: false, error: "Profile not found" });

    // ---- GET ----
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const reqStudentId = url.searchParams.get("student_id") || user.id;

      // Students can only see their own
      if (profile.role === "student" && reqStudentId !== user.id)
        return send(res, 403, { ok: false, error: "Access denied" });

      const { data, error } = await sb
        .from("industrial_reports")
        .select("*")
        .eq("student_id", reqStudentId)
        .maybeSingle();

      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true, report: data });
    }

    // ---- POST ----
    if (req.method === "POST") {
      if (profile.role !== "student")
        return send(res, 403, { ok: false, error: "Only students can submit reports" });

      const body    = await readBody(req);
      const title   = String(body.title   || "").trim();
      const content = String(body.content || "").trim() || null;
      const file_url = body.file_url || null;

      if (!title) return send(res, 400, { ok: false, error: "title is required" });

      // Prevent re-submission once the report has been graded
      const { data: existing } = await sb
        .from("industrial_reports")
        .select("status")
        .eq("student_id", user.id)
        .maybeSingle();
      if (existing && existing.status === "graded")
        return send(res, 409, { ok: false, error: "Your report has already been graded and cannot be resubmitted." });

      // Find placement
      const { data: placement } = await sb
        .from("placements")
        .select("id")
        .eq("student_id", user.id)
        .eq("status", "assigned")
        .maybeSingle();

      const { data, error } = await sb
        .from("industrial_reports")
        .upsert([{
          student_id:   user.id,
          placement_id: placement ? placement.id : null,
          title,
          content,
          file_url,
          status:       "submitted",
          submitted_at: new Date().toISOString(),
        }], { onConflict: "student_id" })
        .select("*")
        .single();

      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true, report: data });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
