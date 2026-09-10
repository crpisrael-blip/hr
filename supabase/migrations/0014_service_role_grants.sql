-- הרשאות ל-service_role על הסכמות app ו-finance.
-- ה-edge functions רצות כ-service_role. הרשאת service עוקפת RLS אך לא הרשאות
-- סכמה/טבלה; המיגרציות הקודמות נתנו גישה ל-authenticated בלבד, ולכן פונקציות
-- השרת קיבלו "permission denied for schema app". כאן משלימים את ההרשאות.

grant usage on schema app to service_role;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;
grant all on all functions in schema app to service_role;
alter default privileges in schema app grant all on tables to service_role;
alter default privileges in schema app grant all on sequences to service_role;
alter default privileges in schema app grant all on functions to service_role;

grant usage on schema finance to service_role;
grant all on all tables in schema finance to service_role;
grant all on all sequences in schema finance to service_role;
grant all on all functions in schema finance to service_role;
alter default privileges in schema finance grant all on tables to service_role;
alter default privileges in schema finance grant all on sequences to service_role;
alter default privileges in schema finance grant all on functions to service_role;
