// public/assessment.js
// Works for both coordinator (any student) and student (own grade only).
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute();
  if (!session) return;

  var profile = window._userProfile;
  var role    = profile ? profile.role : null;

  UI.renderNav(role, session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  var token    = session.access_token;
  var alertEl  = document.getElementById("assess-alert");

  // Determine which student to show
  var url        = new URL(window.location.href);
  var student_id = url.searchParams.get("student_id");

  if (role === "student") {
    student_id = profile.id;
    document.getElementById("page-title").textContent = "My Assessment";
    // Hide override form for students
    var ovSection = document.getElementById("override-section");
    if (ovSection) ovSection.style.display = "none";
  } else if (!["coordinator"].includes(role)) {
    // University or industrial supervisors can view but not override
    var ovSection = document.getElementById("override-section");
    if (ovSection) ovSection.style.display = "none";
  }

  if (!student_id) {
    UI.showAlert(alertEl, "error", "No student selected.");
    return;
  }

  // Fetch grade data
  try {
    var r = await apiFetch("GET", "/api/assessments/grade?student_id=" + encodeURIComponent(student_id));
    if (!r.ok) throw new Error(r.error);

    // Page title with student name (coordinator sees student name)
    if (role === "coordinator") {
      try {
        var sp = await apiFetch("GET", "/api/profile/me");
        // We can't easily get another student's name from /me, so leave the title
      } catch (_) {}
    }

    var grade  = r.grade;
    var report = r.report;
    var evals  = r.evaluations || [];

    // Fill grade cards
    var v1  = evals.find(function (e) { return e.visit_number === 1; });
    var v2  = evals.find(function (e) { return e.visit_number === 2; });
    var avg = (v1 && v2) ? ((v1.score + v2.score) / 2).toFixed(1) : (v1 ? v1.score : (v2 ? v2.score : null));

    setText("g-report", grade && grade.report_score  != null ? grade.report_score : (report && report.score != null ? report.score : "—"));
    setText("g-visits", avg != null ? avg : "—");
    setText("g-final",  grade && grade.final_grade   != null ? parseFloat(grade.final_grade).toFixed(1) : "—");
    setText("g-letter", grade && grade.letter_grade  ? grade.letter_grade : "—");

    if (grade && grade.override_grade != null) {
      var noteEl = document.getElementById("g-override-note");
      if (noteEl) {
        noteEl.textContent = "⚠ Grade overridden by coordinator" +
          (grade.override_reason ? ": " + grade.override_reason : "") + ".";
        noteEl.style.display = "";
      }
    }

    // Report detail
    var reportDiv = document.getElementById("report-detail");
    if (report) {
      reportDiv.innerHTML = [
        '<p class="small"><strong>Title:</strong> ' + _esc(report.title) + '</p>',
        '<p class="small"><strong>Status:</strong> <span class="badge-role ' + (report.status === "graded" ? "coordinator" : "student") + '">' + report.status + '</span></p>',
        report.score != null ? '<p class="small"><strong>Score:</strong> ' + report.score + ' / 100</p>' : '',
        report.file_url ? '<p class="small"><a href="' + _esc(report.file_url) + '" target="_blank">📎 Download report</a></p>' : '',
        '<p class="small muted">Submitted: ' + (report.submitted_at ? new Date(report.submitted_at).toLocaleDateString() : "—") + '</p>',
      ].join("");
    }

    // Evaluations detail
    var evalsDiv = document.getElementById("evals-detail");
    if (evals.length > 0) {
      evalsDiv.innerHTML = evals.map(function (ev) {
        return '<div class="card mb-8" style="padding:12px">' +
          '<div class="flex-between"><strong>Visit ' + ev.visit_number + '</strong>' +
          '<span style="font-size:1.3rem;font-weight:700">' + ev.score + '</span></div>' +
          (ev.comments ? '<p class="small muted mt-4">' + _esc(ev.comments) + '</p>' : '') +
          (ev.visit_date ? '<p class="small muted">' + new Date(ev.visit_date).toLocaleDateString() + '</p>' : '') +
          '</div>';
      }).join("");
    }

    // Override form (coordinator only)
    var overrideForm = document.getElementById("overrideForm");
    if (overrideForm && role === "coordinator") {
      if (grade && grade.override_grade != null)
        document.getElementById("ov-grade").value = grade.override_grade;

      overrideForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var ovAlert  = document.getElementById("override-alert");
        var newGrade = parseFloat(document.getElementById("ov-grade").value);
        var reason   = document.getElementById("ov-reason").value.trim();
        UI.hideAlert(ovAlert);

        if (isNaN(newGrade)) { UI.showAlert(ovAlert, "error", "Enter a valid grade."); return; }
        var btn = document.getElementById("btnOverride");
        UI.setLoading(btn, true);
        try {
          var gr2 = await apiFetch("POST", "/api/assessments/override", {
            student_id:     student_id,
            override_grade: newGrade,
            override_reason: reason || null,
          });
          if (!gr2.ok) throw new Error(gr2.error);
          UI.showAlert(ovAlert, "success", "Grade overridden to " + gr2.grade.final_grade + " (" + gr2.grade.letter_grade + ").");
          setText("g-final",  gr2.grade.final_grade);
          setText("g-letter", gr2.grade.letter_grade);
          var noteEl = document.getElementById("g-override-note");
          if (noteEl) {
            noteEl.textContent = "⚠ Grade overridden by coordinator" + (reason ? ": " + reason : "") + ".";
            noteEl.style.display = "";
          }
        } catch (err) {
          UI.showAlert(ovAlert, "error", err.message);
        } finally {
          UI.setLoading(btn, false);
        }
      });
    }

  } catch (err) {
    UI.showAlert(alertEl, "error", "Could not load assessment: " + err.message);
  }

  async function apiFetch(method, path, body) {
    var opts = { method: method, headers: { Authorization: "Bearer " + token } };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    var resp = await fetch(path, opts);
    return resp.json();
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val != null ? val : "—";
  }

  function _esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }
})();
