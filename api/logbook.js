// GET  /api/logbook        — student fetches their own entries
// POST /api/logbook        — student submits a new entry
// PATCH /api/logbook?id=   — supervisor marks an entry as reviewed
const { adminClient, send, readBody, verifyToken } = require("./_shared");

module.exports = async function handler(req, res) {
  try {
    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    const sb = adminClient();

    // Verify the caller
    const user = await verifyToken(auth).catch(() => null);
    if (!user) return send(res, 401, { ok: false, error: "Invalid token" });

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
      } else if (profile.role === "industrial_supervisor") {
        // Industrial supervisor sees entries for their assigned students
        const { data: assignments } = await sb
          .from("supervisor_assignments")
          .select("student_id")
          .eq("industrial_supervisor_id", user.id);
        const ids = (assignments || []).map(a => a.student_id);
        if (ids.length === 0) return send(res, 200, { ok: true, entries: [] });
        if (filterStudentId && ids.includes(filterStudentId)) {
          query = query.eq("student_id", filterStudentId);
        } else {
          query = query.in("student_id", ids);
        }
      } else {
        // Coordinator sees all; optionally filter by student
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
      const file_url     = body.file_url || null;

      if (!activities) return send(res, 400, { ok: false, error: "activities is required" });

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

      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true, entry: data });
    }

    // ---- PATCH: mark reviewed + add supervisor comments ----
    if (req.method === "PATCH") {
      if (profile.role === "student") {
        return send(res, 403, { ok: false, error: "Students cannot review entries" });
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
