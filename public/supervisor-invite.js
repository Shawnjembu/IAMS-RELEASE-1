const params = new URLSearchParams(window.location.search);
const inviteToken = params.get("token") || "";
const alertEl = document.getElementById("invite-alert");

if (!inviteToken) {
  UI.showAlert(alertEl, "error", "Invite token is missing. Please open the full invite link.");
  document.getElementById("btnAccept").disabled = true;
}

document.getElementById("inviteForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  UI.hideAlert(alertEl);
  clearErr("password"); clearErr("confirmPassword");

  const full_name = document.getElementById("fullName").value.trim();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  let ok = true;
  if (password.length < 6) { setErr("password", "Password must be at least 6 characters."); ok = false; }
  if (!confirmPassword) { setErr("confirmPassword", "Please confirm your password."); ok = false; }
  else if (password !== confirmPassword) { setErr("confirmPassword", "Passwords do not match."); ok = false; }
  if (!ok) return;

  const btn = document.getElementById("btnAccept");
  UI.setLoading(btn, true);
  try {
    const r = await fetch("/api/supervisor/accept-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: inviteToken, password, full_name })
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Could not activate invite");
    UI.showAlert(alertEl, "success", "Account activated for " + d.email + ". Redirecting to login...");
    // Supervisors must sign in normally after activation. This prevents the invite flow
    // from accidentally opening the coordinator/organisation dashboard when a browser
    // still has an old session.
    try {
      sessionStorage.removeItem("iams_profile_cache");
      sessionStorage.removeItem("iams_extra_cache");
      if (window._sb) await window._sb.auth.signOut();
    } catch (_) {}
    setTimeout(() => { window.location.href = "/auth.html?activated=supervisor"; }, 1000);
  } catch (err) {
    UI.showAlert(alertEl, "error", err.message);
  } finally {
    UI.setLoading(btn, false);
  }
});

function setErr(id, msg) {
  document.getElementById(id).classList.add("is-error");
  document.getElementById(id + "-err").textContent = msg;
}
function clearErr(id) {
  document.getElementById(id).classList.remove("is-error");
  document.getElementById(id + "-err").textContent = "";
}
