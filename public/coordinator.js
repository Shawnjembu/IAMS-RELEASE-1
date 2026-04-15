// public/coordinator.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

var _token = "";
var _allStudents = [];
var _allSupervisors = [];

(async function () {
  const session = await UI.protectRoute("coordinator");
  if (!session) return;
  _token = session.access_token;
  UI.renderNav("coordinator", session.user.email);

  // Tab switching
  document.querySelectorAll(".auth-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".auth-tab").forEach(function (t) { t.classList.remove("active"); });
      document.querySelectorAll(".coord-panel").forEach(function (p) { p.style.display = "none"; });
      tab.classList.add("active");
      var panelId = "panel-" + tab.dataset.tab;
      var panel = document.getElementById(panelId);
      if (panel) panel.style.display = "";
      onTabLoad(tab.dataset.tab);
    });
  });

  // Initial load
  loadStudents();
})();

function onTabLoad(tab) {
  if (tab === "students")    loadStudents();
  if (tab === "supervisors") loadSupervisors();
  if (tab === "reports")     loadReports();
  if (tab === "deadlines")   loadDeadlines();
}

// ═══════════════════ STUDENTS ═══════════════════
async function loadStudents() {
  var tbody = document.getElementById("students-tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="muted small text-center">Loading…</td></tr>';

  try {
    var r = await api("GET", "/api/coordinator/matching");
    if (!r.ok) throw new Error(r.error);
    _allStudents = r.students || [];

    // Load grades for all students
    var gradeMap = {};
    for (var s of _allStudents) {
      try {
        var gr = await api("GET", "/api/assessments/grade?student_id=" + s.student_id);
        if (gr.ok && gr.grade) gradeMap[s.student_id] = gr.grade;
      } catch (_) {}
    }

    renderStudentsTable(_allStudents, gradeMap);

    // Populate override dropdown
    var ovSel = document.getElementById("override-student");
    if (ovSel) {
      ovSel.innerHTML = '<option value="">Select student…</option>' +
        _allStudents.map(function (s) {
          return '<option value="' + s.student_id + '">' + _esc(s.full_name || s.email) + '</option>';
        }).join("");
    }

    // Populate supervisor assign dropdown
    var supSel = document.getElementById("supAssignStudent");
    if (supSel) {
      supSel.innerHTML = '<option value="">Select student…</option>' +
        _allStudents.filter(function (s) { return s.placement; }).map(function (s) {
          return '<option value="' + s.student_id + '">' + _esc(s.full_name || s.email) + '</option>';
        }).join("");
    }

    // Search
    var searchEl = document.getElementById("student-search");
    if (searchEl) {
      searchEl.addEventListener("input", function () {
        var q = searchEl.value.toLowerCase();
        var filtered = _allStudents.filter(function (s) {
          return (s.email || "").toLowerCase().includes(q) ||
                 (s.full_name || "").toLowerCase().includes(q);
        });
        renderStudentsTable(filtered, gradeMap);
      });
    }

    // Logbook student filter
    var logSel = document.getElementById("logbook-student-filter");
    if (logSel) {
      logSel.innerHTML = '<option value="">All students</option>' +
        _allStudents.map(function (s) {
          return '<option value="' + s.student_id + '">' + _esc(s.full_name || s.email) + '</option>';
        }).join("");
    }

  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="muted small text-center">Error: ' + _esc(err.message) + '</td></tr>';
  }
}

function renderStudentsTable(students, gradeMap) {
  var tbody = document.getElementById("students-tbody");
  if (!tbody) return;
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted small text-center">No students found.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map(function (s) {
    var g        = gradeMap && gradeMap[s.student_id];
    var grade    = g ? ((g.final_grade != null ? g.final_grade.toFixed(1) : "—") + " (" + (g.letter_grade || "—") + ")") : "—";
    var placed   = s.placement ? '<span class="badge-role coordinator">assigned</span>' : '<span class="badge-role student">unassigned</span>';
    var prog     = s.extra ? _esc(s.extra.program || "—") : "—";
    var yr       = s.extra ? (s.extra.year_of_study || "—") : "—";
    return '<tr><td>' + _esc(s.full_name || "—") + '</td>' +
      '<td>' + _esc(s.email) + '</td>' +
      '<td>' + prog + '</td>' +
      '<td>' + yr + '</td>' +
      '<td>' + placed + '</td>' +
      '<td>' + grade + '</td>' +
      '<td><a href="/assessment.html?student_id=' + s.student_id + '" class="btn btn-secondary btn-sm">View</a></td>' +
      '</tr>';
  }).join("");
}

