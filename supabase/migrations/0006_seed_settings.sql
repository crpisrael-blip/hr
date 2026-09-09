-- 0006 · ערכי התחלה. הכול ניתן לעריכה מתוך המערכת ואינו נעול בקוד.

-- ---------- הגדרות ארגון ----------
insert into app.settings (key, value, description) values
  ('candidates.pool_scope',        '"all"',        'היקף המגייס במודול מועמדים: all = מאגר משותף'),
  ('security.session_timeout_min', '480',          'פקיעת session לצוות בדקות'),
  ('security.require_2fa_recruiter','false',       'חיוב אימות דו־שלבי גם למגייסים'),
  ('files.allowed_mime',           '["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]', 'סוגי קובץ מותרים'),
  ('files.max_size_mb',            '10',           'גודל קובץ מרבי'),
  ('candidate_area.chat_enabled',  'true',         'שיחה עם המגייס פעילה באזור האישי'),
  ('candidate_area.editable_fields','["full_name","email","availability","desired_salary","preferences"]', 'שדות שהמועמד עורך בעצמו'),
  ('tasks.default_completion',     '"all_assignees"','כלל השלמה כברירת מחדל'),
  ('tasks.daily_digest_hour',      '8',            'שעת הסיכום היומי'),
  ('finance.rounding',             '"agora"',      'עיגול לאגורה בסוף החישוב'),
  ('ai.enabled',                   'false',        'ניתוח קורות חיים מושבת עד בחירת ספק'),
  ('ai.monthly_quota',             '0',            'מכסת ניתוחים חודשית');

-- ---------- הרשאות: ברירת מחדל לכל סוג משתמש ----------
-- הבסיס הוא none לכל שילוב, ומעליו הענקות מפורשות.
insert into app.permission_defaults (role, module, action, scope)
select r, m, a, 'none'::app.perm_scope
from unnest(array['recruiter','manager','superadmin']::app.user_role[]) r
cross join unnest(enum_range(null::app.perm_module))  m
cross join unnest(enum_range(null::app.perm_action))  a;

-- מנהלת החברה: הכול בתוך הארגון. הגדרות מערכת לצפייה בלבד.
update app.permission_defaults set scope = 'all'
 where role = 'manager' and module <> 'system_settings';
update app.permission_defaults set scope = 'all'
 where role = 'manager' and module = 'system_settings' and action = 'view';

-- מנהל על: מעל הארגון. גישה תפעולית לצורך תמיכה בלבד, מתועדת.
update app.permission_defaults set scope = 'all'
 where role = 'superadmin'
   and module in ('system_settings','users_permissions','website','imports');
update app.permission_defaults set scope = 'all'
 where role = 'superadmin' and action = 'view'
   and module in ('candidates','jobs','companies','applications','placements','org_settings','reports');

-- מגייס: עבודה על מה שהותר לו, בלי כספים ובלי הגדרות.
update app.permission_defaults set scope = 'all'
 where role = 'recruiter'
   and module in ('candidates','jobs','companies','applications')
   and action in ('view','create');
update app.permission_defaults set scope = 'own'
 where role = 'recruiter'
   and module in ('candidates','jobs','companies','applications')
   and action = 'edit';
update app.permission_defaults set scope = 'own'
 where role = 'recruiter'
   and module in ('placements','candidate_messages','reports')
   and action in ('view','create','edit');
update app.permission_defaults set scope = 'own'
 where role = 'recruiter' and module = 'settlements' and action = 'view';
update app.permission_defaults set scope = 'all'
 where role = 'recruiter' and module = 'tasks' and action in ('view','create','edit');

-- ---------- פרופילי הרשאות מובנים ----------
insert into app.permission_profiles (name, description, is_builtin) values
  ('ראש צוות',  'היקף הצוות בכל מודולי העבודה ואישור מעברי שלב אחורה', true),
  ('כספים',     'חיובים, תקבולים והתחשבנות. ללא אישור בונוס וקיזוז',    true),
  ('עורך תוכן', 'ניהול אתר בלבד',                                        true),
  ('קורא דוחות','דוחות בהיקף מלא',                                       true);

insert into app.permission_profile_rules (profile_id, module, action, scope)
select p.id, m, a, 'team'::app.perm_scope
from app.permission_profiles p
cross join unnest(array['candidates','jobs','companies','applications','placements','tasks']::app.perm_module[]) m
cross join unnest(array['view','edit','approve']::app.perm_action[]) a
where p.name = 'ראש צוות';

insert into app.permission_profile_rules (profile_id, module, action, scope)
select p.id, m, a, 'all'::app.perm_scope
from app.permission_profiles p
cross join unnest(array['invoicing','settlements']::app.perm_module[]) m
cross join unnest(array['view','create','edit']::app.perm_action[]) a
where p.name = 'כספים';

insert into app.permission_profile_rules (profile_id, module, action, scope)
select p.id, 'website'::app.perm_module, a, 'all'::app.perm_scope
from app.permission_profiles p
cross join unnest(array['view','create','edit','delete']::app.perm_action[]) a
where p.name = 'עורך תוכן';

