// public/students.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

let _session = null;
let _students = [];
let _industrialSupervisors = [];

(async function () {
  _session = await UI.protectRoute("organization");
  if (!_session) return;

  UI.renderNav("organization", _session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  try {
    await Promise.all([loadStudents(), loadIndustrialSupervisors()]);
    renderStudents();
  } catch (err) {
    document.getElementById("page-content").innerHTML =
      '<div class="alert alert-error">Could not load students: ' + _esc(err.message) + '</div>';
  }
})();

async function loadStudents() {
  var r = await fetch("/api/organization/students", {
    headers: { Authorization: "Bearer " + _session.access_token }
  });
  var d = await r.json();
  if (!d.ok) throw new Error(d.error);
  _students = d.students || [];
}

async function loadIndustrialSupervisors() {
  var r = await fetch("/api/organization/supervisor", {
    headers: { Authorization: "Bearer " + _session.access_token }
  });
  var d = await r.json();
  if (!d.ok) throw new Error(d.error);
  _industrialSupervisors = (d.supervisors || []).filter(function (s) { return s.status === "active"; });
}

function renderStudents() {
  document.getElementById("student-count").textContent = _students.length + " student" + (_students.length !== 1 ? "s" : "");

  if (_students.length === 0) {
    document.getElementById("no-students").style.display = "";
    document.getElementById("students-list").style.display = "none";
    return;
  }

  document.getElementById("no-students").style.display = "none";
  document.getElementById("students-list").style.display = "";

  var tbody = document.getElementById("students-tbody");
  tbody.innerHTML = _students.map(function (s) {
    var assignedDate = s.assigned_at ? new Date(s.assigned_at).toLocaleDateString() : "—";
    var displayName = s.full_name ? _esc(s.full_name) : _esc(s.email);
    var logbookPct  = Math.round((s.logbook_count || 0) / 12 * 100);
    var supervisorName = s.industrial_supervisor
      ? _esc(s.industrial_supervisor.full_name || s.industrial_supervisor.email)
      : '<span class="status-pill pending">Not assigned</span>';
    var options = '<option value="">Select active supervisor…</option>' + _industrialSupervisors.map(function (sup) {
      var selected = s.industrial_supervisor_id === sup.id ? ' selected' : '';
      return '<option value="' + sup.id + '"' + selected + '>' + _esc(sup.full_name || sup.email) + '</option>';
    }).join('');
    var disabled = _industrialSupervisors.length === 0 ? ' disabled' : '';
    return [
      "<tr>",
      "  <td>",
      "    <strong>" + displayName + "</strong>",
      s.full_name ? "<br><span class='small muted'>" + _esc(s.email) + "</span>" : "",
      "  </td>",
      "  <td>" + assignedDate + "</td>",
      "  <td>" + supervisorName + "</td>",
      "  <td>" + (s.logbook_count || 0) + " / 12 <span class='small muted'>(" + logbookPct + "%)</span></td>",
      "  <td>",
      "    <div class='inline-actions'>",
      "      <select class='supervisor-select' data-student='" + s.student_id + "' data-placement='" + s.placement_id + "'" + disabled + ">" + options + "</select>",
      "      <button type='button' class='btn btn-primary btn-sm btn-with-icon' data-assign-student='" + s.student_id + "' data-placement='" + s.placement_id + "'" + disabled + "><span class='btn-icon-badge'>👤</span><span class='btn-label'>Assign Supervisor</span></button>",
      "      <a href='/logbook-review.html?student=" + encodeURIComponent(s.student_id) + "' class='btn btn-secondary btn-sm btn-with-icon'><span class='btn-icon-badge'>📘</span><span>View Logbook</span></a>",
      "    </div>",
      _industrialSupervisors.length === 0 ? "<p class='small muted mt-8'>Invite and activate an industrial supervisor first.</p>" : "",
      "  </td>",
      "</tr>"
    ].join("");
  }).join("");

  tbody.querySelectorAll("[data-assign-student]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var studentId = btn.getAttribute("data-assign-student");
      var placementId = btn.getAttribute("data-placement");
      var select = tbody.querySelector('select[data-student="' + studentId + '"]');
      var supId = select ? select.value : "";
      if (!supId) {
        UI.showToast("error", "Select an active industrial supervisor first.");
        if (select) select.classList.add("is-error");
        return;
      }
      if (select) select.classList.remove("is-error");
      UI.setLoading(btn, true);
      try {
        var r = await fetch("/api/supervisor/assign", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + _session.access_token
          },
          body: JSON.stringify({
            placement_id: placementId,
            student_id: studentId,
            industrial_supervisor_id: supId
          })
        });
        var d = await r.json();
        if (!d.ok) throw new Error(d.error);
        UI.showToast("success", "Industrial supervisor assigned.");
        await loadStudents();
        renderStudents();
      } catch (err) {
        UI.showToast("error", err.message);
        UI.setLoading(btn, false);
      }
    });
  });
}

function _esc(s) {
  return String(s || "").replace(/[&<>"']/g, function (c) {
    return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
  });
}
