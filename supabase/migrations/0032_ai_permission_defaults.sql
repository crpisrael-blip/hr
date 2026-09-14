-- 0032 · הרשאת ניתוח קו״ח ב-AI (מודול ai_analysis).
-- הפעולה המשמעותית היא create = הרצת ניתוח. effective_scope מחזיר 'all'
-- למנהלת/מנהל-על על הכול; שורות אלה נזרעות כדי שהתא יוצג במטריצה ושאפשר יהיה
-- להעניק/לשלול למגייס. מגייס מקבל create='all' כברירת מחדל — שמירה על ההתנהגות
-- שהייתה (כל עובד פעיל יכול לנתח). מנהלת יכולה לצמצם דרך המטריצה/override.
-- הפונקציה analyze-cv אוכפת זאת בצד-שרת דרך app.has_permission('ai_analysis','create').

insert into app.permission_defaults (role, module, action, scope)
select r, 'ai_analysis'::app.perm_module, a, 'none'::app.perm_scope
from unnest(array['recruiter','manager','superadmin']::app.user_role[]) r
cross join unnest(enum_range(null::app.perm_action)) a
on conflict (role, module, action) do nothing;

update app.permission_defaults set scope = 'all'
 where module = 'ai_analysis' and role in ('manager','superadmin')
   and action in ('view','create');

update app.permission_defaults set scope = 'all'
 where module = 'ai_analysis' and role = 'recruiter' and action = 'create';
