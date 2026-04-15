// public/students.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute("organization");
  if (!session) return;

  UI.renderNav("organization", session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  try {
    var r = await fetch("/api/organization/students", {
      headers: { Authorization: "Bearer " + session.access_token }
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error);

    var students = d.students || [];
    document.getElementById("student-count").textContent = students.length + " student" + (students.length !== 1 ? "s" : "");

    if (students.length === 0) {
      document.getElementById("no-students").style.display = "";
      return;
    }

    document.getElementById("students-list").style.display = "";

    var tbody = document.getElementById("students-tbody");
    tbody.innerHTML = students.map(function (s) {
      var assignedDate = s.assigned_at ? new Date(s.assigned_at).toLocaleDateString() : "—";
      var displayName = s.full_name ? _esc(s.full_name) : _esc(s.email);
      var logbookPct  = Math.round((s.logbook_count || 0) / 12 * 100);
      return [
        "<tr>",
        "  <td>",
        "    <strong>" + displayName + "</strong>",
        s.full_name ? "<br><span class='small muted'>" + _esc(s.email) + "</span>" : "",
        "  </td>",
        "  <td>" + assignedDate + "</td>",
        "  <td>" + (s.logbook_count || 0) + " / 12 <span class='small muted'>(" + logbookPct + "%)</span></td>",
        "  <td>",
        "    <a href='/logbook-review.html?student=" + encodeURIComponent(s.student_id) + "' class='btn btn-secondary btn-sm'>View Logbook</a>",
        "  </td>",
        "</tr>"
      ].join("");
    }).join("");

  } catch (err) {
    document.getElementById("page-content").innerHTML =
      '<div class="alert alert-error">Could not load students: ' + _esc(err.message) + '</div>';
  }

  function _esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }
})();
