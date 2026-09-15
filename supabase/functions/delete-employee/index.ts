// מחיקה מלאה של משתמש: חשבון ההתחברות (auth.users) + כרטיס העובד. רצה עם
// service role, אך מאמתת שהקורא מורשה למחוק משתמשים (app.may_delete_user —
// מנהל על כברירת מחדל, ניתן להרחבה דרך מסך ההרשאות). אם לכרטיס יש רשומות
// עסקיות מקושרות (FK) — ההיסטוריה נשמרת: חשבון הכניסה מוסר והכרטיס מסומן
// 'הסתיים' במקום להימחק.
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
    if (uErr) console.error("delete-employee: getUser:", uErr.message);
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  const svc = createClient(url, serviceKey, { db: { schema: "app" }, auth: { persistSession: false } });

  // הרשאה: האם הקורא מורשה למחוק משתמשים (מנהל על כברירת מחדל / מטריצת ההרשאות).
  const may = await svc.rpc("may_delete_user", { p_actor: user.id });
  if (may.error) {
    console.error("delete-employee: may_delete_user:", may.error.message);
    return new Response(JSON.stringify({ error: "permission_check_failed" }), { status: 500, headers });
  }
  if (may.data !== true) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
  }

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const employeeId = (body.employee_id || "").trim();
  if (!employeeId) return new Response(JSON.stringify({ error: "missing_employee" }), { status: 422, headers });

  const emp = await svc.from("employees").select("id, email, user_id, role").eq("id", employeeId).maybeSingle();
  if (emp.error || !emp.data) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });

  // אי אפשר למחוק את המשתמש של עצמך.
  if (emp.data.user_id && emp.data.user_id === user.id) {
    return new Response(JSON.stringify({ error: "cannot_delete_self" }), { status: 409, headers });
  }

  // מחיקת מנהל על שמורה למנהל על בלבד (SPEC:118, כמו בהזמנה).
  if (emp.data.role === "superadmin") {
    const meRole = await svc.from("employees").select("role").eq("user_id", user.id).maybeSingle();
    if (meRole.data?.role !== "superadmin") {
      return new Response(JSON.stringify({ error: "forbidden_superadmin" }), { status: 403, headers });
    }
  }

  // 1) מחיקת חשבון ההתחברות אם קיים. ה-FK (on delete set null) מנתק את הכרטיס.
  if (emp.data.user_id) {
    const del = await svc.auth.admin.deleteUser(emp.data.user_id);
    if (del.error && !/not.*found/i.test(del.error.message ?? "")) {
      console.error("delete-employee: deleteUser:", del.error.message);
      return new Response(JSON.stringify({ error: "auth_delete_failed" }), { status: 500, headers });
    }
  }

  // 2) מחיקת כרטיס העובד. אם יש רשומות עסקיות מקושרות (FK restrict) —
  //    שומרים היסטוריה: מסמנים 'הסתיים' ומנתקים את הקישור.
  const delCard = await svc.from("employees").delete().eq("id", employeeId);
  if (delCard.error) {
    if ((delCard.error as { code?: string }).code === "23503") {
      const ended = await svc.from("employees")
        .update({ employment_status: "ended", user_id: null, invited_at: null })
        .eq("id", employeeId);
      if (ended.error) {
        console.error("delete-employee: end card:", ended.error.message);
        return new Response(JSON.stringify({ error: "card_update_failed" }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ ok: true, mode: "ended" }), { headers });
    }
    console.error("delete-employee: delete card:", delCard.error.message);
    return new Response(JSON.stringify({ error: "card_delete_failed" }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ ok: true, mode: "deleted" }), { headers });
});
