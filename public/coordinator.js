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
      document.querySelectorAll(".coord-panel").forEach(function (p) { p.classList.remove("active"); });
      tab.classList.add("active");
      var panelId = "panel-" + tab.dataset.tab;
      var panel = document.getElementById(panelId);
      if (panel) panel.classList.add("active");
      onTabLoad(tab.dataset.tab);
    });
  });

  // Initial load
  loadStudents();
})();

function onTabLoad(tab) {
  if (tab === "students")      loadStudents();
  if (tab === "organisations") loadOrganisations();
  if (tab === "supervisors")   loadSupervisors();
  if (tab === "reports")     loadReports();
  if (tab === "deadlines")   loadDeadlines();
}

function isUniversitySupervisorEmail(email) {
  return /^[^\s@]+@ub\.ac\.bw$/i.test(String(email || "").trim());
}

// ═══════════════════ ORGANISATIONS ═══════════════════
async function loadOrganisations() {
  var tbody = document.getElementById("coord-orgs-tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="muted small text-center">Loading…</td></tr>';
  try {
    var r = await api("GET", "/api/coordinator/matching");
    if (!r.ok) throw new Error(r.error);
    var orgs = r.orgs || [];
    if (!orgs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted small text-center">No organisations found.</td></tr>';
      return;
    }
    tbody.innerHTML = orgs.map(function(o) {
      var extra = o.extra || {};
      var name = extra.org_name || o.full_name || o.email || "Organisation";
      var total = extra.slots != null ? Number(extra.slots) : 0;
      var assigned = Number(o.current_students || 0);
      var available = Number(o.available_slots || 0);
      var open = o.can_accept !== false && available > 0;
      return '<tr>' +
        '<td><strong>' + _esc(name) + '</strong><div class="small muted">' + _esc(o.email || '') + '</div></td>' +
        '<td>' + _esc(extra.location || '—') + '</td>' +
        '<td>' + _esc(String(total)) + '</td>' +
        '<td>' + _esc(String(assigned)) + '</td>' +
        '<td><span class="badge-role ' + (open ? 'organization' : 'student') + '">' + _esc(String(available)) + '</span></td>' +
        '<td>' + (open ? '<a class="btn btn-primary btn-sm" href="/matching.html">Assign Student</a>' : '<span class="badge-role student">Full</span>') + '</td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted small text-center">Error: ' + _esc(err.message) + '</td></tr>';
  }
}

// ═══════════════════ STUDENTS ═══════════════════
async function loadStudents() {
  var tbody = document.getElementById("students-tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="muted small text-center">Loading…</td></tr>';

  try {
    var r = await api("GET", "/api/coordinator/matching");
    if (!r.ok) throw new Error(r.error);
    _allStudents = r.students || [];
    renderStudentsTable(_allStudents);

    // Populate supervisor assign dropdown with placed students only
    var supSel = document.getElementById("supAssignStudent");
    if (supSel) {
      supSel.innerHTML = '<option value="">Select student…</option>' +
        _allStudents.filter(function (s) { return s.placement; }).map(function (s) {
          return '<option value="' + s.student_id + '">' + _esc(s.full_name || s.email) + '</option>';
        }).join("");
    }

    // Search
    var searchEl = document.getElementById("student-search");
    if (searchEl && !searchEl._bound) {
      searchEl._bound = true;
      searchEl.addEventListener("input", function () {
        var q = searchEl.value.toLowerCase();
        var filtered = _allStudents.filter(function (s) {
          return (s.email || "").toLowerCase().includes(q) ||
                 (s.full_name || "").toLowerCase().includes(q);
        });
        renderStudentsTable(filtered);
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

    // Deadline target student dropdown for specific-student deadlines
    var dlTargetSel = document.getElementById("dl-target-student");
    if (dlTargetSel) {
      dlTargetSel.innerHTML = '<option value="">Select student…</option>' +
        _allStudents.map(function (s) {
          var label = (s.full_name || s.email || "Student") + (s.placement ? " — assigned" : " — unassigned");
          return '<option value="' + s.student_id + '">' + _esc(label) + '</option>';
        }).join("");
    }

  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="muted small text-center">Error: ' + _esc(err.message) + '</td></tr>';
  }
}

function renderStudentsTable(students) {
  var tbody = document.getElementById("students-tbody");
  if (!tbody) return;
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted small text-center">No students found.</td></tr>';
    return;
  }
  tbody.innerHTML = students.map(function (s) {
    var placed   = s.placement ? '<span class="badge-role coordinator">assigned</span>' : '<span class="badge-role student">unassigned</span>';
    var supStatus = s.placement ? '<span class="badge-role organization">ready for supervisor assignment</span>' : '<span class="badge-role student">place student first</span>';
    var prog     = s.extra ? _esc(s.extra.program || "—") : "—";
    var yr       = s.extra ? (s.extra.year_of_study || "—") : "—";
    return '<tr><td>' + _esc(s.full_name || "—") + '</td>' +
      '<td>' + _esc(s.email) + '</td>' +
      '<td>' + prog + '</td>' +
      '<td>' + yr + '</td>' +
      '<td>' + placed + '</td>' +
      '<td>' + supStatus + '</td>' +
      '</tr>';
  }).join("");
}

// ═══════════════════ SUPERVISORS ═══════════════════
async function loadSupervisors() {
  var tbody = document.getElementById("supervisors-tbody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="muted small text-center">Loading…</td></tr>';

  try {
    var r = await api("GET", "/api/coordinator/supervisors");
    if (!r.ok) throw new Error(r.error);
    _allSupervisors = r.supervisors || [];
    var invites = r.invites || [];

    if (tbody) {
      var activeRows = _allSupervisors.map(function (sv) {
        var orgLabel = sv.org ? _esc(sv.org.full_name || sv.org.email) : "University";
        return '<tr><td>' + _esc(sv.full_name || "—") + '</td>' +
          '<td>' + _esc(sv.email) + '</td>' +
          '<td>' + _esc(sv.role.replace(/_/g, " ")) + '</td>' +
          '<td>' + (sv.role === "industrial_supervisor" ? orgLabel : "University") + '</td>' +
          '<td><span class="badge-role organization">active</span></td></tr>';
      }).join("");
      var inviteRows = invites.map(function(inv) {
        return '<tr><td>' + _esc(inv.full_name || "Pending invite") + '</td>' +
          '<td>' + _esc(inv.email) + '</td>' +
          '<td>' + _esc(inv.supervisor_type.replace(/_/g, " ")) + '</td>' +
          '<td>' + (inv.supervisor_type === "industrial_supervisor" ? "Organisation" : "University") + '</td>' +
          '<td><span class="badge-role student">' + _esc(inv.status) + '</span>' + (inv.invite_link ? '<button type="button" class="btn btn-secondary btn-sm mt-8" data-copy-link="' + _esc(inv.invite_link) + '">Copy Invite</button>' : '') + '</td></tr>';
      }).join("");
      tbody.innerHTML = (activeRows + inviteRows) || '<tr><td colspan="5" class="muted small text-center">No supervisors or invites yet.</td></tr>';
      tbody.querySelectorAll('[data-copy-link]').forEach(function(btn){
        btn.addEventListener('click', async function(){
          try { await navigator.clipboard.writeText(btn.getAttribute('data-copy-link')); UI.showToast('success', 'Invite link copied.'); }
          catch (_) { UI.showToast('error', 'Copy failed. Open the row and copy manually.'); }
        });
      });
    }

    // Populate assign dropdowns
    var uniSel = document.getElementById("supAssignUni");
    var uniSups = _allSupervisors.filter(function (s) { return s.role === "university_supervisor"; });

    if (uniSel) uniSel.innerHTML = '<option value="">Select university supervisor…</option>' +
      uniSups.map(function (s) { return '<option value="' + s.id + '">' + _esc(s.full_name || s.email) + '</option>'; }).join("");

  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="muted small text-center">Error: ' + _esc(err.message) + '</td></tr>';
  }

  // Create supervisor form
  var form = document.getElementById("supCreateForm");
  if (form && !form._bound) {
    form._bound = true;
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var alertEl = document.getElementById("sup-create-alert");
      UI.hideAlert(alertEl);
      ["supName", "supEmail"].forEach(function (id) {
        var err = document.getElementById(id + "-err");
        if (err) err.textContent = "";
      });

      var role  = "university_supervisor";
      var name  = document.getElementById("supName").value.trim();
      var email = document.getElementById("supEmail").value.trim();
      var dept  = document.getElementById("supDept").value.trim();
      var spec  = document.getElementById("supSpec").value.trim();

      var valid = true;
      if (!name)          { document.getElementById("supName-err").textContent = "Name required.";  valid = false; }
      if (!email)         { document.getElementById("supEmail-err").textContent = "Email required."; valid = false; }
      else if (!isUniversitySupervisorEmail(email)) { document.getElementById("supEmail-err").textContent = "Use a UB email, for example email@ub.ac.bw."; valid = false; }
      if (!valid) return;

      var btn = document.getElementById("btnSupCreate");
      UI.setLoading(btn, true);
      try {
        var r = await api("POST", "/api/coordinator/supervisors", {
          full_name: name, email, department: dept, specialization: spec
        });
        if (!r.ok) throw new Error(r.error);
        UI.showAlert(alertEl, "success", "University supervisor invite created. Use the Copy Invite button in the table if email delivery is not configured.");
        UI.showToast("success", "Supervisor invite created!");
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

      ["supAssignStudent", "supAssignUni"].forEach(clearFieldError);

      var studentId = document.getElementById("supAssignStudent").value;
      var uniId     = document.getElementById("supAssignUni").value || null;

      var valid = true;
      if (!studentId) { setFieldError("supAssignStudent", "Please select a student."); valid = false; }
      if (!uniId) {
        setFieldError("supAssignUni", "Select a university supervisor.");
        valid = false;
      }
      if (!valid) { UI.showAlert(alertEl, "error", "Please fix the highlighted dropdown errors."); return; }

      var student = _allStudents.find(function (s) { return s.student_id === studentId; });
      if (!student || !student.placement) {
        setFieldError("supAssignStudent", "This student has no placement yet.");
        UI.showAlert(alertEl, "error", "Student must have a placement before assigning supervisors."); return;
      }

      var btn = document.getElementById("btnSupAssign");
      UI.setLoading(btn, true);
      try {
        var r = await api("POST", "/api/supervisor/assign", {
          placement_id: student.placement.id,
          student_id:   studentId,
          university_supervisor_id: uniId,
        });
        if (!r.ok) throw new Error(r.error);
        UI.showAlert(alertEl, "success", "University supervisor assigned. Industrial supervisors are assigned by organisations.");
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
}

// ═══════════════════ DEADLINES ═══════════════════
async function loadDeadlines() {
  var listEl  = document.getElementById("deadlines-list");
  if (!listEl) return;
  listEl.innerHTML = '<p class="small muted">Loading…</p>';
  try {
    var d = await api("GET", "/api/deadlines?role=coordinator");
    if (!d.ok) throw new Error(d.error);
    if (!d.deadlines || d.deadlines.length === 0) {
      listEl.innerHTML = '<p class="small muted">No deadlines have been created by supervisors yet.</p>';
      return;
    }
    listEl.innerHTML = d.deadlines.map(function(dl) {
      var due = dl.due_date ? new Date(dl.due_date).toLocaleDateString() : "No date";
      return '<div class="card" style="margin-bottom:8px;padding:12px 16px">' +
        '<div class="flex" style="justify-content:space-between;align-items:center;gap:12px">' +
        '<strong class="small">' + _esc(dl.title) + '</strong>' +
        '<span class="badge-role coordinator small">' + _esc(dl.audience_role || 'deadline') + '</span>' +
        '</div>' +
        '<p class="small muted mb-4">Due: ' + due + '</p>' +
        (dl.message ? '<p class="small" style="white-space:pre-wrap">' + _esc(dl.message) + '</p>' : '') +
        '</div>';
    }).join("");
  } catch (err) {
    listEl.innerHTML = '<p class="small danger">Could not load deadlines: ' + _esc(err.message) + '</p>';
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

function setFieldError(id, message) {
  var el = document.getElementById(id);
  var err = document.getElementById(id + "-err");
  if (el) el.classList.add("is-error");
  if (err) err.textContent = message || "";
}

function clearFieldError(id) {
  var el = document.getElementById(id);
  var err = document.getElementById(id + "-err");
  if (el) el.classList.remove("is-error");
  if (err) err.textContent = "";
}

function _esc(s) {
  return String(s || "").replace(/[&<>"']/g, function (c) {
    return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
  });
}
