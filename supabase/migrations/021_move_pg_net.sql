-- 021: Move the pg_net add-on (lets the database make web calls) out of the public schema.
-- pg_net can't be moved in place, so it's dropped and re-created in the "extensions" schema
-- (Supabase's documented fix). Its functions always live in the "net" schema, and the 9am reminder
-- job calls net.http_post(...) by name each time it runs, so the job keeps working untouched.
-- Only web calls waiting in pg_net's queue at that exact moment (and its 6-hour log of replies) are
-- lost — run this away from 9am Sydney time.
-- Afterwards check: select jobid, jobname, active from cron.job;  → lgc-daily-reminders, active = true
drop extension if exists pg_net;
create extension pg_net schema extensions;
