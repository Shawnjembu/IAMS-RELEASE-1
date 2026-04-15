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
      document.getElementById("pl-status").textContent = p.status;
      document.getElementById("pl-status").className   = "badge-role " + (p.status === "assigned" ? "coordinator" : "student");
      var orgName = p.profiles
        ? (p.profiles.full_name || p.profiles.email || "—")
        : "—";
      document.getElementById("pl-org").textContent = orgName;
      document.getElementById("pl-date").textContent   = p.assigned_at
        ? new Date(p.assigned_at).toLocaleDateString() : "—";
      document.getElementById("placement-card").style.display = "";
    } else {
      document.getElementById("no-placement").style.display = "";
    }
  } catch (_) {
    document.getElementById("no-placement").style.display = "";
  }
})();
