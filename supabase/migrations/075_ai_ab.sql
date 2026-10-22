-- 075 — AI helper: "was that helpful?" reasons, and A/B testing two AI models (22 Oct 2026). Additive only.
-- Josh: "ask in the button or otherwise whether they liked the answer, and also then build for an A/B testing for
-- different models." Part of the 'ai_helper' feature (switch in 053).
--
-- helper_log (059/065/070) gets a few more columns, still with NO prompt or answer text:
--   * variant   — 'A' or 'B': which model this person was given (a stable hash of their user id; abtest.ts).
--   * ab_test   — the test's name (the AI_AB_SALT secret, default 'ab1'). Changing it starts a fresh test.
--   * fallback  — B had a provider error and A answered instead.
--   * cost      — rough US$ for the tokens, only when AI_PRICE_* secrets are set.
--   * feedback_reason, feedback_note, feedback_at — after 👎, why (a chip) and an optional short note (≤ 200
--     characters, cleaned, never sent to the AI). Written only through helper_feedback(), by the person who asked.
-- And two functions:
--   * helper_feedback(p_log, p_reason, p_note) — the reason for a 👎 on one of YOUR OWN answers. Refused when it
--     isn't yours, isn't rated 👎, or the feature is off.
--   * admin_ai_abtest(p_days) — Josh's Wishes screen, AI tab: per test and variant (model): questions, people, 👍
--     share, 👎 reasons, errors, median time, tokens, cost; and the latest notes. Platform admins only.
-- The app still can't read or write helper_log directly (RLS on, no policies); these functions are the only way in.

alter table public.helper_log add column if not exists variant text check (variant is null or variant in ('A', 'B'));
alter table public.helper_log add column if not exists ab_test text check (ab_test is null or char_length(ab_test) <= 40);
alter table public.helper_log add column if not exists fallback boolean not null default false;
alter table public.helper_log add column if not exists cost numeric(12, 6) check (cost is null or cost >= 0);
alter table public.helper_log add column if not exists feedback_reason text
  check (feedback_reason is null or feedback_reason in ('wrong', 'no_answer', 'slow', 'long', 'not_useful', 'other'));
alter table public.helper_log add column if not exists feedback_note text check (feedback_note is null or char_length(feedback_note) <= 200);
alter table public.helper_log add column if not exists feedback_at timestamptz;
create index if not exists helper_log_ab_idx on public.helper_log (ab_test, variant) where variant is not null;

-- Why a 👎 (p_reason one of the chips; p_note optional). Returns the reason stored.
create or replace function public.helper_feedback(p_log bigint, p_reason text, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v public.helper_log; v_note text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_reason is null or p_reason not in ('wrong', 'no_answer', 'slow', 'long', 'not_useful', 'other') then
    raise exception 'Pick a reason';
  end if;
  select * into v from public.helper_log where id = p_log and user_id = auth.uid() for update;
  -- Not yours (or not there): the same answer either way, so nobody can probe other people's requests.
  if v.id is null or v.mode not in ('setup', 'history') then raise exception 'That answer isn''t yours to rate'; end if;
  if not private.is_group_member(v.group_id) then raise exception 'That answer isn''t yours to rate'; end if;
  if not public.feature_on(v.group_id, 'ai_helper') then raise exception 'The AI helper is switched off for this group'; end if;
  if v.rating is distinct from -1 then raise exception 'Tap 👎 first'; end if;
  -- One line, no control characters or angle brackets, at most 200 characters; empty → none.
  v_note := nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]<>]', ' ', 'g'), '\s+', ' ', 'g')), 200), '');
  update public.helper_log set feedback_reason = p_reason, feedback_note = v_note, feedback_at = now() where id = v.id;
  return p_reason;
end $$;
revoke all on function public.helper_feedback(bigint, text, text) from public, anon;
grant execute on function public.helper_feedback(bigint, text, text) to authenticated;

-- Josh's A/B numbers over the last p_days (1–3650). Counts, times and tokens; notes only for platform admins.
create or replace function public.admin_ai_abtest(p_days int default 30)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_days int := least(greatest(coalesce(p_days, 30), 1), 3650); v_out json;
begin
  if not coalesce(private.is_platform_admin(), false) then raise exception 'Only Josh can do that'; end if;
  with q as (select h.* from public.helper_log h
             where h.created_at > now() - make_interval(days => v_days)
               and h.mode in ('setup', 'history') and not h.capped and h.variant is not null),
       models as (select coalesce(ab_test, '') as t, variant, coalesce(provider, '?') as provider, coalesce(model, '?') as model, count(*) as n
                  from q group by 1, 2, 3, 4),
       reasons as (select coalesce(ab_test, '') as t, variant, feedback_reason as reason, count(*) as n
                   from q where rating = -1 and feedback_reason is not null group by 1, 2, 3),
       per as (select coalesce(ab_test, '') as t, variant,
                      count(*) as questions, count(distinct user_id) as people,
                      count(*) filter (where rating = 1) as up, count(*) filter (where rating = -1) as down,
                      count(*) filter (where not ok) as failed, count(*) filter (where fallback) as fallbacks,
                      percentile_cont(0.5) within group (order by ms) filter (where ok and ms > 0) as median_ms,
                      coalesce(sum(input_tokens), 0) as tokens_in, coalesce(sum(output_tokens), 0) as tokens_out,
                      sum(cost) as cost, min(created_at) as first_used, max(created_at) as last_used
               from q group by 1, 2),
       tests as (select t, min(first_used) as first_used, max(last_used) as last_used from per group by t)
  select json_build_object(
    'days', v_days,
    'tests', coalesce((select json_agg(json_build_object(
        'ab_test', nullif(ts.t, ''), 'first_used', ts.first_used, 'last_used', ts.last_used,
        'variants', (select json_agg(json_build_object(
            'variant', p.variant, 'questions', p.questions, 'people', p.people, 'up', p.up, 'down', p.down,
            'failed', p.failed, 'fallbacks', p.fallbacks, 'median_ms', round(p.median_ms::numeric),
            'tokens_in', p.tokens_in, 'tokens_out', p.tokens_out, 'cost', p.cost,
            'models', coalesce((select json_agg(json_build_object('provider', m.provider, 'model', m.model, 'questions', m.n) order by m.n desc, m.model)
                                from models m where m.t = p.t and m.variant = p.variant), '[]'::json),
            'reasons', coalesce((select json_object_agg(r.reason, r.n) from reasons r where r.t = p.t and r.variant = p.variant), '{}'::json))
          order by p.variant) from per p where p.t = ts.t))
      order by ts.last_used desc) from tests ts), '[]'::json),
    'notes', coalesce((select json_agg(x order by x.at desc) from (
        select h.feedback_at as at, h.ab_test, h.variant, h.feedback_reason as reason, h.feedback_note as note
        from public.helper_log h
        where h.feedback_note is not null and h.rating = -1 and h.feedback_at > now() - make_interval(days => v_days)
        order by h.feedback_at desc limit 30) x), '[]'::json)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.admin_ai_abtest(int) from public, anon;
grant execute on function public.admin_ai_abtest(int) to authenticated;

-- helper_log still has no links to other group tables; kept so the same-group checks stay complete.
select private.add_same_group_checks();
