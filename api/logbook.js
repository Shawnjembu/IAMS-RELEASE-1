// GET  /api/logbook        — student fetches their own entries
// POST /api/logbook        — student submits a new entry
// PATCH /api/logbook?id=   — supervisor marks an entry as reviewed
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody } = require("./_shared");

const DEFAULT_BUCKET = "iams-attachments";
function extractStoragePath(value, bucket = DEFAULT_BUCKET) {
  if (!value) return null;
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, "");
  try {
    const u = new URL(raw);
    const markers = [`/storage/v1/object/sign/${bucket}/`, `/storage/v1/object/public/${bucket}/`, `/storage/v1/object/authenticated/${bucket}/`];
    for (const marker of markers) {
      const idx = u.pathname.indexOf(marker);
      if (idx >= 0) return decodeURIComponent(u.pathname.slice(idx + marker.length));
    }
  } catch (_) {}
  return null;
}
async function addSignedEntryUrls(sb, entries) {
  for (const e of (entries || [])) {
    if (!e.file_url) continue;
    const path = extractStoragePath(e.file_url);
    if (!path) continue;
    const { data, error } = await sb.storage.from(DEFAULT_BUCKET).createSignedUrl(path, 60 * 10);
    if (!error && data && data.signedUrl) {
      e.file_storage_path = path;
      e.file_url = data.signedUrl;
    }
  }
  return entries;
}


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
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (!profile) return send(res, 403, { ok: false, error: "Profile not found" });

    // ---- GET: list entries ----
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const filterStudentId = url.searchParams.get("student_id");

      // Try selecting v2 columns (file_url, supervisor_comments, reviewed_at); fall back to base columns
      const fullCols   = "id, student_id, week_number, activities, learning_outcomes, challenges, status, file_url, supervisor_comments, submitted_at, reviewed_at";
      const baseCols   = "id, student_id, week_number, activities, learning_outcomes, challenges, status, submitted_at";
      let query = sb
        .from("logbook_entries")
        .select(fullCols)
        .order("week_number", { ascending: true });

      if (profile.role === "student") {
        query = query.eq("student_id", user.id);
      } else if (profile.role === "organization") {
        // Org sees entries for their assigned students (optionally filtered to one student)
        const { data: placements } = await sb
          .from("placements")
          .select("student_id")
          .eq("org_id", user.id)
          .eq("status", "assigned");
        const ids = (placements || []).map(p => p.student_id);
        if (ids.length === 0) return send(res, 200, { ok: true, entries: [] });
        if (filterStudentId && ids.includes(filterStudentId)) {
          query = query.eq("student_id", filterStudentId);
        } else if (filterStudentId) {
          // Requested student not assigned to this org
          return send(res, 403, { ok: false, error: "Student not assigned to your organisation" });
        } else {
          query = query.in("student_id", ids);
        }
      } else if (profile.role === "university_supervisor") {
        // University supervisor views/reviews logbooks for assigned students only.
        const { data: assignments } = await sb
          .from("supervisor_assignments")
          .select("student_id")
          .eq("university_supervisor_id", user.id);
        const ids = (assignments || []).map(a => a.student_id);
        if (ids.length === 0) return send(res, 200, { ok: true, entries: [] });
        if (filterStudentId && ids.includes(filterStudentId)) {
          query = query.eq("student_id", filterStudentId);
        } else if (filterStudentId) {
          return send(res, 403, { ok: false, error: "Student is not assigned to you as university supervisor" });
        } else {
          query = query.in("student_id", ids);
        }
      } else if (profile.role === "industrial_supervisor") {
        // Industrial supervisors handle workplace support and messaging. Logbook/report review is done by the university supervisor.
        return send(res, 200, { ok: true, entries: [] });
      } else {
        // Coordinator monitors all; optionally filter by student. Coordinator does not mark reviews.
        if (filterStudentId) query = query.eq("student_id", filterStudentId);
      }

      let { data, error } = await query;
      // If v2 columns don't exist yet, fall back to base column set
      if (error && error.message && error.message.includes("does not exist")) {
        const fallback = await sb
          .from("logbook_entries")
          .select(baseCols)
          .order("week_number", { ascending: true });
        if (fallback.error) return send(res, 500, { ok: false, error: fallback.error.message });
        data = fallback.data;
        error = null;
      }
      if (error) return send(res, 500, { ok: false, error: error.message });
      await addSignedEntryUrls(sb, data);

      // If viewing a specific student, include their name/email in response
      let studentMeta = {};
      if (filterStudentId && profile.role !== "student") {
        const { data: sp } = await sb
          .from("profiles")
          .select("full_name, email")
          .eq("id", filterStudentId)
          .maybeSingle();
        if (sp) {
          studentMeta.student_name  = sp.full_name || null;
          studentMeta.student_email = sp.email     || null;
        }
      }
      return send(res, 200, { ok: true, entries: data || [], ...studentMeta });
    }

    // ---- POST: submit a new entry (students only) ----
    if (req.method === "POST") {
      if (profile.role !== "student") {
        return send(res, 403, { ok: false, error: "Only students can submit logbook entries" });
      }

      const body         = await readBody(req);
      const week_number  = parseInt(body.week_number, 10) || null;
      const activities   = String(body.activities        || "").trim();
      const learning_outcomes = String(body.learning_outcomes || "").trim();
      const challenges   = String(body.challenges        || "").trim();
      const file_url     = extractStoragePath(body.file_url) || body.file_url || null;

      if (!week_number || week_number < 1 || week_number > 12) {
        return send(res, 400, { ok: false, error: "Please select a valid attachment week between 1 and 12." });
      }
      if (!activities || activities.length < 10) {
        return send(res, 400, { ok: false, error: "Activities are required and must clearly describe the work done." });
      }

      // Final release rule: only students already placed in an organisation can submit logbooks.
      const { data: placement, error: placementErr } = await sb
        .from("placements")
        .select("id")
        .eq("student_id", user.id)
        .eq("status", "assigned")
        .maybeSingle();
      if (placementErr) return send(res, 500, { ok: false, error: placementErr.message });
      if (!placement) {
        return send(res, 403, { ok: false, error: "You must be assigned to an organisation before submitting logbook entries." });
      }

      // Clear duplicate-week error before database insert so the user gets a friendly message.
      const { data: duplicate } = await sb
        .from("logbook_entries")
        .select("id")
        .eq("student_id", user.id)
        .eq("week_number", week_number)
        .maybeSingle();
      if (duplicate) {
        return send(res, 409, { ok: false, error: "Week " + week_number + " has already been submitted. Each week can only be submitted once." });
      }

      const { data, error } = await sb
        .from("logbook_entries")
        .insert([{
          student_id: user.id,
          week_number,
          activities,
          learning_outcomes: learning_outcomes || null,
          challenges: challenges || null,
          file_url,
          status: "submitted",
          submitted_at: new Date().toISOString()
        }])
        .select("*")
        .single();

      if (error) {
        const msg = String(error.message || "");
        if (msg.toLowerCase().includes("duplicate") || error.code === "23505") {
          return send(res, 409, { ok: false, error: "This week has already been submitted. Choose another week." });
        }
        return send(res, 500, { ok: false, error: error.message });
      }
      return send(res, 200, { ok: true, entry: data });
    }

    // ---- PATCH: mark reviewed + add supervisor comments ----
    if (req.method === "PATCH") {
      if (profile.role !== "university_supervisor") {
        return send(res, 403, { ok: false, error: "Only the assigned university supervisor can review logbook entries." });
      }
      const url2 = new URL(req.url, "http://localhost");
      const id   = url2.searchParams.get("id");
      if (!id) return send(res, 400, { ok: false, error: "id query param required" });

      const body = await readBody(req);
      const supervisor_comments = body.supervisor_comments !== undefined
        ? String(body.supervisor_comments || "").trim() || null
        : undefined;

      const updates = {
        status:      "reviewed",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      };
      if (supervisor_comments !== undefined) updates.supervisor_comments = supervisor_comments;

      const { data: entryCheck, error: entryErr } = await sb
        .from("logbook_entries")
        .select("id, student_id")
        .eq("id", id)
        .maybeSingle();
      if (entryErr) return send(res, 500, { ok: false, error: entryErr.message });
      if (!entryCheck) return send(res, 404, { ok: false, error: "Logbook entry not found" });

      const { data: assignedUni } = await sb
        .from("supervisor_assignments")
        .select("id")
        .eq("student_id", entryCheck.student_id)
        .eq("university_supervisor_id", user.id)
        .maybeSingle();
      if (!assignedUni) return send(res, 403, { ok: false, error: "This student is not assigned to you as university supervisor." });

      const { data, error } = await sb
        .from("logbook_entries")
        .update(updates)
        .eq("id", id)
        .select("*")
        .single();

      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true, entry: data });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