insert into app.permission_profile_rules (profile_id, module, action, scope)
select p.id, 'reports'::app.perm_module, a, 'all'::app.perm_scope
from app.permission_profiles p
cross join unnest(array['view','export']::app.perm_action[]) a
where p.name = 'קורא דוחות';

-- ---------- חשיפת שלבים למועמד ----------
insert into app.stage_exposure (stage, exposed, candidate_label, explanation) values
  ('new',                 false, null,                      null),
  ('screening',           false, null,                      null),
  ('initial_call',        false, null,                      null),
  ('submitted_to_client', true,  'בבדיקה אצל המעסיק',       'קורות החיים שלך הועברו למעסיק וממתינים לתגובתו'),
  ('interview',           true,  'ראיון',                    'נקבע ראיון. הפרטים מופיעים למטה'),
  ('offer',               true,  'הצעה',                     'המעסיק הביע עניין ואנחנו בשלב ההצעה'),
  ('hired',               true,  'התקבלת',                   'ברכות, התהליך הושלם בהצלחה'),
  ('rejected',            true,  'התהליך הסתיים',            null),
  ('withdrawn',           true,  'התהליך הסתיים',            null),
  ('job_cancelled',       true,  'התהליך הסתיים',            null);

-- ---------- תבניות משימה וכללי אוטומציה ----------
insert into app.task_templates (name, title, description, priority, due_offset_days, default_assignee_role, required_entity) values
  ('טיפול בהגשה חדשה',   'לטפל בהגשה חדשה',            'לבדוק קורות חיים, ליצור קשר ולהחליט על המשך', 'normal', 1, 'owner_recruiter', 'application'),
  ('מעקב אחרי ראיון',    'מעקב אחרי ראיון',            'לבדוק עם המועמד ועם הלקוח איך עבר הראיון',    'normal', 1, 'owner_recruiter', 'application'),
  ('בדיקת משוב מהלקוח',  'לבדוק משוב מהלקוח',          'עברו חמישה ימים מההגשה ללא תגובה',            'normal', 0, 'owner_recruiter', 'application'),
  ('אימות תחילת עבודה',  'לאמת שהמועמד התחיל לעבוד',   null,                                          'high',   0, 'owner_recruiter', 'placement'),
  ('בדיקה לפני סיום אחריות','לבדוק שהמועמד עדיין מועסק','תקופת האחריות מסתיימת בעוד שבוע',            'high',   0, 'owner_recruiter', 'placement'),
  ('אימות סיום אחריות',  'לאמת שהמועמד עדיין מועסק',   'אישור זה פותח את הזכאות לחיוב',               'urgent', 3, 'owner_recruiter', 'placement'),
  ('מענה למועמד',        'לענות למועמד',                'הודעה מהמועמד ממתינה למענה',                  'high',   1, 'owner_recruiter', 'application'),
  ('החלטה בהצעת קיזוז',  'להחליט בהצעת קיזוז',          null,                                          'normal', 7, 'manager',         'placement'),
  ('הפקת חיוב',          'להפיק חיוב',                  'החיוב הגיע למועד ההפקה המתוכנן',              'normal', 0, 'finance',         'placement'),
  ('טיפול בבקשת מחיקה',  'לטפל בבקשת מחיקה',            null,                                          'high',   3, 'manager',         'candidate');

insert into app.automation_rules (event, name, conditions, template_id, active, is_mandatory)
select e.event, e.name, e.conditions, t.id, true, e.mandatory
from (values
  ('application_submitted'::app.automation_event,        'הגשה חדשה יוצרת משימת טיפול',      '{}'::jsonb,                        'טיפול בהגשה חדשה',      false),
  ('application_stage_changed',                          'מעבר לראיון יוצר משימת מעקב',      '{"to_stage":"interview"}'::jsonb,  'מעקב אחרי ראיון',       false),
  ('client_submission_no_feedback',                      'הגשה ללא משוב חמישה ימים',          '{"days":5}'::jsonb,                'בדיקת משוב מהלקוח',     false),
  ('start_date_unverified',                              'תאריך תחילה עבר ללא אימות',         '{}'::jsonb,                        'אימות תחילת עבודה',     false),
  ('warranty_ending_soon',                               'שבוע לפני סיום אחריות',             '{"days":7}'::jsonb,                'בדיקה לפני סיום אחריות',false),
  ('warranty_ended',                                     'סיום אחריות מחייב אימות',           '{}'::jsonb,                        'אימות סיום אחריות',     true),
  ('candidate_message_unanswered',                       'הודעת מועמד ללא מענה יומיים',       '{"days":2}'::jsonb,                'מענה למועמד',           false),
  ('clawback_opened',                                    'הצעת קיזוז ממתינה להחלטה',          '{}'::jsonb,                        'החלטה בהצעת קיזוז',     false),
  ('invoice_due_for_issue',                              'חיוב הגיע למועד הפקה',              '{}'::jsonb,                        'הפקת חיוב',             false),
  ('deletion_requested',                                 'בקשת מחיקה נפתחה',                  '{}'::jsonb,                        'טיפול בבקשת מחיקה',     false)
) as e(event, name, conditions, template_name, mandatory)
join app.task_templates t on t.name = e.template_name;
