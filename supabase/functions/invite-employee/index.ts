// הזמנת עובד/מגייס לכניסה למערכת. רצה עם service role, אך מאמתת שהקורא
// הוא מנהלת/מנהל על לפני כל פעולה. שולחת מייל הזמנה (Supabase Auth) ומקשרת
// את חשבון ההתחברות לכרטיס העובד הקיים.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const ALLOW_ORIGINS = [
  "https://hr-app.ort-tech.co.il",
];

function cors(origin: string | null) {
  const allow = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "Content-Type": "application/json; charset=utf-8" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500, headers });

  // זהות הקורא — מהטוקן שנשלח מהאפליקציה.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });

  const svc = createClient(url, serviceKey, { db: { schema: "app" }, auth: { persistSession: false } });

  // אימות שהקורא מנהלת/מנהל על.
  const me = await svc.from("employees").select("role").eq("user_id", user.id).maybeSingle();
  if (!me.data || !["manager", "superadmin"].includes(me.data.role)) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
  }

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const employeeId = (body.employee_id || "").trim();
  if (!employeeId) return new Response(JSON.stringify({ error: "missing_employee" }), { status: 422, headers });

  const emp = await svc.from("employees").select("id, email, user_id").eq("id", employeeId).maybeSingle();
  if (emp.error || !emp.data) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
  if (emp.data.user_id) return new Response(JSON.stringify({ error: "already_linked" }), { status: 409, headers });

  const redirectTo = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  const inv = await svc.auth.admin.inviteUserByEmail(emp.data.email, { redirectTo });
  if (inv.error || !inv.data?.user) {
    console.error("invite failed:", inv.error?.message);
    return new Response(JSON.stringify({ error: "invite_failed", detail: inv.error?.message }), { status: 500, headers });
  }

  const link = await svc.from("employees").update({ user_id: inv.data.user.id, invited_at: new Date().toISOString() }).eq("id", employeeId);
  if (link.error) return new Response(JSON.stringify({ error: "link_failed", detail: link.error.message }), { status: 500, headers });

  return new Response(JSON.stringify({ ok: true }), { headers });
});
