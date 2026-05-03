const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute();
  if (!session) return;

  var profile = window._userProfile || {};
  var extra = window._userExtra || {};
  var role = profile.role;
  if (role !== "industrial_supervisor" && role !== "university_supervisor") {
    UI.showToast("error", "This profile page is for supervisors only.");
    window.location.replace("/dashboard.html");
    return;
  }

  UI.renderNav(role, session.user.email);

  var roleLabel = role === "industrial_supervisor" ? "Industrial Supervisor" : "University Supervisor";
  document.getElementById("profile-subtitle").textContent = roleLabel + " account details.";
  document.getElementById("supervisor-role-title").textContent = roleLabel;
  document.getElementById("supervisor-role-desc").textContent = role === "industrial_supervisor"
    ? "Supervise workplace performance and communicate with assigned students. Academic report and logbook reviews are handled by university supervisors."
    : "Review assigned students' reports and logbooks, set student submission deadlines, record visits, and provide academic feedback.";

  if (role === "industrial_supervisor") {
    document.getElementById("industrialOrgRow").style.display = "";
    document.getElementById("supOrg").value = extra.org_name || "Linked organisation not loaded";
  }

  document.getElementById("supName").value = profile.full_name || "";
  document.getElementById("supEmail").value = profile.email || session.user.email || "";
  document.getElementById("supRole").value = roleLabel;
  document.getElementById("supPhone").value = profile.phone || extra.phone || "";
  document.getElementById("supDepartment").value = extra.department || "";
  document.getElementById("supSpecialization").value = extra.specialization || extra.specialisation || "";

  var uploadedAvatarUrl = profile.avatar_url || "";
  renderAvatar(uploadedAvatarUrl, profile.full_name || profile.email || session.user.email);

  var avatarInput = document.getElementById("supAvatar");
  avatarInput.addEventListener("change", async function () {
    var file = avatarInput.files && avatarInput.files[0];
    if (!file) return;
    document.getElementById("supAvatarName").textContent = file.name;
    renderAvatar(URL.createObjectURL(file), profile.full_name || session.user.email);
    try {
      var sign = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ filename: file.name, content_type: file.type, size: file.size, kind:"profile" || "image/jpeg" })
      });
      var signed = await sign.json();
      if (!signed.ok) throw new Error(signed.error || "Could not prepare upload");
      var up = await fetch(signed.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
        body: file
      });
      if (!up.ok) throw new Error("Image upload failed");
      uploadedAvatarUrl = signed.download_url || signed.public_url || "";
    } catch (err) {
      UI.showToast("error", "Profile image upload failed: " + err.message);
      renderAvatar(profile.avatar_url || "", profile.full_name || session.user.email);
    }
  });

  document.getElementById("supervisorForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var alertEl = document.getElementById("supervisor-alert");
    var btn = document.getElementById("btnSaveSupervisor");
    UI.hideAlert(alertEl);
    clearErrors();

    var fullName = document.getElementById("supName").value.trim();
    if (!fullName) {
      setErr("supName", "Full name is required.");
      return;
    }

    var phone = document.getElementById("supPhone").value.trim();
    var department = document.getElementById("supDepartment").value.trim();
    var specialization = document.getElementById("supSpecialization").value.trim();

    var updates = { full_name: fullName, phone: phone };
    if (uploadedAvatarUrl) updates.avatar_url = uploadedAvatarUrl;

    var extraPayload = { phone: phone, department: department, specialization: specialization };

    UI.setLoading(btn, true);
    try {
      var r = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ role: role, updates: updates, extra: extraPayload })
      });
      var d = await r.json().catch(function () { return { ok:false, error:"Invalid server response" }; });
      if (!r.ok || !d.ok) throw new Error(d.error || "Could not save supervisor profile");

      if (window._userProfile) Object.assign(window._userProfile, updates);
      if (window._userExtra) Object.assign(window._userExtra, extraPayload);
      try {
        sessionStorage.setItem("iams_profile_cache", JSON.stringify(window._userProfile || null));
        sessionStorage.setItem("iams_extra_cache", JSON.stringify(window._userExtra || null));
      } catch (_) {}

      UI.showAlert(alertEl, "success", "Supervisor profile saved successfully.");
      UI.showToast("success", "Profile updated.");
      renderAvatar(uploadedAvatarUrl, fullName);
    } catch (err) {
      UI.showAlert(alertEl, "error", err.message || "Failed to save profile.");
      UI.showToast("error", err.message || "Save failed.");
    } finally {
      UI.setLoading(btn, false);
    }
  });

  function renderAvatar(url, fallbackName) {
    var el = document.getElementById("supAvatarPreview");
    if (!el) return;
    if (url) el.innerHTML = '<img src="' + esc(url) + '" alt="Profile image" style="width:100%;height:100%;object-fit:cover"/>';
    else {
      var initials = String(fallbackName || "S").trim().split(/\s+/).slice(0,2).map(function(x){ return x.charAt(0); }).join("").toUpperCase() || "S";
      el.textContent = initials;
    }
  }
  function setErr(id, msg) {
    var el = document.getElementById(id);
    var err = document.getElementById(id + "-err");
    if (el) el.classList.add("is-error");
    if (err) err.textContent = msg;
  }
  function clearErrors() {
    ["supName"].forEach(function (id) {
      var el = document.getElementById(id);
      var err = document.getElementById(id + "-err");
      if (el) el.classList.remove("is-error");
      if (err) err.textContent = "";
    });
  }
  function esc(s) {
    return String(s || "").replace(/[&<>\"']/g, function(c) {
      return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];
    });
  }
})();
