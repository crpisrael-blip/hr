-- בדיקות רגרסיה ליומן (מיגרציות 0034–0035): נראוּת אירועים, משתתפים ואישור השתתפות.
-- מגייס רואה ועורך את שלו; מוזמן רואה אירוע שהוזמן אליו ויכול לאשר/לדחות; המנהלת הכול.
-- כדי לבדוק RLS בפועל מחליפים ל-role authenticated (superuser עוקף RLS).
\set ON_ERROR_STOP on

alter table auth.users add column if not exists email text;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

do $$
declare
  v_mgr_uid  uuid := gen_random_uuid();
  v_recA_uid uuid := gen_random_uuid();
  v_recB_uid uuid := gen_random_uuid();
  v_mgr uuid; v_recA uuid; v_recB uuid;
  v_eA uuid; v_eB uuid;
  v_cnt integer; v_status text;
begin
  ------------------------------------------------------------ נתוני יסוד (superuser)
  insert into auth.users (id, email) values
    (v_mgr_uid, 'm@cal.test'), (v_recA_uid, 'a@cal.test'), (v_recB_uid, 'b@cal.test');
  insert into app.employees (user_id, full_name, email, role)
    values (v_mgr_uid, 'מנהלת יומן', 'm@cal.test', 'manager') returning id into v_mgr;
  insert into app.employees (user_id, full_name, email, role)
    values (v_recA_uid, 'מגייס א', 'a@cal.test', 'recruiter') returning id into v_recA;
  insert into app.employees (user_id, full_name, email, role)
    values (v_recB_uid, 'מגייס ב', 'b@cal.test', 'recruiter') returning id into v_recB;

  -- מעבר ל-role authenticated כדי ש-RLS ייאכף בפועל.
  set local role authenticated;

  -- כל מגייס מוסיף אירוע משלו.
  perform set_config('test.uid', v_recA_uid::text, true);
  insert into app.calendar_events (owner_id, title, starts_at)
    values (v_recA, 'פגישת מגייס א', app.today_il() + 1) returning id into v_eA;

  perform set_config('test.uid', v_recB_uid::text, true);
  insert into app.calendar_events (owner_id, title, starts_at)
    values (v_recB, 'פגישת מגייס ב', app.today_il() + 2) returning id into v_eB;

  -- מגייס ב רואה רק את שלו (לפני הזמנה).
  select count(*) into v_cnt from app.calendar_events;
  if v_cnt <> 1 then raise exception 'מגייס רואה % אירועים, נדרש 1 (שלו בלבד)', v_cnt; end if;

  -- מגייס ב אינו יכול ליצור אירוע בבעלות מגייס אחר.
  begin
    insert into app.calendar_events (owner_id, title, starts_at)
      values (v_recA, 'ניסיון חדירה', app.today_il() + 3);
    raise exception 'ASSERT: מגייס יצר אירוע בבעלות מגייס אחר';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like 'ASSERT:%' then raise; end if;
      raise exception 'ASSERT: נדחה מסיבה אחרת: %', sqlerrm;
  end;

  -- המנהלת רואה את שני האירועים.
  perform set_config('test.uid', v_mgr_uid::text, true);
  select count(*) into v_cnt from app.calendar_events;
  if v_cnt <> 2 then raise exception 'המנהלת רואה % אירועים, נדרש 2 (הכול)', v_cnt; end if;

  -- אילוץ טווח: סיום לפני התחלה נדחה.
  begin
    insert into app.calendar_events (owner_id, title, starts_at, ends_at)
      values (v_mgr, 'טווח הפוך', app.today_il() + 2, app.today_il() + 1);
    raise exception 'ASSERT: אירוע עם סיום לפני התחלה לא נדחה';
  exception
    when check_violation then null;
    when others then
      if sqlerrm like 'ASSERT:%' then raise; end if;
      raise exception 'ASSERT: נדחה מסיבה אחרת: %', sqlerrm;
  end;

  ------------------------------------------------ משתתפים ואישור השתתפות
  -- מגייס א מזמין את מגייס ב לאירוע של א.
  perform set_config('test.uid', v_recA_uid::text, true);
  insert into app.calendar_event_participants (event_id, employee_id, invited_by)
    values (v_eA, v_recB, v_recA);

  -- כעת מגייס ב רואה שני אירועים: שלו + זה שהוזמן אליו.
  perform set_config('test.uid', v_recB_uid::text, true);
  select count(*) into v_cnt from app.calendar_events;
  if v_cnt <> 2 then raise exception 'מוזמן רואה % אירועים, נדרש 2 (שלו + ההזמנה)', v_cnt; end if;

  -- מגייס ב מאשר השתתפות (מעדכן את השורה שלו).
  update app.calendar_event_participants set status = 'accepted', responded_at = now()
    where event_id = v_eA and employee_id = v_recB;
  select status into v_status from app.calendar_event_participants
    where event_id = v_eA and employee_id = v_recB;
  if v_status <> 'accepted' then raise exception 'אישור השתתפות נכשל: מצב %', v_status; end if;

  -- מגייס ב אינו יכול לנהל את רשימת המשתתפים של אירוע שאינו שלו.
  begin
    insert into app.calendar_event_participants (event_id, employee_id, invited_by)
      values (v_eA, v_recA, v_recB);
    raise exception 'ASSERT: משתתף שאינו הבעלים הוסיף מוזמן';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like 'ASSERT:%' then raise; end if;
      raise exception 'ASSERT: נדחה מסיבה אחרת: %', sqlerrm;
  end;

  reset role;

  raise notice 'כל בדיקות היומן עברו';
end $$;
