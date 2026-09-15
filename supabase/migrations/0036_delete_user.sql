-- מחיקה מלאה של משתמש: חשבון ההתחברות (auth.users) + כרטיס העובד.
-- הרשאה: מנהל על בלבד כברירת מחדל, וניתן להרחבה דרך מסך ההרשאות
-- (users_permissions/delete). בשונה משאר המערכת — כאן אין קיצור-דרך
-- אוטומטי למנהלת: מחיקת משתמש נשלטת אך ורק ע"י המטריצה, כדי שברירת
-- המחדל תהיה "מנהל על בלבד" וניתנת לשינוי מפורש.

-- ברירת מחדל: המנהלת אינה מוחקת משתמשים אלא אם הוענק לה במפורש.
-- (מנהל על נשאר 'all' מ-0008; מגייס 'none'.)
update app.permission_defaults set scope = 'none'
 where role = 'manager' and module = 'users_permissions' and action = 'delete';

-- ליבה: האם למשתמש p_actor מותר למחוק משתמשים. נשען על המטריצה בלבד
-- (permission_defaults + פרופילים + overrides), deny גובר. אין short-circuit
-- לפי תפקיד — לכן מנהלת אינה מורשית אלא אם הוגדר לה מפורשות במסך ההרשאות.
create or replace function app.may_delete_user(p_actor uuid)
returns boolean
language plpgsql stable security definer set search_path = app, auth, public as $$
declare v_emp app.employees%rowtype; v_scope app.perm_scope;
begin
  if p_actor is null then return false; end if;
  select * into v_emp from app.employees
   where user_id = p_actor and employment_status = 'active' limit 1;
  if v_emp.id is null then return false; end if;

  -- שלילה מפורשת גוברת על כל הענקה.
  if exists (
    select 1 from app.permission_overrides o
     where o.employee_id = v_emp.id and o.module = 'users_permissions' and o.action = 'delete'
       and o.kind = 'deny' and (o.valid_until is null or o.valid_until > now())
  ) then
    return false;
  end if;

  -- ההיקף האפקטיבי מתוך שלוש השכבות (ברירת מחדל של התפקיד, פרופיל, override/grant).
  select max(s) into v_scope from (
    select d.scope as s
      from app.permission_defaults d
     where d.role = v_emp.role and d.module = 'users_permissions' and d.action = 'delete'
    union all
    select r.scope
      from app.permission_profile_rules r
      join app.employee_permission_profiles ep on ep.profile_id = r.profile_id
     where ep.employee_id = v_emp.id and r.module = 'users_permissions' and r.action = 'delete'
    union all
    select o.scope
      from app.permission_overrides o
     where o.employee_id = v_emp.id and o.module = 'users_permissions' and o.action = 'delete'
       and o.kind = 'grant' and (o.valid_until is null or o.valid_until > now())
  ) x;

  return coalesce(v_scope, 'none'::app.perm_scope) <> 'none';
end $$;

-- גרסה ללא פרמטר עבור ה-UI: האם המשתמש הנוכחי רשאי למחוק משתמשים.
create or replace function app.can_delete_users()
returns boolean
language sql stable security definer set search_path = app, auth, public as $$
  select app.may_delete_user(auth.uid())
$$;

-- may_delete_user נקראת רק מפונקציית הקצה (service_role); can_delete_users מה-UI.
revoke execute on function app.may_delete_user(uuid) from public, anon, authenticated;
grant  execute on function app.may_delete_user(uuid) to service_role;
grant  execute on function app.can_delete_users()    to authenticated, service_role;
