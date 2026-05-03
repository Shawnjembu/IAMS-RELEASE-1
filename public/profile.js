const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute();
  if (!session) return;
  var role = window._userProfile && window._userProfile.role;
  var routes = {
    student: "/student-profile.html",
    organization: "/org-profile.html",
    coordinator: "/coordinator-profile.html",
    industrial_supervisor: "/supervisor-profile.html",
    university_supervisor: "/supervisor-profile.html"
  };
  window.location.replace(routes[role] || "/dashboard.html");
})();
