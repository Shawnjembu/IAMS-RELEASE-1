// POST /api/profile/register
// Creates the auth user + profile in one call using the admin API.
// No confirmation email is ever sent.
const { adminClient, send, readBody, rateLimit } = require("../_shared");

function isStudentUbEmail(email) {
  return /^\d{9}@ub\.co\.bw$/i.test(String(email || "").trim());
}
function studentNumberFromEmail(email) {
  const m = String(email || "").trim().match(/^(\d{9})@ub\.co\.bw$/i);
  return m ? m[1] : null;
}
function isUbEmail(email) {
  return /^[^\s@]+@ub\.co\.bw$/i.test(String(email || "").trim());
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method Not Allowed" });
    if (!rateLimit(req, res, "register", 5, 60 * 60 * 1000)) return;

    const sb   = adminClient();
    const body = await readBody(req);

    const role     = String(body.role      || "").trim();
    const email    = String(body.email     || "").trim();
    const password = String(body.password  || "").trim();
    const fullName = String(body.full_name || "").trim();
    const extra    = body.extra || {};

    if (!["student", "organization"].includes(role))
      return send(res, 400, { ok: false, error: "Invalid role" });
    if (!email)    return send(res, 400, { ok: false, error: "Email is required" });
    if (role === "student" && !isStudentUbEmail(email)) {
      return send(res, 400, { ok: false, error: "Student email must use the UB student format: 9 digits followed by @ub.co.bw, for example 201801639@ub.co.bw." });
    }
    if (password.length < 6) return send(res, 400, { ok: false, error: "Password must be at least 6 characters" });

    // Create auth user via admin — no email sent
    const { data: { user }, error: createErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,          // confirmed immediately, no email
      user_metadata: { role, full_name: fullName },
    });

    if (createErr) {
      const msg = createErr.message || "";
      if (msg.toLowerCase().includes("already registered") || msg.toLowerCase().includes("already been registered")) {
        return send(res, 409, { ok: false, error: "An account with this email already exists." });
      }
      return send(res, 500, { ok: false, error: createErr.message });
    }

    // Upsert base profile row
    const profileRow = { id: user.id, role, email };
    if (fullName) profileRow.full_name = fullName;

    const { data: profile, error: perr } = await sb
      .from("profiles")
      .upsert([profileRow], { onConflict: "id" })
      .select("*")
      .single();

    if (perr) return send(res, 500, { ok: false, error: perr.message });

    // Role-specific sub-table
    if (role === "student") {
      const row = { id: user.id };
      const numberFromEmail = studentNumberFromEmail(email);
      if (numberFromEmail) row.student_number = numberFromEmail;
      if (extra.student_number)     row.student_number     = extra.student_number;
      if (extra.program)            row.program            = extra.program;
      if (extra.year_of_study)      row.year_of_study      = extra.year_of_study;
      if (extra.preferred_location) row.preferred_location = extra.preferred_location;

      const { error: serr } = await sb
        .from("student_profiles")
        .upsert([row], { onConflict: "id" });
      if (serr) return send(res, 500, { ok: false, error: "Profile created but student details failed: " + serr.message });

    } else if (role === "organization") {
      const row = { id: user.id };
      if (extra.org_name)       row.org_name       = extra.org_name;
      if (extra.industry)       row.industry        = extra.industry;
      if (extra.contact_person) row.contact_person  = extra.contact_person;
      if (extra.location)       row.location        = extra.location;
      if (extra.slots != null)  row.slots           = extra.slots;

      const { error: oerr } = await sb
        .from("organization_profiles")
        .upsert([row], { onConflict: "id" });
      if (oerr) return send(res, 500, { ok: false, error: "Profile created but org details failed: " + oerr.message });
    }

    return send(res, 200, { ok: true, profile });

  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
