// public/matching.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute("coordinator");
  if (!session) return;

  UI.renderNav("coordinator", session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  var alertEl  = document.getElementById("match-alert");
  var allOrgs  = [];
  var allData  = {};

  async function load() {
    try {
      var r = await apiFetch("GET", "/api/coordinator/matching");
      if (!r.ok) throw new Error(r.error);

      allOrgs = r.orgs || [];
      allData = r;

      // Student dropdown (unassigned only)
      var selStudent = document.getElementById("sel-student");
      selStudent.innerHTML = '<option value="">Select student…</option>';
      (r.students || []).filter(function (s) { return !s.placement; }).forEach(function (s) {
        var o = document.createElement("option");
        o.value = s.student_id;
        o.textContent = (s.full_name || s.email);
        selStudent.appendChild(o);
      });

      // Org dropdown
      var selOrg = document.getElementById("sel-org");
      selOrg.innerHTML = '<option value="">Select organisation…</option>';
      allOrgs.forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o.id;
        opt.textContent = (o.extra && o.extra.org_name) ? o.extra.org_name + " (" + o.email + ")" : o.email;
        selOrg.appendChild(opt);
      });

      renderTable(r.students || []);
    } catch (err) {
      document.getElementById("match-tbody").innerHTML =
        '<tr><td colspan="7" class="muted small text-center">Error: ' + _esc(err.message) + '</td></tr>';
    }
  }

  function renderTable(students) {
    var tbody = document.getElementById("match-tbody");
    if (!students || students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted small text-center">No students found.</td></tr>';
      return;
    }

    // Build org name map
    var orgMap = {};
    allOrgs.forEach(function (o) {
      orgMap[o.id] = (o.extra && o.extra.org_name) ? o.extra.org_name : o.email;
    });

    tbody.innerHTML = students.map(function (s) {
      var p           = s.placement;
      var status      = p
        ? '<span class="badge-role coordinator">assigned</span>'
        : '<span class="badge-role student">unassigned</span>';
      var assignedTo  = p ? _esc(orgMap[p.org_id] || p.org_id) : "—";
      var score       = p && p.match_score != null ? p.match_score + "%" : "—";
      var prog        = s.extra ? _esc(s.extra.program || "—") : "—";

      var topSug = "—";
      if (s.suggestions && s.suggestions.length) {
        var sg = s.suggestions[0];
        topSug = _esc(sg.org_name || sg.org_email) + " (" + sg.score + "%)";
        if (sg.explanation) topSug += '<br><span class="small muted" style="font-weight:400">' + _esc(sg.explanation) + '</span>';
      }

      var actions = p
        ? '<button class="btn btn-secondary btn-sm" data-remove="' + p.id + '">Remove</button>'
        : (s.suggestions && s.suggestions.length
            ? '<button class="btn btn-secondary btn-sm" data-quick-assign data-sid="' + s.student_id + '" data-oid="' + s.suggestions[0].org_id + '">Quick Assign</button>'
            : "");

      return '<tr>' +
        '<td><div>' + _esc(s.full_name || s.email) + '</div><div class="small muted">' + _esc(s.email) + '</div></td>' +
        '<td>' + prog + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' + assignedTo + '</td>' +
        '<td>' + score + '</td>' +
        '<td class="small">' + topSug + '</td>' +
        '<td>' + actions + '</td>' +
        '</tr>';
    }).join("");

    // Remove buttons
    tbody.querySelectorAll("[data-remove]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        if (!confirm("Remove this placement?")) return;
        UI.setLoading(btn, true);
        try {
          var r2 = await apiFetch("DELETE", "/api/coordinator/matching?placement_id=" + encodeURIComponent(btn.dataset.remove));
          if (!r2.ok) throw new Error(r2.error);
          UI.showAlert(alertEl, "success", "Placement removed.");
          await load();
        } catch (err) {
          UI.showAlert(alertEl, "error", "Error: " + err.message);
          UI.setLoading(btn, false);
        }
      });
    });

    // Quick-assign buttons
    tbody.querySelectorAll("[data-quick-assign]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        UI.setLoading(btn, true);
        try {
          var r2 = await apiFetch("POST", "/api/coordinator/matching", {
            student_id: btn.dataset.sid,
            org_id:     btn.dataset.oid,
          });
          if (!r2.ok) throw new Error(r2.error);
          UI.showAlert(alertEl, "success", "Student assigned.");
          await load();
        } catch (err) {
          UI.showAlert(alertEl, "error", "Error: " + err.message);
          UI.setLoading(btn, false);
        }
      });
    });
  }

  load();

  // ── Search ──
  document.getElementById("match-search").addEventListener("input", function () {
    var q = this.value.toLowerCase();
    var filtered = (allData.students || []).filter(function (s) {
      return (s.email || "").toLowerCase().includes(q) ||
             (s.full_name || "").toLowerCase().includes(q) ||
             (s.extra && (s.extra.program || "").toLowerCase().includes(q));
    });
    renderTable(filtered);
  });

  // ── Manual Assign form ──
  document.getElementById("assignForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    UI.hideAlert(alertEl);

    var studentId = document.getElementById("sel-student").value;
    var orgId     = document.getElementById("sel-org").value;
    var reason    = document.getElementById("inp-reason").value.trim();

    if (!studentId) { UI.showAlert(alertEl, "error", "Please select a student."); return; }
    if (!orgId)     { UI.showAlert(alertEl, "error", "Please select an organisation."); return; }

    var btn = document.getElementById("btnAssign");
    UI.setLoading(btn, true);
    try {
      var r = await apiFetch("POST", "/api/coordinator/matching", {
        student_id:      studentId,
        org_id:          orgId,
        override_reason: reason || null,
      });
      if (!r.ok) throw new Error(r.error);
      UI.showAlert(alertEl, "success", "Student assigned (match score: " + r.placement.match_score + "%).");
      document.getElementById("assignForm").reset();
      await load();
    } catch (err) {
      UI.showAlert(alertEl, "error", "Error: " + err.message);
    } finally {
      UI.setLoading(btn, false);
    }
  });

  // ── Auto-match ──
  document.getElementById("btnAutoMatch").addEventListener("click", async function () {
    if (!confirm("This will auto-assign ALL unassigned students to their best-match organisations. Continue?")) return;
    var btn = this;
    UI.setLoading(btn, true);
    UI.hideAlert(alertEl);
    try {
      var r = await apiFetch("POST", "/api/coordinator/matching?action=auto", {});
      if (!r.ok) throw new Error(r.error);
      UI.showAlert(alertEl, "success", r.assigned_count + " student(s) auto-matched.");
      await load();
    } catch (err) {
      UI.showAlert(alertEl, "error", "Error: " + err.message);
    } finally {
      UI.setLoading(btn, false);
    }
  });

  async function apiFetch(method, path, body) {
    var opts = {
      method: method,
      headers: { Authorization: "Bearer " + session.access_token }
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
})();
