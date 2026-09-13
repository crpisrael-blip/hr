// הזמנת עובד/מגייס לכניסה למערכת. רצה עם service role, אך מאמתת שהקורא
// הוא מנהלת/מנהל על פעיל לפני כל פעולה. שולחת מייל הזמנה (Supabase Auth)
// ומקשרת את חשבון ההתחברות לכרטיס העובד הקיים.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const ALLOW_ORIGINS = [
  "https://hr-app.ort-tech.co.il",
  ...(Deno.env.get("INVITE_ALLOW_ORIGIN") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean),
];

function cors(origin: string | null) {
  const allow = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "Content-Type": "application/json; charset=utf-8" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (origin && !ALLOW_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: "forbidden_origin" }), { status: 403, headers });
  }
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500, headers });

  // זהות הקורא — מהטוקן שנשלח מהאפליקציה.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const userClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data: { user }, error: uErr } = await userClient.auth.getUser(token);
  if (!user) {
    if (uErr) console.error("invite: getUser:", uErr.message);
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  const svc = createClient(url, serviceKey, { db: { schema: "app" }, auth: { persistSession: false } });

  // אימות שהקורא מנהלת/מנהל על פעיל.
  const me = await svc.from("employees").select("role, employment_status").eq("user_id", user.id).maybeSingle();
  if (me.error) console.error("invite: caller lookup:", me.error.message);
  const callerRole = me.data?.role ?? null;
  if (!me.data || me.data.employment_status !== "active" ||
      !["manager", "superadmin"].includes(callerRole)) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
  }

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const employeeId = (body.employee_id || "").trim();
  if (!employeeId) return new Response(JSON.stringify({ error: "missing_employee" }), { status: 422, headers });

  const emp = await svc.from("employees").select("id, email, user_id, role").eq("id", employeeId).maybeSingle();
  if (emp.error || !emp.data) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
  if (emp.data.user_id) return new Response(JSON.stringify({ error: "already_linked" }), { status: 409, headers });

  // רק מנהל על רשאי להזמין מנהל על (SPEC:118).
  if (emp.data.role === "superadmin" && callerRole !== "superadmin") {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
  }

  const redirectTo = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  const inv = await svc.auth.admin.inviteUserByEmail(emp.data.email, { redirectTo });
  if (inv.error || !inv.data?.user) {
    console.error("invite: inviteUserByEmail:", inv.error?.message);
    return new Response(JSON.stringify({ error: "invite_failed" }), { status: 500, headers });
  }

  const link = await svc.from("employees")
    .update({ user_id: inv.data.user.id, invited_at: new Date().toISOString() }).eq("id", employeeId);
  if (link.error) {
    console.error("invite: link update:", link.error.message);
    return new Response(JSON.stringify({ error: "link_failed" }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ ok: true }), { headers });
});
