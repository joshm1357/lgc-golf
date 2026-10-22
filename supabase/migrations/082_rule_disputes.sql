-- 082 — Dispute anything that's a rule (22 Oct 2026). ADDITIVE ONLY: two new nullable columns on cases, a check
-- constraint, one index, and new functions. Nothing is dropped, renamed or replaced, so older app versions keep working:
-- a dispute is an ordinary 'ruling' case to them (a question for the Tribunal), with or without a Rulebook rule.
--
-- Where a value in the app is a rule (a side comp "worth 2 strokes", minimum drives, a game's stake, Cup points, a
-- team handicap, a round's rules, a standard rule like countback…), a player taps it and disputes it. That raises a
-- 'ruling' case that also records WHAT was disputed:
--   cases.subject_kind  'setting' (a value stored on a round, comp, game…), 'rule' (a Rulebook rule) or
--                       'standard' (a rule built into the app, e.g. the Stableford tie-break)
--   cases.subject_ref   { table, id, field, key?, value (read by the server when raised), label, where{…}, rule_id? }
--
-- Nothing here changes a setting. A verdict goes through what's already there: an organiser writes it into the
-- Rulebook with apply_verdict_draft (organiser-checked, 076), or changes the setting where it's set (organisers only,
-- as today). The case insert goes through the same triggers as every case (draft-key strip, same-group, text check).
--
-- Rules: tribunal + rule challenges on (the same switches as asking for a ruling); guests can't raise; who may raise a
-- ruling (the group's decision rule) applies; one open dispute per person per thing; a Rulebook rule still has one open
-- case at a time (061's index).

-- ============================================================================================ columns
alter table public.cases add column if not exists subject_kind text;
alter table public.cases add column if not exists subject_ref jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cases_subject_ref_check' and conrelid = 'public.cases'::regclass) then
    alter table public.cases add constraint cases_subject_ref_check check (
      (subject_kind is null and subject_ref is null)
      or (subject_kind in ('setting', 'rule', 'standard') and jsonb_typeof(subject_ref) = 'object'
          and subject_ref ? 'table' and subject_ref ? 'field' and octet_length(subject_ref::text) <= 2000));
  end if;
end $$;
-- One open dispute per person per thing.
create unique index if not exists cases_one_open_dispute_per_person on public.cases
  (raised_by, (subject_ref->>'table'), (coalesce(subject_ref->>'id', '')), (subject_ref->>'field'), (coalesce(subject_ref->>'key', '')))
  where status = 'open' and subject_kind is not null and raised_by is not null;
create index if not exists cases_open_disputes_idx on public.cases (group_id) where status = 'open' and subject_kind is not null;

-- ============================================================================================ what can be disputed
-- The values that are rules, by table. Anything else is refused. (Scores and names are never disputable here.)
create or replace function private.dispute_fields(p_table text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_table
    when 'rounds' then array['comp_bonus', 'min_drives', 'rules', 'format', 'ctp_holes', 'ld_holes', 'own_comps']
    when 'teams' then array['handicap']
    when 'round_games' then array['stake', 'options', 'settings']
    when 'cup_matches' then array['points', 'a_hcp', 'b_hcp']
    when 'trips' then array['cup_points']
    when 'comps' then array['settings']
    when 'side_comp_defs' then array['how', 'unit', 'scoring', 'settings', 'conditions']
    when 'trophies' then array['description']
    when 'custom_games' then array['rules_text', 'settings']
    when 'rules' then array['value', 'title', 'detail']
    when 'standard' then array['rule']
    else array[]::text[] end
$$;
revoke all on function private.dispute_fields(text) from public, anon, authenticated;

-- Checks a reference and returns it tidied, with the value as it stands now (read here, never taken from the app —
-- except for a standard rule, which lives in the app: then the app's words, up to 200 letters).
create or replace function private.dispute_ref(p_group uuid, p_ref jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := coalesce(p_ref, '{}'::jsonb); v_table text; v_field text; v_key text; v_id uuid; v_val jsonb; v_found boolean;
        v_where jsonb := '{}'::jsonb; k text; v_rule uuid;
begin
  if jsonb_typeof(r) <> 'object' then raise exception 'Pick what you''re disputing'; end if;
  v_table := r->>'table'; v_field := r->>'field'; v_key := nullif(r->>'key', '');
  if v_table is null or not (v_field = any (private.dispute_fields(v_table))) then raise exception 'That can''t be disputed'; end if;
  if v_key is not null and v_key !~ '^[a-z0-9_.-]{1,60}$' then raise exception 'That can''t be disputed'; end if;
  if v_table = 'standard' then
    if v_key is null then raise exception 'Which rule?'; end if;
    v_val := to_jsonb(left(coalesce(r->>'value', ''), 200));
  else
    begin v_id := (r->>'id')::uuid; exception when others then raise exception 'That can''t be disputed'; end;
    if v_id is null then raise exception 'That can''t be disputed'; end if;
    -- The table and field are from the fixed list above, so naming them here is safe.
    execute format('select true, to_jsonb(t) -> %L from public.%I t where t.id = $1 and t.group_id = $2', v_field, v_table)
      into v_found, v_val using v_id, p_group;
    if v_found is null then raise exception 'That isn''t one of this group''s'; end if;
    if v_key is not null and jsonb_typeof(v_val) = 'object' then v_val := v_val -> v_key; end if;
    if octet_length(coalesce(v_val, 'null'::jsonb)::text) > 600 then v_val := to_jsonb(left(v_val::text, 600)); end if;
  end if;
  -- Where it was seen (links back): only ids, only of this group's rounds / trips / comps.
  if jsonb_typeof(r->'where') = 'object' then
    foreach k in array array['round_id', 'trip_id', 'comp_id'] loop
      if r->'where' ? k then
        begin
          if (k = 'round_id' and exists (select 1 from public.rounds where id = (r->'where'->>k)::uuid and group_id = p_group))
             or (k = 'trip_id' and exists (select 1 from public.trips where id = (r->'where'->>k)::uuid and group_id = p_group))
             or (k = 'comp_id' and exists (select 1 from public.comps where id = (r->'where'->>k)::uuid and group_id = p_group)) then
            v_where := v_where || jsonb_build_object(k, r->'where'->>k);
          end if;
        exception when others then null;
        end;
      end if;
    end loop;
    if r->'where' ? 'path' and (r->'where'->>'path') ~ '^/[A-Za-z0-9/_?=&.-]{0,119}$' then
      v_where := v_where || jsonb_build_object('path', r->'where'->>'path');
    end if;
  end if;
  -- The Rulebook rule it comes from, if any (must be one of this group's, in force).
  v_rule := case when v_table = 'rules' then v_id end;
  if v_rule is null and nullif(r->>'rule_id', '') is not null then
    begin v_rule := (r->>'rule_id')::uuid; exception when others then v_rule := null; end;
  end if;
  if v_rule is not null and not exists (select 1 from public.rules where id = v_rule and group_id = p_group and status = 'active') then
    if v_table = 'rules' then raise exception 'Pick a rule that''s in force'; end if;
    v_rule := null;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('table', v_table, 'id', v_id, 'field', v_field, 'key', v_key, 'value', v_val,
    'label', nullif(left(btrim(coalesce(r->>'label', '')), 120), ''), 'where', v_where, 'rule_id', v_rule));
end $$;
revoke all on function private.dispute_ref(uuid, jsonb) from public, anon, authenticated;

-- ============================================================================================ raising a dispute
create or replace function public.raise_dispute(p_ref jsonb, p_title text, p_body text default null, p_suggest text default null,
  p_evidence_url text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_me uuid; s jsonb; ref jsonb; v_rule uuid; v_id uuid; v_stage text; v_last_start date;
        v_kind text; v_title text := btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]+', ' ', 'g'));
begin
  if v_g is null or not private.is_group_member(v_g) then raise exception 'Join a group first'; end if;
  if private.is_group_guest(v_g) then raise exception 'Guests can''t raise cases'; end if;
  v_me := private.my_player_id(v_g);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if not public.feature_on(v_g, 'tribunal') then raise exception 'The Tribunal is switched off for this group'; end if;
  perform private.require_case_feature(v_g, 'ruling');
  s := private.gov_settings(v_g, 'ruling');
  if s->>'raise_by' = 'organisers' and not private.is_group_organiser(v_g) then raise exception 'Only organisers can raise this kind of case'; end if;
  if length(v_title) not between 3 and 140 then raise exception 'Give the case a title (3–140 characters)'; end if;
  if p_evidence_url is not null and length(p_evidence_url) > 400 then raise exception 'That photo link is too long'; end if;

  ref := private.dispute_ref(v_g, p_ref);
  v_kind := case ref->>'table' when 'rules' then 'rule' when 'standard' then 'standard' else 'setting' end;
  if exists (select 1 from public.cases where group_id = v_g and status = 'open' and raised_by = v_me and subject_kind is not null
               and subject_ref->>'table' = ref->>'table' and coalesce(subject_ref->>'id', '') = coalesce(ref->>'id', '')
               and subject_ref->>'field' = ref->>'field' and coalesce(subject_ref->>'key', '') = coalesce(ref->>'key', '')) then
    raise exception 'You''ve already raised this — see the case';
  end if;
  v_rule := nullif(ref->>'rule_id', '')::uuid;
  if v_rule is not null then
    -- A Rulebook rule: one open case at a time, and a failed challenge waits for the next trip (as 061).
    if exists (select 1 from public.cases where rule_id = v_rule and status = 'open') then raise exception 'This rule already has an open case'; end if;
    select max(start_date) into v_last_start from public.trips where group_id = v_g and start_date <= (now() at time zone 'Australia/Sydney')::date;
    if exists (select 1 from public.cases where rule_id = v_rule and status = 'failed' and kind in ('change_rule','scrap_rule','ruling')
               and (decided_at at time zone 'Australia/Sydney')::date >= coalesce(v_last_start, '-infinity'::date)) then
      raise exception 'A challenge to this rule failed — it can be raised again from the next trip';
    end if;
  end if;

  v_stage := case when s->>'decides' in ('organiser', 'trip_organiser') then 'organiser' else 'voting' end;
  if s->>'decides' = 'committee' and coalesce(cardinality(private.committee_members(v_g, nullif(s->>'committee_id', '')::uuid)), 0) = 0 then
    v_stage := 'fallback';
  end if;
  insert into public.cases (group_id, kind, title, body, rule_id, committee_id, proposal, evidence_url, raised_by, raised_via, settings,
    stage, closes_at, subject_kind, subject_ref)
  values (v_g, 'ruling', v_title, nullif(left(btrim(coalesce(p_body, '')), 2000), ''), v_rule, nullif(s->>'committee_id', '')::uuid,
    jsonb_strip_nulls(jsonb_build_object('answer', nullif(left(btrim(coalesce(p_suggest, '')), 300), ''))),
    p_evidence_url, v_me, 'app', s, v_stage, now() + make_interval(hours => coalesce((s->>'close_hours')::int, 48)), v_kind, ref)
  returning id into v_id;
  perform private.gov_post(v_g, '⚖️ Disputed: ' || v_title, v_me, v_id, p_evidence_url);
  if s->>'decides' = 'committee' then
    perform private.gov_queue(v_g, private.committee_members(v_g, nullif(s->>'committee_id', '')::uuid), 'case_committee', '⚖️ For your committee: ' || v_title, null, v_me);
  end if;
  perform private.gov_queue(v_g, null, 'case_new', '⚖️ Disputed: ' || v_title, null, v_me);
  return v_id;
exception when unique_violation then
  raise exception 'You''ve already raised this — see the case';
end $$;
revoke all on function public.raise_dispute(jsonb, text, text, text, text) from public, anon;
grant execute on function public.raise_dispute(jsonb, text, text, text, text) to authenticated;
revoke execute on function public.raise_dispute(jsonb, text, text, text, text) from service_role;

select private.add_same_group_checks();
