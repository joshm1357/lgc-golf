-- 015: Daily notification reminders at 22:00 UTC (9am Sydney in summer, 8am in winter).
-- The password is read from server_secrets at run time, so nothing secret is stored here.
select cron.schedule('lgc-daily-reminders', '0 22 * * *', $$
  select net.http_post(
    url := 'https://luogyzvrbedmicjejilr.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.server_secrets where name='cron_secret')),
    body := '{"type":"daily"}'::jsonb)
$$);
