// GET  /api/coordinator/supervisors  — list supervisors and pending invites
// POST /api/coordinator/supervisors  — invite a university supervisor by email
// Body: { email, full_name?, department?, specialization? }
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody } = require("../_shared");
function localBase(req){ const proto=(req.headers["x-forwarded-proto"]||"http").split(",")[0]; const host=req.headers.host||"localhost:3000"; return `${proto}://${host}`; }
function token(){ return crypto.randomBytes(24).toString("hex"); }
function isUniversitySupervisorEmail(email){ return /^[^\s@]+@ub\.ac\.bw$/i.test(String(email||"").trim()); }

module.exports = async function handler(req, res) {
  try {
    const auth=(req.headers.authorization||"").replace(/^Bearer\s+/i,"").trim();
    if(!auth) return send(res,401,{ok:false,error:"Missing auth token"});
    const supabaseUrl=process.env.SUPABASE_URL, anonKey=process.env.SUPABASE_PUBLISHABLE_KEY;
    if(!supabaseUrl||!anonKey) return send(res,500,{ok:false,error:"Missing env vars"});
    const userSb=createClient(supabaseUrl, anonKey,{global:{headers:{Authorization:`Bearer ${auth}`}}});
    const {data:authData,error:uerr}=await userSb.auth.getUser();
    if(uerr||!authData?.user) return send(res,401,{ok:false,error:uerr?uerr.message:"Invalid token"});
    const user=authData.user;
    const sb=adminClient();
    const {data:profile}=await sb.from("profiles").select("role").eq("id",user.id).single();
    if(!profile||profile.role!=="coordinator") return send(res,403,{ok:false,error:"Coordinator account required"});

    if(req.method==="GET"){
      const {data:profs,error}=await sb.from("profiles").select("id, role, full_name, email, created_at").in("role",["industrial_supervisor","university_supervisor"]).order("role").order("full_name");
      if(error) return send(res,500,{ok:false,error:error.message});
      const ids=(profs||[]).map(p=>p.id); let orgMap={};
      if(ids.length){
        const {data:spRows}=await sb.from("supervisor_profiles").select("id, org_id, department, specialization").in("id",ids);
        const orgIds=[...new Set((spRows||[]).map(sp=>sp.org_id).filter(Boolean))]; let orgProfileMap={};
        if(orgIds.length){ const {data:orgProfiles}=await sb.from("profiles").select("id, full_name, email").in("id",orgIds); (orgProfiles||[]).forEach(op=>orgProfileMap[op.id]=op); }
        (spRows||[]).forEach(sp=>{ orgMap[sp.id]={ org: sp.org_id ? (orgProfileMap[sp.org_id]||null) : null, department:sp.department, specialization:sp.specialization}; });
      }
      const supervisors=(profs||[]).map(p=>({...p, ...(orgMap[p.id]||{}), status:"active"}));
      const {data:invites}=await sb.from("supervisor_invites").select("id,email,full_name,supervisor_type,status,created_at,invite_link,expires_at").order("created_at",{ascending:false});
      return send(res,200,{ok:true,supervisors,invites:invites||[]});
    }

    if(req.method==="POST"){
      const body=await readBody(req);
      const role="university_supervisor";
      const email=String(body.email||"").trim();
      const full_name=String(body.full_name||"").trim()||null;
      if(!email) return send(res,400,{ok:false,error:"Supervisor email is required"});
      if(!isUniversitySupervisorEmail(email)) return send(res,400,{ok:false,error:"University supervisor email must end with @ub.ac.bw, for example email@ub.ac.bw."});
      const t=token(); const link=`${localBase(req)}/supervisor-invite.html?token=${encodeURIComponent(t)}`;
      const row={ email, full_name, supervisor_type:role, org_id:null, invited_by:user.id, token:t, invite_link:link };
      const {data:invite,error}=await sb.from("supervisor_invites").insert([row]).select("*").single();
      if(error) return send(res,500,{ok:false,error:error.message+" — run supabase_final_release_patch.sql if supervisor_invites is missing."});
      try{ await sb.auth.admin.inviteUserByEmail(email,{data:{role,full_name,invite_token:t}, redirectTo:link}); }catch(_){}
      return send(res,200,{ok:true,invite,invite_link:link,message:"University supervisor invite created. If Supabase email is configured, the email will be sent; otherwise copy the invite link."});
    }
    return send(res,405,{ok:false,error:"Method Not Allowed"});
  }catch(e){ return send(res,500,{ok:false,error:e.message}); }
};
