-- 065 — AI helper v2 (21 Oct 2026). Additive only. Part of the 'ai_helper' feature (switch in 053, on by default 060).
-- Josh: "AI should be core in the product, at least to test whether people want to use it."
--
-- helper_log (059) gets a few more columns, still with NO prompt or answer text:
--   * area     — which part of the app asked: 'setup', 'plan' (Plan it with AI), 'ask' (questions), 'apply',
--                'plan_apply' (the Do it / Create it taps). The older `mode` column stays as it was (the cap counts
--                mode 'setup' and 'history'; planning counts as 'setup', Create it as 'apply').
--   * capped   — a request refused by the cap (shown on Josh's screen; never counted against the cap itself).
--   * error    — a short code when it went wrong (e.g. 'provider_busy', 'bad_json', 'timeout', 'capped').
--   * provider, model — which AI answered (e.g. 'openai' + the model id), to compare cheap models.
--   * rating, rated_at — 👍 (1) / 👎 (-1) from the person who asked, via rate_helper(). Only your own requests.
-- And two functions:
--   * rate_helper(p_log, p_rating) — 👍 / 👎 / clear (0) on one of YOUR OWN helper answers. Refused when the
--     feature is off.
--   * admin_ai_usage(p_days) — Josh's Wishes screen, AI tab: requests per area per week, groups using it, 👍/👎
--     share, cap hits, errors, tokens (the cost proxy) and which models. Platform admins only.
-- The app still can't read or write helper_log directly (RLS on, no policies); these functions are the only way in.

alter table public.helper_log add column if not exists area text
  check (area is null or area in ('setup', 'plan', 'ask', 'apply', 'plan_apply'));
alter table public.helper_log add column if not exists capped boolean not null default false;
alter table public.helper_log add column if not exists error text check (error is null or char_length(error) <= 40);
alter table public.helper_log add column if not exists provider text check (provider is null or char_length(provider) <= 20);
alter table public.helper_log add column if not exists model text check (model is null or char_length(model) <= 80);
alter table public.helper_log add column if not exists rating smallint check (rating is null or rating in (-1, 1));
alter table public.helper_log add column if not exists rated_at timestamptz;
create index if not exists helper_log_time_idx on public.helper_log (created_at);

-- 👍 / 👎 on one of your own answers (p_rating 1, -1, or 0 to clear). Returns the rating now stored.
create or replace function public.rate_helper(p_log bigint, p_rating int)
returns int language plpgsql security definer set search_path = '' as $$
declare v public.helper_log;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_rating is null or p_rating not in (-1, 0, 1) then raise exception 'Rate it thumbs up or thumbs down'; end if;
  select * into v from public.helper_log where id = p_log and user_id = auth.uid() for update;
  -- Not yours (or not there): the same answer either way, so nobody can probe other people's requests.
  if v.id is null or v.mode not in ('setup', 'history') then raise exception 'That answer isn''t yours to rate'; end if;
  if not private.is_group_member(v.group_id) then raise exception 'That answer isn''t yours to rate'; end if;
  if not public.feature_on(v.group_id, 'ai_helper') then raise exception 'The AI helper is switched off for this group'; end if;
  update public.helper_log set rating = nullif(p_rating, 0)::smallint, rated_at = now() where id = v.id;
  return p_rating;
end $$;
revoke all on function public.rate_helper(bigint, int) from public, anon;
grant execute on function public.rate_helper(bigint, int) to authenticated;

-- Josh's numbers over the last p_days (1–3650). Counts and tokens only: no text, no names of people.
create or replace function public.admin_ai_usage(p_days int default 30)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_days int := least(greatest(coalesce(p_days, 30), 1), 3650); v_out json;
begin
  if not coalesce(private.is_platform_admin(), false) then raise exception 'Only Josh can do that'; end if;
  with l as (
         select h.*, coalesce(h.area, case h.mode when 'history' then 'ask' else h.mode end) as a,
                (date_trunc('week', h.created_at at time zone 'Australia/Sydney'))::date as wk
         from public.helper_log h where h.created_at > now() - make_interval(days => v_days)),
       q as (select * from l where l.mode in ('setup', 'history')),            -- questions to the AI
       asked as (select * from q where not q.capped),                           -- ones that reached the AI
       per_area as (select a, count(*) as requests, count(*) filter (where ok) as ok,
                           count(*) filter (where not ok) as failed,
                           count(*) filter (where rating = 1) as up, count(*) filter (where rating = -1) as down,
                           round(avg(input_tokens)) as avg_in, round(avg(output_tokens)) as avg_out
                    from asked group by a),
       per_week as (select wk, a, count(*) as requests from asked group by wk, a),
       per_group as (select q.group_id, count(*) filter (where not q.capped) as requests,
                            count(*) filter (where q.capped) as cap_hits,
                            count(*) filter (where q.rating = 1) as up, count(*) filter (where q.rating = -1) as down,
                            count(distinct q.user_id) as people, max(q.created_at) as last_used
                     from q group by q.group_id),
       per_model as (select coalesce(provider, '?') as provider, coalesce(model, '?') as model, count(*) as requests,
                            count(*) filter (where not ok) as failed,
                            round(avg(input_tokens)) as avg_in, round(avg(output_tokens)) as avg_out
                     from asked group by 1, 2),
       errs as (select error, count(*) as times from asked where not ok and error is not null group by error)
  select json_build_object(
    'days', v_days,
    'requests', (select count(*) from asked),
    'failed', (select count(*) from asked where not ok),
    'cap_hits', (select count(*) from q where capped),
    'groups_using', (select count(distinct group_id) from asked),
    'people_using', (select count(distinct user_id) from asked),
    'up', (select count(*) from q where rating = 1),
    'down', (select count(*) from q where rating = -1),
    'applied', (select count(*) from l where mode = 'apply' and ok),
    'apply_failed', (select count(*) from l where mode = 'apply' and not ok),
    'tokens_in', (select coalesce(sum(input_tokens), 0) from asked),
    'tokens_out', (select coalesce(sum(output_tokens), 0) from asked),
    'avg_in', (select round(avg(input_tokens)) from asked),
    'avg_out', (select round(avg(output_tokens)) from asked),
    'avg_ms', (select round(avg(ms)) from asked),
    'areas', coalesce((select json_agg(json_build_object('area', a, 'requests', requests, 'ok', ok, 'failed', failed, 'up', up,
                         'down', down, 'avg_in', avg_in, 'avg_out', avg_out) order by requests desc, a) from per_area), '[]'::json),
    'weeks', coalesce((select json_agg(json_build_object('week', wk, 'area', a, 'requests', requests) order by wk desc, a) from per_week), '[]'::json),
    'groups', coalesce((select json_agg(json_build_object('group_id', g.group_id, 'group_name', gr.name, 'requests', g.requests,
                          'cap_hits', g.cap_hits, 'up', g.up, 'down', g.down, 'people', g.people, 'last_used', g.last_used)
                        order by g.requests desc, gr.name) from per_group g join public.groups gr on gr.id = g.group_id), '[]'::json),
    'models', coalesce((select json_agg(json_build_object('provider', provider, 'model', model, 'requests', requests, 'failed', failed,
                          'avg_in', avg_in, 'avg_out', avg_out) order by requests desc) from per_model), '[]'::json),
    'errors', coalesce((select json_agg(json_build_object('error', error, 'times', times) order by times desc, error) from errs), '[]'::json)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.admin_ai_usage(int) from public, anon;
grant execute on function public.admin_ai_usage(int) to authenticated;

-- helper_log still has no links to other group tables; kept so the same-group checks stay complete.
select private.add_same_group_checks();