// ═══════════════════ SUPERVISORS ═══════════════════
async function loadSupervisors() {
  var tbody = document.getElementById("supervisors-tbody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="muted small text-center">Loading…</td></tr>';

  try {
    var r = await api("GET", "/api/coordinator/supervisors");
    if (!r.ok) throw new Error(r.error);
    _allSupervisors = r.supervisors || [];

    if (tbody) {
      tbody.innerHTML = _allSupervisors.length ? _allSupervisors.map(function (sv) {
        var orgLabel = sv.org ? _esc(sv.org.full_name || sv.org.email) : "—";
        return '<tr><td>' + _esc(sv.full_name || "—") + '</td>' +
          '<td>' + _esc(sv.email) + '</td>' +
          '<td>' + _esc(sv.role.replace(/_/g, " ")) + '</td>' +
          '<td>' + (sv.role === "industrial_supervisor" ? orgLabel : "University") + '</td>' +
          '</tr>';
      }).join("") : '<tr><td colspan="4" class="muted small text-center">No supervisors yet.</td></tr>';
    }

    // Populate assign dropdowns
    var indSel = document.getElementById("supAssignInd");
    var uniSel = document.getElementById("supAssignUni");
    var indSups = _allSupervisors.filter(function (s) { return s.role === "industrial_supervisor"; });
    var uniSups = _allSupervisors.filter(function (s) { return s.role === "university_supervisor"; });

    if (indSel) indSel.innerHTML = '<option value="">None</option>' +
      indSups.map(function (s) { return '<option value="' + s.id + '">' + _esc(s.full_name || s.email) + '</option>'; }).join("");
    if (uniSel) uniSel.innerHTML = '<option value="">None</option>' +
      uniSups.map(function (s) { return '<option value="' + s.id + '">' + _esc(s.full_name || s.email) + '</option>'; }).join("");

  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="muted small text-center">Error: ' + _esc(err.message) + '</td></tr>';
  }

  // Create supervisor form
  var form = document.getElementById("supCreateForm");
  if (form && !form._bound) {
    form._bound = true;
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var alertEl = document.getElementById("sup-create-alert");
      UI.hideAlert(alertEl);
      ["supName", "supEmail", "supPass"].forEach(function (id) {
        var err = document.getElementById(id + "-err");
        if (err) err.textContent = "";
      });

      var role  = document.getElementById("supRole").value;
      var name  = document.getElementById("supName").value.trim();
      var email = document.getElementById("supEmail").value.trim();
      var pass  = document.getElementById("supPass").value;
      var dept  = document.getElementById("supDept").value.trim();
      var spec  = document.getElementById("supSpec").value.trim();

      var valid = true;
      if (!name)          { document.getElementById("supName-err").textContent = "Name required.";  valid = false; }
      if (!email)         { document.getElementById("supEmail-err").textContent = "Email required."; valid = false; }
      if (pass.length < 6){ document.getElementById("supPass-err").textContent = "Min 6 chars.";    valid = false; }
      if (!valid) return;

      var btn = document.getElementById("btnSupCreate");
      UI.setLoading(btn, true);
      try {
        var r = await api("POST", "/api/coordinator/supervisors", {
          role, full_name: name, email, password: pass, department: dept, specialization: spec
        });
        if (!r.ok) throw new Error(r.error);
        UI.showAlert(alertEl, "success", "Supervisor account created.");
        UI.showToast("success", "Supervisor created!");
        form.reset();
        loadSupervisors();
      } catch (err) {
        UI.showAlert(alertEl, "error", err.message);
      } finally {
        UI.setLoading(btn, false);
      }
    });
  }

  // Assign supervisor form
  var assignForm = document.getElementById("supAssignForm");
  if (assignForm && !assignForm._bound) {
    assignForm._bound = true;
    assignForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var alertEl = document.getElementById("sup-assign-alert");
      UI.hideAlert(alertEl);

      var studentId = document.getElementById("supAssignStudent").value;
      var indId     = document.getElementById("supAssignInd").value || null;
      var uniId     = document.getElementById("supAssignUni").value || null;

      if (!studentId) { UI.showAlert(alertEl, "error", "Please select a student."); return; }

      var student = _allStudents.find(function (s) { return s.student_id === studentId; });
      if (!student || !student.placement) {
        UI.showAlert(alertEl, "error", "Student must have a placement before assigning supervisors."); return;
      }

      var btn = document.getElementById("btnSupAssign");
      UI.setLoading(btn, true);
      try {
        var r = await api("POST", "/api/supervisor/assign", {
          placement_id: student.placement.id,
          student_id:   studentId,
          industrial_supervisor_id: indId,
          university_supervisor_id: uniId,
        });
        if (!r.ok) throw new Error(r.error);
        UI.showAlert(alertEl, "success", "Supervisors assigned.");
        UI.showToast("success", "Assignment saved.");
      } catch (err) {
        UI.showAlert(alertEl, "error", err.message);
      } finally {
        UI.setLoading(btn, false);
      }
    });
  }
}

