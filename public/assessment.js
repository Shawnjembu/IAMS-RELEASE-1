// public/assessment.js
// View-only review summary. Coordinators may monitor; supervisors handle review/grading.
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
    document.getElementById("page-title").textContent = "My Review Summary";
  } else if (role === "coordinator") {
    var pickerSection = document.getElementById("student-picker-section");
    if (pickerSection) pickerSection.style.display = "";
    await loadStudentPicker(student_id);
    if (!student_id) {
      document.getElementById("assessment-details").style.display = "none";
      return;
    }
  } else {
  }

  if (!student_id) {
    UI.showAlert(alertEl, "error", "No student selected.");
    return;
  }
  document.getElementById("assessment-details").style.display = "";

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

  } catch (err) {
    UI.showAlert(alertEl, "error", "Could not load assessment: " + err.message);
  }

  async function loadStudentPicker(selectedId) {
    try {
      var picker = document.getElementById("student-picker");
      if (!picker) return;
      var r = await apiFetch("GET", "/api/coordinator/matching");
      if (!r.ok) throw new Error(r.error || "Could not load students");
      var students = r.students || [];
      picker.innerHTML = '<option value="">-- Select a student --</option>' + students.map(function (s) {
        var label = (s.full_name || s.email || "Student") + (s.extra && s.extra.student_number ? " (" + s.extra.student_number + ")" : "");
        return '<option value="' + _esc(s.student_id) + '"' + (selectedId === s.student_id ? ' selected' : '') + '>' + _esc(label) + '</option>';
      }).join("");
      picker.addEventListener("change", function () {
        var id = this.value;
        var err = document.getElementById("student-picker-err");
        if (err) err.textContent = id ? "" : "Please select a student.";
        if (id) window.location.href = "/assessment.html?student_id=" + encodeURIComponent(id);
      });
    } catch (err) {
      UI.showAlert(alertEl, "error", err.message);
    }
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