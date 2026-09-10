// נקודת קצה לכתיבה בלבד להגשת מועמדות מהאתר הציבורי (תרחיש 1).
// רצה כ-Supabase Edge Function עם service role, ולכן היחידה שרשאית לכתוב
// למסד מהאזור הציבורי. האתר הסטטי עצמו לעולם אינו נוגע במסד.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

// דומיינים מורשים להגשה מהדפדפן. כולל את הדומיינים בייצור וגם את כתובת
// ברירת המחדל של Cloudflare Workers (עד שהדומיין המותאם מחובר). ניתן
// להוסיף דומיין נוסף דרך משתנה הסביבה APPLY_ALLOW_ORIGIN בלי לשנות קוד.
const ALLOW_ORIGINS = [
  "https://hr.ort-tech.co.il",
  "https://my.hr.ort-tech.co.il",
  "https://hr-public-site.menahemtzik1.workers.dev",
  Deno.env.get("APPLY_ALLOW_ORIGIN") ?? "",
].filter(Boolean);

function cors(origin: string | null) {
  const allow = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

// נרמול טלפון ישראלי לפורמט אחיד — מפתח הכפילות.
function normalizePhone(raw: string): string | null {
  const d = (raw || "").replace(/[^\d+]/g, "");
  if (!d) return null;
  if (d.startsWith("+972")) return "+972" + d.slice(4).replace(/^0/, "");
  if (d.startsWith("972")) return "+972" + d.slice(3).replace(/^0/, "");
  if (d.startsWith("0")) return "+972" + d.slice(1);
  return d;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "Content-Type": "application/json; charset=utf-8" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method" }), { status: 405, headers });
  }

  // מפתח שירות: תומך בפורמט המפתחות החדש (sb_secret_ דרך SERVICE_ROLE_KEY)
  // עם נפילה חזרה למפתח ה-service_role הישן שמוזרק אוטומטית.
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    console.error("apply: missing service key (SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY)");
    return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500, headers });
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
    { db: { schema: "app" }, auth: { persistSession: false } },
  );

  // GET: מחזיר את שדות טופס ההגשה הפעיל (השאלות הנוספות שהמנהלת הגדירה
  // במערכת). האתר הסטטי מרנדר אותם מתחת לשדות הבסיס. אם אין טופס פעיל —
  // מחזיר רשימה ריקה, והטופס הבסיסי ממשיך לעבוד כרגיל.
  if (req.method === "GET") {
    const { data, error } = await db.rpc("site_apply_form");
    if (error) {
      console.error("apply: site_apply_form failed:", error.message);
      return new Response(JSON.stringify({ fields: [] }), { headers });
    }
    return new Response(JSON.stringify(data ?? { fields: [] }), { headers });
  }

  let body: Record<string, string> = {};
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      body = await req.json();
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) if (typeof v === "string") body[k] = v;
    }
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400, headers });
  }

  const full_name = (body.full_name || "").trim();
  const phone = normalizePhone(body.phone || "");
  const email = (body.email || "").trim() || null;
  const slug = (body.slug || "").trim();
  const consent = body.consent === "true" || body.consent === "on" || body.consent === "1";

  if (!full_name || !phone || !consent) {
    return new Response(JSON.stringify({ error: "missing_fields" }), { status: 422, headers });
  }

  // תשובות לשאלות הנוספות (מטופס ההגשה שהוגדר במערכת). נשמרות כ-JSON.
  let extraAnswers: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(body.extra_answers || "{}");
    if (parsed && typeof parsed === "object") extraAnswers = parsed;
  } catch { /* התעלמות מתשובות לא תקינות — לא מפילים הגשה */ }

  // המשרה חייבת להיות מפורסמת. אין חשיפת מידע על קיום מאגר למבקר.
  const { data: pub, error: pubErr } = await db.from("job_publications")
    .select("job_id, status").eq("slug", slug).maybeSingle();
  if (pubErr) {
    console.error("apply: job_publications read failed:", pubErr.message);
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }
  if (!pub || pub.status !== "published") {
    return new Response(JSON.stringify({ error: "job_unavailable" }), { status: 404, headers });
  }

  // זיהוי כפילות לפי טלפון מנורמל.
  const { data: existing } = await db.from("candidates")
    .select("id, owner_employee_id").eq("phone_normalized", phone).is("anonymized_at", null).maybeSingle();

  let candidateId = existing?.id as string | undefined;
  if (!candidateId) {
    const { data: cand, error: cErr } = await db.from("candidates")
      .insert({ full_name, phone_normalized: phone, phone_raw: body.phone, email, source: "website" })
      .select("id").single();
    if (cErr) return new Response(JSON.stringify({ error: "save_failed" }), { status: 500, headers });
    candidateId = cand.id;
  }

  // הסכמות
  await db.from("candidate_consents").upsert([
    { candidate_id: candidateId, kind: "data_use", granted: true, source: "website" },
  ], { onConflict: "candidate_id,kind" });

  // מציאת המשרה והמגייס האחראי
  const { data: job } = await db.from("jobs").select("recruiter_id").eq("id", pub.job_id).maybeSingle();

  // מועמדות — לחיצה כפולה/הגשה חוזרת לא תיצור כפילות (unique candidate+job)
  const { data: appRow, error: aErr } = await db.from("applications")
    .upsert({ candidate_id: candidateId, job_id: pub.job_id, recruiter_id: job?.recruiter_id ?? null,
              source: "website", stage: "new",
              ...(Object.keys(extraAnswers).length ? { answers: extraAnswers } : {}) },
            { onConflict: "candidate_id,job_id" })
    .select("id").single();
  if (aErr) return new Response(JSON.stringify({ error: "save_failed" }), { status: 500, headers });

  // משימת טיפול למגייס האחראי (מימוש כלל האוטומציה "הגשה חדשה")
  if (job?.recruiter_id) {
    const { data: task } = await db.from("tasks").insert({
      title: "לטפל בהגשה חדשה", priority: "normal", source: "automation",
      due_at: new Date(Date.now() + 864e5).toISOString(),
    }).select("id").single();
    if (task) {
      await db.from("task_assignees").insert({ task_id: task.id, employee_id: job.recruiter_id });
      await db.from("task_links").insert({ task_id: task.id, entity_type: "application", entity_id: appRow.id });
    }
  }

  return new Response(JSON.stringify({ ok: true, duplicate: !!existing }), { headers });
});
