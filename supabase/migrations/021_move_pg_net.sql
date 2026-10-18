-- 021: Move the pg_net add-on (lets the database make web calls) out of the public schema.
-- pg_net can't be moved in place, so it's dropped and re-created in the "extensions" schema
-- (Supabase's documented fix). Its functions stay in the "net" schema, so the daily reminder
-- job's command (net.http_post(...)) keeps working unchanged. The job is re-saved anyway from its
-- own current settings, so this file works on any project (live or staging) without editing.
-- Any web call waiting in pg_net's queue at that exact moment is lost (there are only ever the
-- 9am reminders, so run this away from 9am Sydney time).
do $$
declare v_cmd text; v_sched text;
begin
  select command, schedule into v_cmd, v_sched from cron.job where jobname = 'lgc-daily-reminders';
  drop extension if exists pg_net;
  create extension pg_net schema extensions;
  if v_cmd is not null then
    perform cron.schedule('lgc-daily-reminders', v_sched, v_cmd);
  end if;
end $$;