// ═══════════════════ LOGBOOKS ═══════════════════
document.addEventListener("DOMContentLoaded", function () {
  var btn = document.getElementById("btnLoadLogbooks");
  if (!btn) return;
  btn.addEventListener("click", async function () {
    var studentId = document.getElementById("logbook-student-filter").value;
    var container = document.getElementById("logbook-entries-coord");
    container.innerHTML = "<p class='muted small'>Loading…</p>";

    try {
      var url = "/api/logbook" + (studentId ? "?student_id=" + encodeURIComponent(studentId) : "");
      var r   = await api("GET", url);
      if (!r.ok) throw new Error(r.error);
      var entries = r.entries || [];
      if (!entries.length) { container.innerHTML = "<p class='muted small'>No entries found.</p>"; return; }

      container.innerHTML = entries.map(function (e) {
        var statusClass = e.status === "reviewed" ? "coordinator" : "student";
        return '<div class="card mb-8" style="padding:16px">' +
          '<div class="flex-between mb-8">' +
            '<strong>Week ' + (e.week_number || "?") + '</strong>' +
            '<span class="badge-role ' + statusClass + '">' + e.status + '</span>' +
          '</div>' +
          '<p class="small muted"><strong>Activities:</strong></p>' +
          '<p class="small" style="white-space:pre-wrap;margin-bottom:8px">' + _esc(e.activities) + '</p>' +
          (e.supervisor_comments ? '<p class="small muted"><em>Supervisor: ' + _esc(e.supervisor_comments) + '</em></p>' : '') +
          (e.file_url ? '<p class="small"><a href="' + _esc(e.file_url) + '" target="_blank">Attachment</a></p>' : '') +
          (e.status !== "reviewed"
            ? '<button class="btn btn-secondary btn-sm mt-8" data-mark-reviewed="' + e.id + '">Mark Reviewed</button>'
            : '') +
          '</div>';
      }).join("");

      container.querySelectorAll("[data-mark-reviewed]").forEach(function (btn2) {
        btn2.addEventListener("click", async function () {
          UI.setLoading(btn2, true);
          try {
            var r2 = await api("PATCH", "/api/logbook?id=" + encodeURIComponent(btn2.dataset.markReviewed), {});
            if (!r2.ok) throw new Error(r2.error);
            btn2.closest(".card").querySelector(".badge-role").textContent = "reviewed";
            btn2.closest(".card").querySelector(".badge-role").className = "badge-role coordinator";
            btn2.remove();
          } catch (err) {
            UI.showToast("error", err.message);
            UI.setLoading(btn2, false);
          }
        });
      });

    } catch (err) {
      container.innerHTML = "<p class='muted small'>Error: " + _esc(err.message) + "</p>";
    }
  });
});

// ═══════════════════ REPORTS ═══════════════════
async function loadReports() {
  var tbody = document.getElementById("reports-tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="muted small text-center">Loading…</td></tr>';
  try {
    var r = await api("GET", "/api/reports/review");
    if (!r.ok) throw new Error(r.error);
    var reports = r.reports || [];
    tbody.innerHTML = reports.length ? reports.map(function (rp) {
      var student = rp.student || {};
      var statusClass = rp.status === "graded" ? "coordinator" : rp.status === "reviewed" ? "organization" : "student";
      return '<tr>' +
        '<td>' + _esc(student.full_name || student.email || "—") + '</td>' +
        '<td>' + _esc(rp.title) + '</td>' +
        '<td><span class="badge-role ' + statusClass + '">' + rp.status + '</span></td>' +
        '<td>' + (rp.score != null ? rp.score : "—") + '</td>' +
        '<td>' + (rp.submitted_at ? new Date(rp.submitted_at).toLocaleDateString() : "—") + '</td>' +
        '<td><a href="' + (rp.file_url || "#") + '" target="_blank" class="btn btn-secondary btn-sm"' + (!rp.file_url ? ' style="opacity:.5;pointer-events:none"' : '') + '>View</a></td>' +
        '</tr>';
    }).join("") : '<tr><td colspan="6" class="muted small text-center">No reports submitted yet.</td></tr>';
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted small text-center">Error: ' + _esc(err.message) + '</td></tr>';
  }

  // Override form
  var overrideForm = document.getElementById("overrideForm");
  if (overrideForm && !overrideForm._bound) {
    overrideForm._bound = true;
    overrideForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var alertEl    = document.getElementById("override-alert");
      var studentId  = document.getElementById("override-student").value;
      var grade      = document.getElementById("override-grade").value;
      var reason     = document.getElementById("override-reason").value.trim();

      UI.hideAlert(alertEl);
      if (!studentId) { UI.showAlert(alertEl, "error", "Please select a student."); return; }
      if (!grade)     { UI.showAlert(alertEl, "error", "Please enter a grade."); return; }

      var btn = document.getElementById("btnOverride");
      UI.setLoading(btn, true);
      try {
        var r = await api("POST", "/api/assessments/override", {
          student_id:     studentId,
          override_grade: parseFloat(grade),
          override_reason: reason || null,
        });
        if (!r.ok) throw new Error(r.error);
        UI.showAlert(alertEl, "success", "Grade overridden to " + r.grade.final_grade + " (" + r.grade.letter_grade + ").");
        UI.showToast("success", "Grade updated.");
      } catch (err) {
        UI.showAlert(alertEl, "error", err.message);
      } finally {
        UI.setLoading(btn, false);
      }
    });
  }
}

