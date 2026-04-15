const { adminClient, send, readBody } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method Not Allowed" });

    const sb   = adminClient();
    const body = await readBody(req);

    const role     = String(body.role      || "").trim();
    const email    = String(body.email     || "").trim();
    const fullName = String(body.full_name || "").trim();
    const extra    = body.extra || {};

    if (!["student", "organization", "coordinator"].includes(role)) {
      return send(res, 400, { ok: false, error: "Invalid role" });
    }
    if (!email) return send(res, 400, { ok: false, error: "email is required" });

    // Find the auth user by email (they were just created by signUp)
    const { data: users, error: uerr } = await sb.auth.admin.listUsers({ page: 1, perPage: 500 });
    if (uerr) return send(res, 500, { ok: false, error: uerr.message });

    const user = users.users.find(function (u) { return u.email === email; });
    if (!user) {
      return send(res, 404, { ok: false, error: "User not found. Verification may be pending — try signing in." });
    }

    // Auto-confirm email so users can sign in immediately
    await sb.auth.admin.updateUserById(user.id, { email_confirm: true });

    // Upsert base profile row
    const profileRow = { id: user.id, role: role, email: email };
    if (fullName) profileRow.full_name = fullName;

    const { data: profile, error: perr } = await sb
      .from("profiles")
      .upsert([profileRow], { onConflict: "id" })
      .select("*")
      .single();

    if (perr) return send(res, 500, { ok: false, error: perr.message });

    // Upsert role-specific sub-table
    if (role === "student") {
      const studentRow = { id: user.id };
      if (extra.program)            studentRow.program            = extra.program;
      if (extra.year_of_study)      studentRow.year_of_study      = extra.year_of_study;
      if (extra.preferred_location) studentRow.preferred_location = extra.preferred_location;
      // skills stays empty until profile edit

      const { error: serr } = await sb
        .from("student_profiles")
        .upsert([studentRow], { onConflict: "id" });
      if (serr) return send(res, 500, { ok: false, error: "Profile created but student details failed: " + serr.message });

    } else if (role === "organization") {
      const orgRow = { id: user.id };
      if (extra.org_name)       orgRow.org_name       = extra.org_name;
      if (extra.industry)       orgRow.industry        = extra.industry;
      if (extra.contact_person) orgRow.contact_person  = extra.contact_person;
      if (extra.location)       orgRow.location        = extra.location;
      if (extra.slots != null)  orgRow.slots           = extra.slots;

      const { error: oerr } = await sb
        .from("organization_profiles")
        .upsert([orgRow], { onConflict: "id" });
      if (oerr) return send(res, 500, { ok: false, error: "Profile created but org details failed: " + oerr.message });
    }

    return send(res, 200, { ok: true, profile: profile });

  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
