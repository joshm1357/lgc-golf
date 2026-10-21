-- 057 — The connector's learning loop (Stage 13, change 2; overnight build 21 Oct 2026). Additive only.
--
-- What it's for: Josh sees what organisers actually ask their AI assistant to do, so the most-wanted jobs can climb
-- the ladder (assistant → purpose-built tool → one-tap button → automatic).
--   * connector_calls — one row per tool call through the Claude connector (lgc-mcp): which group, which tool, worked
--     or not, how long it took, and a short error KIND (like 'not_found') — never the tool's arguments, never the
--     error's wording (it can hold names), never any chat text.
--   * feature_wishes — the assistant's one-line description of a job no tool can do yet (the suggest_feature tool),
--     and which group asked.
--
-- Platform-level tables (Josh's, like client_errors): NOT in GROUP_TABLES, no feature switch. Nobody using the app
-- can read or write them. Only the connector writes (it runs with the server key), and only platform admins read,
-- through admin_connector_stats() and admin_wishes(), which refuse everyone else.
-- Deleting a group deletes its rows (delete_group goes through every table with a group_id; the foreign key also
-- cascades).

create table if not exists public.connector_calls (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  tool text not null check (char_length(tool) between 1 and 60),
  ok boolean not null,
  ms int check (ms is null or ms >= 0),
  error text check (error is null or char_length(error) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists connector_calls_time_idx on public.connector_calls (created_at);
create index if not exists connector_calls_group_idx on public.connector_calls (group_id, created_at);
alter table public.connector_calls enable row level security;
revoke all on public.connector_calls from anon, authenticated;

create table if not exists public.feature_wishes (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  job text not null check (char_length(btrim(job)) between 3 and 200),
  source text not null default 'connector' check (char_length(source) between 1 and 30),
  created_at timestamptz not null default now()
);
create index if not exists feature_wishes_time_idx on public.feature_wishes (created_at);
create index if not exists feature_wishes_group_idx on public.feature_wishes (group_id, created_at);
alter table public.feature_wishes enable row level security;
revoke all on public.feature_wishes from anon, authenticated;
-- No policies on purpose: with RLS on and no policy, a signed-in user gets nothing even if a grant slips back in.
-- The connector's server key (service_role) bypasses RLS and keeps Supabase's default grants, so it can insert.

-- Does this person see Josh's screens? (Only says yes or no about yourself.) The More screen uses it to show the
-- Wishes link; the database still checks inside each admin function.
create or replace function public.am_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_platform_admin(), false);
$$;
revoke all on function public.am_platform_admin() from public, anon;
grant execute on function public.am_platform_admin() to authenticated;

-- Tool calls over the last p_days (1–3650): totals, each tool, and each group with its own tool counts.
create or replace function public.admin_connector_stats(p_days int default 30)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_days int := least(greatest(coalesce(p_days, 30), 1), 3650); v_out json;
begin
  if not coalesce(private.is_platform_admin(), false) then raise exception 'Only Josh can do that'; end if;
  with c as (select * from public.connector_calls where created_at > now() - make_interval(days => v_days)),
       per_tool as (select tool, count(*) as calls, count(*) filter (where not ok) as failed, round(avg(ms)) as avg_ms
                    from c group by tool),
       per_group as (select c.group_id, count(*) as calls, count(*) filter (where not c.ok) as failed,
                            max(c.created_at) as last_used
                     from c group by c.group_id),
       per_group_tool as (select group_id, tool, count(*) as calls, count(*) filter (where not ok) as failed
                          from c group by group_id, tool),
       errs as (select tool, coalesce(error, 'other') as error, count(*) as times from c where not ok group by 1, 2)
  select json_build_object(
    'days', v_days,
    'calls', (select count(*) from c),
    'failed', (select count(*) from c where not c.ok),
    'groups_using', (select count(*) from per_group),
    'tools', coalesce((select json_agg(json_build_object('tool', t.tool, 'calls', t.calls, 'failed', t.failed, 'avg_ms', t.avg_ms)
                                       order by t.calls desc, t.tool) from per_tool t), '[]'::json),
    'groups', coalesce((select json_agg(json_build_object(
                 'group_id', g.group_id, 'group_name', gr.name, 'calls', g.calls, 'failed', g.failed, 'last_used', g.last_used,
                 'tools', (select json_agg(json_build_object('tool', x.tool, 'calls', x.calls, 'failed', x.failed)
                                           order by x.calls desc, x.tool)
                           from per_group_tool x where x.group_id = g.group_id))
               order by g.calls desc, gr.name)
               from per_group g join public.groups gr on gr.id = g.group_id), '[]'::json),
    'errors', coalesce((select json_agg(json_build_object('tool', e.tool, 'error', e.error, 'times', e.times)
                                        order by e.times desc, e.tool) from errs e), '[]'::json)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.admin_connector_stats(int) from public, anon;
grant execute on function public.admin_connector_stats(int) to authenticated;

-- The wishes themselves over the last p_days (1–3650), newest first (at most 1000). The app groups similar ones.
create or replace function public.admin_wishes(p_days int default 90)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_days int := least(greatest(coalesce(p_days, 90), 1), 3650); v_out json;
begin
  if not coalesce(private.is_platform_admin(), false) then raise exception 'Only Josh can do that'; end if;
  select coalesce(json_agg(x order by x.created_at desc), '[]'::json) into v_out from (
    select w.id, w.job, w.source, w.group_id, gr.name as group_name, w.created_at
    from public.feature_wishes w join public.groups gr on gr.id = w.group_id
    where w.created_at > now() - make_interval(days => v_days)
    order by w.created_at desc limit 1000) x;
  return v_out;
end $$;
revoke all on function public.admin_wishes(int) from public, anon;
grant execute on function public.admin_wishes(int) to authenticated;
