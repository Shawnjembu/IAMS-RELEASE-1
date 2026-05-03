// public/placement.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute("student");
  if (!session) return;

  UI.renderNav("student", session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  try {
    var r = await fetch("/api/placements/my", {
      headers: { Authorization: "Bearer " + session.access_token }
    });
    var d = await r.json();

    if (d.ok && d.placement) {
      var p = d.placement;
      document.getElementById("pl-status").textContent = p.status || "—";
      document.getElementById("pl-status").className   = "badge-role " + (p.status === "assigned" ? "coordinator" : "student");

      // API returns p.org. Previous code checked p.profiles, which made the organisation show as blank.
      var orgName = p.org ? (p.org.full_name || p.org.email || "—") : "—";
      var orgExtra = p.org && p.org.extra ? p.org.extra : {};
      document.getElementById("pl-org").textContent = orgName;
      document.getElementById("pl-org-contact").textContent = orgExtra.contact_person || "—";
      document.getElementById("pl-org-phone").textContent = orgExtra.phone || "—";
      document.getElementById("pl-date").textContent   = p.assigned_at
        ? new Date(p.assigned_at).toLocaleDateString() : "—";

      var supervisors = p.supervisors || {};
      document.getElementById("pl-ind-sup").innerHTML = formatSupervisor(supervisors.industrial);
      document.getElementById("pl-uni-sup").innerHTML = formatSupervisor(supervisors.university);

      document.getElementById("placement-card").style.display = "";
    } else {
      document.getElementById("no-placement").style.display = "";
      renderAvailableOrgs(d.available_organisations || [], session.access_token);
    }
  } catch (err) {
    document.getElementById("no-placement").style.display = "";
    renderAvailableOrgs([], session.access_token, err.message);
  }

  function renderAvailableOrgs(orgs, token, errorMsg) {
    var wrap = document.getElementById("available-orgs");
    var alert = document.getElementById("choose-org-alert");
    if (!wrap) return;
    if (errorMsg) {
      wrap.innerHTML = '<p class="muted">Could not load organisations: ' + esc(errorMsg) + '</p>';
      return;
    }
    if (!orgs || !orgs.length) {
      wrap.innerHTML = '<div class="empty-state"><h3>No open organisation slots yet</h3><p class="muted">Please check again later or contact the coordinator if you believe organisations should be available.</p></div>';
      return;
    }
    wrap.innerHTML = orgs.map(function(o){
      return '<div class="org-choice-card" data-org-card="' + esc(o.id) + '">' +
        '<div>' +
          '<h3>' + esc(o.org_name || o.full_name || o.email) + '</h3>' +
          '<p class="muted small">' + esc(o.location || 'Location not specified') + (o.industry ? ' · ' + esc(o.industry) : '') + '</p>' +
          '<p class="small"><strong>Required skills:</strong> ' + esc(o.required_skills || 'Not specified') + '</p>' +
          '<p class="small muted">Available slots: ' + esc(o.available_slots) + '</p>' +
        '</div>' +
        '<button class="btn btn-primary" data-choose-org="' + esc(o.id) + '">Choose Organisation</button>' +
      '</div>';
    }).join('');
    wrap.querySelectorAll('[data-choose-org]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        if (!confirm('Choose this organisation for your attachment?')) return;
        UI.setLoading(btn, true);
        try {
          var resp = await fetch('/api/placements/my', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ org_id: btn.dataset.chooseOrg })
          });
          var data = await resp.json();
          if (!data.ok) throw new Error(data.error || 'Could not choose organisation');
          if (alert) { alert.className = 'alert alert-success'; alert.style.display = ''; alert.textContent = 'Organisation selected successfully. Reloading placement details…'; }
          setTimeout(function(){ window.location.reload(); }, 700);
        } catch (err) {
          if (alert) { alert.className = 'alert alert-error'; alert.style.display = ''; alert.textContent = err.message; }
          UI.setLoading(btn, false);
        }
      });
    });
  }

  function formatSupervisor(sup) {
    if (!sup || (!sup.full_name && !sup.email)) return "Not assigned yet";
    var extra = sup.extra || {};
    var parts = [
      '<strong>' + esc(sup.full_name || sup.email) + '</strong>',
      sup.email ? '<span class="small muted">' + esc(sup.email) + '</span>' : '',
      extra.phone ? '<span class="small muted">Phone: ' + esc(extra.phone) + '</span>' : '',
      extra.department ? '<span class="small muted">Department: ' + esc(extra.department) + '</span>' : '',
      extra.specialization ? '<span class="small muted">Specialization: ' + esc(extra.specialization) + '</span>' : ''
    ].filter(Boolean);
    return '<div style="display:flex;flex-direction:column;gap:2px">' + parts.join("") + '</div>';
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }
})();