// ═══════════════════ DEADLINES ═══════════════════
async function loadDeadlines() {
  var listEl  = document.getElementById("deadlines-list");
  var formEl  = document.getElementById("deadline-form");
  var alertEl = document.getElementById("deadline-alert");
  if (!listEl) return;

  // Fetch and render existing deadlines
  async function fetchDeadlines() {
    listEl.innerHTML = '<p class="small muted">Loading…</p>';
    try {
      var d = await api("GET", "/api/deadlines?role=coordinator");
      if (!d.ok) throw new Error(d.error);
      if (!d.deadlines || d.deadlines.length === 0) {
        listEl.innerHTML = '<p class="small muted">No deadlines set yet.</p>';
        return;
      }
      listEl.innerHTML = d.deadlines.map(function(dl) {
        var due = dl.due_date ? new Date(dl.due_date).toLocaleDateString() : "No date";
        return '<div class="card" style="margin-bottom:8px;padding:12px 16px">' +
          '<div class="flex" style="justify-content:space-between;align-items:center">' +
          '<strong class="small">' + _esc(dl.title) + '</strong>' +
          '<span class="badge-role coordinator small">' + _esc(dl.audience_role) + '</span>' +
          '</div>' +
          '<p class="small muted mb-4">Due: ' + due + '</p>' +
          (dl.message ? '<p class="small" style="white-space:pre-wrap">' + _esc(dl.message) + '</p>' : '') +
          '</div>';
      }).join("");
    } catch (err) {
      listEl.innerHTML = '<p class="small danger">Could not load deadlines: ' + _esc(err.message) + '</p>';
    }
  }

  fetchDeadlines();

  // Create deadline form handler
  if (formEl && !formEl._bound) {
    formEl._bound = true;
    formEl.addEventListener("submit", async function(e) {
      e.preventDefault();
      if (alertEl) UI.hideAlert(alertEl);
      var title        = (document.getElementById("dl-title")   || {}).value || "";
      var due_date     = (document.getElementById("dl-due")     || {}).value || null;
      var audience_role= (document.getElementById("dl-role")    || {}).value || "all";
      var message      = (document.getElementById("dl-message") || {}).value || "";

      if (!title.trim()) {
        if (alertEl) UI.showAlert(alertEl, "error", "Title is required.");
        return;
      }

      var btn = formEl.querySelector("button[type=submit]");
      if (btn) UI.setLoading(btn, true);
      try {
        var r = await api("POST", "/api/deadlines", {
          title: title.trim(),
          due_date: due_date || null,
          audience_role,
          message: message.trim() || null,
        });
        if (!r.ok) throw new Error(r.error);
        formEl.reset();
        if (alertEl) UI.showAlert(alertEl, "success", "Deadline created.");
        UI.showToast("success", "Deadline saved.");
        fetchDeadlines();
      } catch (err) {
        if (alertEl) UI.showAlert(alertEl, "error", err.message);
      } finally {
        if (btn) UI.setLoading(btn, false);
      }
    });
  }
}

// ═══════════════════ HELPERS ═══════════════════
async function api(method, path, body) {
  var opts = {
    method: method,
    headers: { Authorization: "Bearer " + _token }
  };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  var r = await fetch(path, opts);
  return r.json();
}

function _esc(s) {
  return String(s || "").replace(/[&<>"']/g, function (c) {
    return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
  });
}
