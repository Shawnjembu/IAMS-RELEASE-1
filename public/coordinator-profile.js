const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute("coordinator");
  if (!session) return;
  var profile = window._userProfile || {};
  UI.renderNav("coordinator", session.user.email);

  document.getElementById("coordName").value = profile.full_name || "";
  document.getElementById("coordEmail").value = profile.email || session.user.email || "";
  document.getElementById("coordPhone").value = profile.phone || "";

  var uploadedAvatarUrl = profile.avatar_url || "";
  renderAvatar(uploadedAvatarUrl, profile.full_name || profile.email || session.user.email);

  var input = document.getElementById("coordAvatar");
  input.addEventListener("change", async function () {
    var file = input.files && input.files[0];
    if (!file) return;
    document.getElementById("coordAvatarName").textContent = file.name;
    renderAvatar(URL.createObjectURL(file), profile.full_name || session.user.email);
    try {
      var sign = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ filename: file.name, content_type: file.type, size: file.size, kind:"profile" || "image/jpeg" })
      });
      var signed = await sign.json();
      if (!signed.ok) throw new Error(signed.error || "Could not prepare upload");
      var up = await fetch(signed.upload_url, { method:"PUT", headers:{ "Content-Type": file.type || "application/octet-stream", "x-upsert":"true" }, body:file });
      if (!up.ok) throw new Error("Image upload failed");
      uploadedAvatarUrl = signed.download_url || signed.public_url || "";
    } catch (err) {
      UI.showToast("error", "Profile image upload failed: " + err.message);
      renderAvatar(profile.avatar_url || "", profile.full_name || session.user.email);
    }
  });

  document.getElementById("coordForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var alertEl = document.getElementById("coord-alert");
    var btn = document.getElementById("btnSaveCoord");
    UI.hideAlert(alertEl);
    var name = document.getElementById("coordName").value.trim();
    if (!name) {
      var el = document.getElementById("coordName");
      var er = document.getElementById("coordName-err");
      if (el) el.classList.add("is-error");
      if (er) er.textContent = "Full name is required.";
      return;
    }
    var updates = { full_name: name, phone: document.getElementById("coordPhone").value.trim() };
    if (uploadedAvatarUrl) updates.avatar_url = uploadedAvatarUrl;
    UI.setLoading(btn, true);
    try {
      var r = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ role: "coordinator", updates: updates })
      });
      var d = await r.json().catch(function () { return { ok:false, error:"Invalid server response" }; });
      if (!r.ok || !d.ok) throw new Error(d.error || "Could not save coordinator profile");
      if (window._userProfile) Object.assign(window._userProfile, updates);
      try { sessionStorage.setItem("iams_profile_cache", JSON.stringify(window._userProfile || null)); } catch (_) {}
      UI.showAlert(alertEl, "success", "Coordinator profile saved successfully.");
      UI.showToast("success", "Profile updated.");
      renderAvatar(uploadedAvatarUrl, name);
    } catch (err) {
      UI.showAlert(alertEl, "error", err.message || "Failed to save profile.");
      UI.showToast("error", err.message || "Save failed.");
    } finally {
      UI.setLoading(btn, false);
    }
  });

  function renderAvatar(url, fallbackName) {
    var el = document.getElementById("coordAvatarPreview");
    if (!el) return;
    if (url) el.innerHTML = '<img src="' + esc(url) + '" alt="Profile image" style="width:100%;height:100%;object-fit:cover"/>';
    else {
      var initials = String(fallbackName || "C").trim().split(/\s+/).slice(0,2).map(function(x){ return x.charAt(0); }).join("").toUpperCase() || "C";
      el.textContent = initials;
    }
  }
  function esc(s) { return String(s || "").replace(/[&<>\"']/g, function(c){ return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
})();
