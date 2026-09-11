// נקודת קצה לכתיבה בלבד להגשת מועמדות מהאתר הציבורי (תרחיש 1).
// רצה כ-Supabase Edge Function עם service role, ולכן היחידה שרשאית לכתוב
// למסד מהאזור הציבורי. האתר הסטטי עצמו לעולם אינו נוגע במסד.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

// דומיינים מורשים להגשה מהדפדפן. דומיין ברירת המחדל של Cloudflare Workers
// ו/או כל דומיין נוסף מוגדרים דרך APPLY_ALLOW_ORIGIN (מופרד בפסיקים) —
// אין יותר דומיין אישי קבוע בקוד.
const ALLOW_ORIGINS = [
  "https://hr.ort-tech.co.il",
  "https://my.hr.ort-tech.co.il",
  ...(Deno.env.get("APPLY_ALLOW_ORIGIN") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean),
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

// נרמול טלפון ישראלי — זהה ל-app.normalize_phone (0022). מפתח הכפילות.
function normalizePhone(raw: string): string | null {
  let d = (raw || "").replace(/[^0-9+]/g, "");
  if (!d) return null;
  if (d.startsWith("+972")) d = "+972" + d.slice(4).replace(/^0/, "");
  else if (d.startsWith("972")) d = "+972" + d.slice(3).replace(/^0/, "");
  else if (d.startsWith("0")) d = "+972" + d.slice(1);
  if (/^\+972[2-9]\d{7,8}$/.test(d)) return d;          // מספר ישראלי תקין
  if (/^\+(?!972)[1-9]\d{7,14}$/.test(d)) return d;      // E.164 בינלאומי
  return null;
}

// אימות דוא"ל בסיסי (RFC-lite). ריק מותר (השדה אופציונלי).
function validEmail(e: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// זיהוי סוג קובץ לפי magic bytes — לא לסמוך על ההרחבה/ה-MIME שהדפדפן שולח.
function sniffFileType(bytes: Uint8Array): "pdf" | "docx" | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 &&
      bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "pdf"; // %PDF-
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return "docx"; // PK (zip → docx)
  return null;
}

function sanitizeName(name: string): string {
  return (name || "cv").replace(/[^\w.\-]+/g, "_").replace(/_{2,}/g, "_").slice(0, 100) || "cv";
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  // מקור לא מורשה — לא מעבדים גוף בקשה כלל.
  if (origin && !ALLOW_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: "forbidden_origin" }), { status: 403, headers });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method" }), { status: 405, headers });
  }

  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    console.error("apply: missing service key");
    return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500, headers });
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
    { db: { schema: "app" }, auth: { persistSession: false } },
  );

  // GET: שדות טופס ההגשה הפעיל (השאלות הנוספות שהמנהלת הגדירה).
  if (req.method === "GET") {
    const { data, error } = await db.rpc("site_apply_form");
    if (error) {
      console.error("apply: site_apply_form failed:", error.message);
      return new Response(JSON.stringify({ fields: [] }), { headers });
    }
    return new Response(JSON.stringify(data ?? { fields: [] }), { headers });
  }

  // ---- פענוח הגוף ----
  let body: Record<string, string> = {};
  let cv: File | null = null;
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      body = await req.json();
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") body[k] = v;
        else if (k === "cv" && v instanceof File && v.size > 0) cv = v;
      }
    }
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400, headers });
  }

  // Honeypot — בוט שמילא שדה נסתר. מחזירים הצלחה בלי לכתוב דבר.
  if ((body.company_website || "").trim() !== "") {
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  const full_name = (body.full_name || "").trim();
  const phone = normalizePhone(body.phone || "");
  const emailRaw = (body.email || "").trim();
  const email = emailRaw || null;
  const slug = (body.slug || "").trim();
  const consent = body.consent === "true" || body.consent === "on" || body.consent === "1";

  const missing: string[] = [];
  if (full_name.length < 2 || full_name.length > 120) missing.push("full_name");
  if (!phone) missing.push("phone");
  if (!consent) missing.push("consent");
  if (email && !validEmail(email)) missing.push("email");
  if (!slug) missing.push("slug");
  if (missing.length) {
    return new Response(JSON.stringify({ error: "missing_fields", fields: missing }), { status: 422, headers });
  }

  // ---- הגבלת קצב לפי גיבוב IP + מלח (לעולם לא IP גולמי) ----
  const salt = Deno.env.get("APPLY_IP_SALT") ?? serviceKey;
  const rawIp = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("cf-connecting-ip") || "";
  if (rawIp) {
    const ipHash = await sha256Hex(salt + ":" + rawIp);
    const { data: allowed, error: rlErr } = await db.rpc("public_submission_allowed",
      { p_ip_hash: ipHash, p_limit: 5, p_window_minutes: 10 });
    if (!rlErr && allowed === false) {
      return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers });
    }
  }

  // תשובות לשאלות הנוספות — JSON מוגבל ל-16KB.
  let extraAnswers: Record<string, unknown> = {};
  const extraRaw = body.extra_answers || "{}";
  if (extraRaw.length > 16384) {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400, headers });
  }
  try {
    const parsed = JSON.parse(extraRaw);
    if (parsed && typeof parsed === "object") extraAnswers = parsed;
  } catch { /* התעלמות מתשובות לא תקינות */ }

  // ---- ולידציית קובץ קורות חיים (לפני כל כתיבה) ----
  let cvBytes: Uint8Array | null = null;
  let cvKind: "pdf" | "docx" | null = null;
  if (cv) {
    const maxMb = await db.from("settings").select("value").eq("key", "files.max_size_mb").maybeSingle()
      .then((r) => { try { return Number(JSON.parse(r.data?.value ?? "10")); } catch { return 10; } });
    if (cv.size > (maxMb || 10) * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "file_too_large" }), { status: 413, headers });
    }
    cvBytes = new Uint8Array(await cv.arrayBuffer());
    cvKind = sniffFileType(cvBytes);
    const declaredOk = cv.type === "application/pdf" ||
      cv.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      cv.type === "" /* חלק מהדפדפנים לא שולחים MIME */;
    if (!cvKind || !declaredOk) {
      return new Response(JSON.stringify({ error: "file_type" }), { status: 415, headers });
    }
  }

  // ---- המשרה חייבת להיות מפורסמת ופתוחה ----
  const { data: pub, error: pubErr } = await db.from("job_publications")
    .select("job_id, status").eq("slug", slug).maybeSingle();
  if (pubErr) {
    console.error("apply: job_publications read failed:", pubErr.message);
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }
  if (!pub || pub.status !== "published") {
    return new Response(JSON.stringify({ error: "job_unavailable" }), { status: 404, headers });
  }
  const { data: job } = await db.from("jobs")
    .select("recruiter_id, stage").eq("id", pub.job_id).maybeSingle();
  if (!job || !["open", "on_hold"].includes(job.stage)) {
    return new Response(JSON.stringify({ error: "job_unavailable" }), { status: 404, headers });
  }

  // ---- מועמד (זיהוי כפילות לפי טלפון מנורמל) ----
  const { data: existing } = await db.from("candidates")
    .select("id").eq("phone_normalized", phone).is("anonymized_at", null).maybeSingle();

  let candidateId = existing?.id as string | undefined;
  if (!candidateId) {
    const { data: cand, error: cErr } = await db.from("candidates")
      .insert({ full_name, phone_normalized: phone, phone_raw: body.phone, email, source: "website" })
      .select("id").single();
    if (cErr) { console.error("apply: candidate insert:", cErr.message); return new Response(JSON.stringify({ error: "save_failed" }), { status: 500, headers }); }
    candidateId = cand.id;
  }

  // הסכמה
  await db.from("candidate_consents").upsert(
    [{ candidate_id: candidateId, kind: "data_use", granted: true, source: "website" }],
    { onConflict: "candidate_id,kind" },
  );

  // ---- מועמדות: insert-if-absent, לעולם לא לדרוס מועמדות קיימת ----
  const { data: existingApp } = await db.from("applications")
    .select("id").eq("candidate_id", candidateId).eq("job_id", pub.job_id).maybeSingle();

  let applicationId = existingApp?.id as string | undefined;
  let isNew = false;
  if (!applicationId) {
    const { data: appRow, error: aErr } = await db.from("applications")
      .insert({
        candidate_id: candidateId, job_id: pub.job_id, recruiter_id: job.recruiter_id ?? null,
        source: "website", stage: "new",
        ...(Object.keys(extraAnswers).length ? { answers: extraAnswers } : {}),
      }).select("id").single();
    if (aErr) { console.error("apply: application insert:", aErr.message); return new Response(JSON.stringify({ error: "save_failed" }), { status: 500, headers }); }
    applicationId = appRow.id;
    isNew = true;
  }

  // ---- העלאת קורות חיים לדלי הפרטי + רישום ב-documents ----
  if (cvBytes && cvKind) {
    const ext = cvKind === "pdf" ? "pdf" : "docx";
    const path = `${candidateId}/cv/${Date.now()}-${sanitizeName(cv!.name).replace(/\.(pdf|docx?)$/i, "")}.${ext}`;
    const mime = cvKind === "pdf" ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const up = await db.storage.from("candidate-docs").upload(path, cvBytes, { contentType: mime, upsert: false });
    if (up.error) {
      console.error("apply: cv upload:", up.error.message); // לא מפילים את ההגשה בגלל קובץ
    } else {
      const doc = await db.from("documents").insert({
        candidate_id: candidateId, kind: "cv", storage_path: path,
        file_name: sanitizeName(cv!.name), mime_type: mime, size_bytes: cvBytes.length,
      });
      if (doc.error) console.error("apply: document row:", doc.error.message);
    }
  }

  // ---- משימת טיפול למגייס — רק על מועמדות חדשה, בלי כפילות (M5) ----
  if (isNew && job.recruiter_id) {
    const { data: rule } = await db.from("automation_rules")
      .select("id, template_id").eq("event", "application_submitted").maybeSingle();
    const { data: task } = await db.from("tasks").insert({
      title: "לטפל בהגשה חדשה", priority: "normal", source: "automation",
      automation_rule_id: rule?.id ?? null, automation_entity_id: applicationId,
      due_at: new Date(Date.now() + 864e5).toISOString(),
    }).select("id").single();
    if (task) {
      await db.from("task_assignees").insert({ task_id: task.id, employee_id: job.recruiter_id });
      await db.from("task_links").insert({ task_id: task.id, entity_type: "application", entity_id: applicationId });
    }
  }

  // אין שום אינדיקציה לקיום המועמד במאגר (SPEC:209).
  return new Response(JSON.stringify({ ok: true }), { headers });
});
