-- 070: "Bring your history" — the AI import (21 Oct 2026, wave 3).
--
-- An organiser pastes text (a WhatsApp export, an email, a spreadsheet), uploads a file or takes photos (honour board,
-- trophy plaque, rules sheet). The ai-helper function's 'import' mode reads it and proposes players, past trips,
-- winners, past handicaps and rules. The organiser ticks what's right and taps "Add these", which writes with their
-- own sign-in through the paths the app already uses (admin_create_player, trips, import_honours, import_handicaps)
-- plus one new function here for rules. Nothing typed and no photo is ever kept: only counts go in helper_log.
--
-- Additive only:
--   * helper_log.job — which job a request was, when it isn't one of the original areas ('import'). The area column's
--     check can't take new values without being replaced (not additive), so import rows are mode 'setup' (they count against the
--     monthly cap like setup) with job 'import'. Written only by the ai-helper function (server key).
--   * admin_ai_usage — the same as 065, but a row's area is its job when it has one, so Josh's AI tab shows
--     "import" on its own line.
--   * import_rules(p_rows) — imported rules go in as normal rules (version 1 in rule_versions, from the existing
--     trigger). Skips any whose title is already in the Rulebook, so it's safe to run twice.

alter table public.helper_log add column if not exists job text check (job is null or job ~ '^[a-z_]{1,20}$');

-- ------------------------------------------------------------------ Josh's numbers (065, with job as the area)
create or replace function public.admin_ai_usage(p_days int default 30)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_days int := least(greatest(coalesce(p_days, 30), 1), 3650); v_out json;
begin
  if not coalesce(private.is_platform_admin(), false) then raise exception 'Only Josh can do that'; end if;
  with l as (
         select h.*, coalesce(h.job, h.area, case h.mode when 'history' then 'ask' else h.mode end) as a,
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

-- ------------------------------------------------------------------ Imported rules
-- p_rows: [{ title, detail, category, value }] (at most 60). Returns { added, proposed, skipped }.
--   * In force straight away when the organiser decides new rules for this group, when rule voting is off, or when
--     the Rulebook has no rules in force yet (a group bringing its rules in for the first time). The guard trigger
--     would otherwise refuse the second rule of the batch, so it's told this is a server change for the batch only.
--   * Otherwise (the group votes on new rules and already has some) each one goes up for a vote, as the group's
--     own decision rule says — the same as proposing it in the Rulebook.
create or replace function public.import_rules(p_rows jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); r jsonb; v_title text; v_detail text; v_cat text; v_value text;
        v_direct boolean; v_status text; v_sort int; v_added int := 0; v_proposed int := 0; v_skipped int := 0;
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can add rules from history'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then raise exception 'Up to 60 rules at a time'; end if;
  perform pg_advisory_xact_lock(hashtext('import_rules:' || v_g::text));
  v_direct := coalesce(private.gov_settings(v_g, 'new_rule')->>'decides', 'organiser') = 'organiser'
              or not public.feature_on(v_g, 'rule_voting')
              or not exists (select 1 from public.rules where group_id = v_g and status = 'active');
  v_status := case when v_direct then 'active' else 'proposed' end;
  select coalesce(max(sort), 0) into v_sort from public.rules where group_id = v_g;
  if v_direct then perform set_config('app.gov_apply', 'on', true); end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_title := left(btrim(regexp_replace(coalesce(r ->> 'title', ''), '\s+', ' ', 'g')), 80);
    v_detail := nullif(left(btrim(coalesce(r ->> 'detail', '')), 1000), '');
    v_value := nullif(left(btrim(coalesce(r ->> 'value', '')), 40), '');
    v_cat := coalesce(r ->> 'category', 'other');
    if v_cat not in ('format','side_comp','bonus','handicap','etiquette','fines','other') then v_cat := 'other'; end if;
    if char_length(v_title) < 2 then raise exception 'Each rule needs a name'; end if;
    if exists (select 1 from public.rules where group_id = v_g and status in ('active', 'proposed')
               and lower(btrim(title)) = lower(v_title)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_sort := v_sort + 1;
    insert into public.rules (group_id, title, detail, category, applies_to, value, status, decided_at, decision_note, sort)
    values (v_g, v_title, v_detail, v_cat, '{all}', v_value, v_status,
            case when v_direct then now() end, case when v_direct then 'Brought in from the group’s history' end, v_sort);
    if v_direct then v_added := v_added + 1; else v_proposed := v_proposed + 1; end if;
  end loop;
  perform set_config('app.gov_apply', '', true);
  return json_build_object('added', v_added, 'proposed', v_proposed, 'skipped', v_skipped);
end $$;
revoke all on function public.import_rules(jsonb) from public, anon;
grant execute on function public.import_rules(jsonb) to authenticated;

-- helper_log still has no links to other group tables; kept so the same-group checks stay complete.
select private.add_same_group_checks();
