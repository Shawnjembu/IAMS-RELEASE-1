// Run once to create a coordinator account:
//   node create-coordinator.js
const fs = require("fs"), path = require("path");

// Load .env
fs.readFileSync(path.join(__dirname, ".env"), "utf-8")
  .split("\n").forEach(line => {
    const i = line.indexOf("=");
    if (i < 1) return;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  });

const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const EMAIL    = "coordinator@iams.test";
const PASSWORD = "coord1234";
const NAME     = "Test Coordinator";

(async () => {
  // 1. Create auth user
  const { data: { user }, error: e1 } = await sb.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
    user_metadata: { role: "coordinator", full_name: NAME }
  });
  if (e1 && !e1.message.includes("already been registered")) {
    console.error("Auth error:", e1.message); process.exit(1);
  }

  // 2. Upsert profile
  const uid = user ? user.id : (await (async () => {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 500 });
    return data.users.find(u => u.email === EMAIL)?.id;
  })());

  const { error: e2 } = await sb.from("profiles")
    .upsert([{ id: uid, role: "coordinator", email: EMAIL, full_name: NAME }], { onConflict: "id" });
  if (e2) { console.error("Profile error:", e2.message); process.exit(1); }

  console.log("Coordinator account ready!");
  console.log("  Email   :", EMAIL);
  console.log("  Password:", PASSWORD);
  console.log("  Login at: http://localhost:3000/auth.html");
})();
