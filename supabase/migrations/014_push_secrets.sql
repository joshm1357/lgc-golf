-- 014: Server-only settings for notifications (push keys, the daily-reminder password).
-- Nobody using the app can read this table: RLS is on with no policies, and access is revoked.
-- Only the 'notify' Edge Function (service role) and the database itself read it.
create table public.server_secrets (
  name text primary key,
  value text not null
);
alter table public.server_secrets enable row level security;
revoke all on public.server_secrets from anon, authenticated;
-- Values are inserted separately (not stored in git).

-- Daily reminders at 9am Sydney time (summer): pg_cron calls the notify function.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Applied separately (contains no secret — it reads the password from server_secrets at run time):
-- select cron.schedule('lgc-daily-reminders', '0 22 * * *', $$
--   select net.http_post(
--     url := 'https://luogyzvrbedmicjejilr.supabase.co/functions/v1/notify',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.server_secrets where name='cron_secret')),
--     body := '{"type":"daily"}'::jsonb)
-- $$);
-- 22:00 UTC = 9am Sydney in summer (8am in winter).
