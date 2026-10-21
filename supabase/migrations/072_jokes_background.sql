-- 072 — Running jokes live only in the background (22 Oct 2026, wave 3). Additive only. Feature 'in_jokes' (053).
-- Josh: running jokes should be "not even in organiser view, just in background" — "In-jokes should be pulled from
-- the chat too using AI, but that's not public. Listing in-jokes is a bit crass."
--
--   * Nobody reads or writes in_jokes directly any more (the app's list screen is gone). The grants come off; the
--     058 policies stay but never apply without a grant. The server (service role) still reads and writes it.
--   * in_joke_lines(p_n): up to 5 random active jokes for the caller's current group, as text — members only (not
--     guests), only while the feature is on. The replay uses it. A joke inside a caption is the point; a list isn't.
--   * forget_running_jokes(): organisers wipe the slate without seeing them (retired and words cleared, like 069's
--     forget_player_name). Later AI runs only read chat written after that.
--   * The AI picks them up: once a day the scheduled job lgc-jokes calls the ai-helper function ({"type":"jokes"},
--     with the cron secret header) when a group with in_jokes and ai_helper on has new feed or trip chat. The function
--     (supabase/functions/ai-helper/jokes.ts) reads the last 14 days (text only, capped), asks the model for up to 8
--     short friendly running jokes, filters them, de-duplicates and keeps at most 30 active a group. Rows it adds are
--     source 'ai'. Only counts are kept (in_joke_state), never chat or joke text.

alter table public.in_jokes add column if not exists source text check (source is null or source in ('person', 'ai'));

-- Members can no longer see or change the list.
revoke select, insert, update, delete on public.in_jokes from authenticated;
grant select, insert, update on public.in_jokes to service_role;

-- ------------------------------------------------------------------ A few lines for a caption
create or replace function public.in_joke_lines(p_n int default 3) returns text[]
language plpgsql volatile security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_out text[];
begin
  if v_g is null or not private.is_group_member(v_g) or private.is_group_guest(v_g)
     or not public.feature_on(v_g, 'in_jokes') then
    return '{}';
  end if;
  select coalesce(array_agg(s.t), '{}') into v_out from (
    select regexp_replace(j.text, '\{\s*name\s*\}',
             coalesce(nullif(btrim(p.nickname), ''), nullif(split_part(btrim(p.name), ' ', 1), ''), 'someone'), 'gi') as t
    from public.in_jokes j
    left join public.players p on p.id = j.player_id and p.group_id = j.group_id
    where j.group_id = v_g and j.active and j.text <> '(removed)'
    order by random()
    limit least(greatest(coalesce(p_n, 3), 0), 5)
  ) s;
  return v_out;
end $$;
revoke all on function public.in_joke_lines(int) from public, anon;
grant execute on function public.in_joke_lines(int) to authenticated;

-- ------------------------------------------------------------------ Server-only state: counts, never text
create table if not exists public.in_joke_state (
  group_id uuid primary key references public.groups(id) on delete cascade,
  forgotten_at timestamptz,           -- an organiser wiped the slate: AI runs only read chat after this
  last_run_at timestamptz,            -- once a day a group (the daily cap counts these)
  last_ok boolean,
  last_messages int check (last_messages is null or last_messages >= 0),
  last_found int check (last_found is null or last_found >= 0),
  last_kept int check (last_kept is null or last_kept >= 0),
  last_retired int check (last_retired is null or last_retired >= 0),
  last_input_tokens int check (last_input_tokens is null or last_input_tokens >= 0),
  last_output_tokens int check (last_output_tokens is null or last_output_tokens >= 0),
  last_error text check (last_error is null or last_error ~ '^[a-z_0-9]{1,40}$')
);
create index if not exists in_joke_state_run_idx on public.in_joke_state (last_run_at);
alter table public.in_joke_state enable row level security;
-- No policies on purpose: the app can't read or write it. The ai-helper function uses the server key.
revoke all on public.in_joke_state from anon, authenticated;
grant select, insert, update on public.in_joke_state to service_role;

-- ------------------------------------------------------------------ Forget them all (organisers)
create or replace function public.forget_running_jokes() returns int
language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_n int;
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  update public.in_jokes set active = false, text = '(removed)', player_id = null
   where group_id = v_g and (active or text <> '(removed)');
  get diagnostics v_n = row_count;
  insert into public.in_joke_state (group_id, forgotten_at) values (v_g, now())
  on conflict (group_id) do update set forgotten_at = now();
  return v_n;
end $$;
revoke all on function public.forget_running_jokes() from public, anon;
grant execute on function public.forget_running_jokes() to authenticated;

-- ------------------------------------------------------------------ Which groups are due (server only)
-- Groups with in_jokes and ai_helper on, new feed or trip chat by people since the later of 14 days ago and the
-- last forget, and no run in the last 20 hours. `since` is where the AI starts reading.
create or replace function public.jokes_due(p_limit int default 50)
returns table (group_id uuid, since timestamptz)
language sql stable security definer set search_path = '' as $$
  with g as (
    select gr.id, greatest(now() - interval '14 days', coalesce(st.forgotten_at, '-infinity'::timestamptz)) as since,
           st.last_run_at
    from public.groups gr
    left join public.in_joke_state st on st.group_id = gr.id
    where public.feature_on(gr.id, 'in_jokes') and public.feature_on(gr.id, 'ai_helper')
      and (st.last_run_at is null or st.last_run_at < now() - interval '20 hours')
  )
  select g.id, g.since from g
  where exists (select 1 from public.posts p where p.group_id = g.id and p.kind = 'user' and p.created_at > greatest(g.since, coalesce(g.last_run_at, g.since)))
     or exists (select 1 from public.comments c where c.group_id = g.id and c.created_at > greatest(g.since, coalesce(g.last_run_at, g.since)))
     or exists (select 1 from public.plan_comments c where c.group_id = g.id and c.created_at > greatest(g.since, coalesce(g.last_run_at, g.since)))
  order by g.last_run_at nulls first
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
revoke all on function public.jokes_due(int) from public, anon, authenticated;
grant execute on function public.jokes_due(int) to service_role;

-- ------------------------------------------------------------------ The daily job
-- Calls the ai-helper only when a group is due. The project's address comes from the existing daily-reminders job
-- (as 071 does), the secret from server_secrets.
create or replace function private.jokes_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare v_base text; v_secret text;
begin
  select substring(command from 'https://[a-z0-9]+\.supabase\.co') into v_base from cron.job where jobname = 'lgc-daily-reminders';
  select value into v_secret from public.server_secrets where name = 'cron_secret';
  if v_base is null or v_secret is null then return; end if;
  if exists (select 1 from public.jokes_due(1)) then
    perform net.http_post(url := v_base || '/functions/v1/ai-helper',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := '{"type":"jokes"}'::jsonb, timeout_milliseconds := 120000);
  end if;
end $$;
revoke all on function private.jokes_tick() from public, anon, authenticated;
-- 3:41 am Sydney (AEDT) — quiet, and after the evening's chat.
select cron.schedule('lgc-jokes', '41 16 * * *', 'select private.jokes_tick()');

select private.add_same_group_checks();
