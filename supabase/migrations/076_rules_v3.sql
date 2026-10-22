-- 076 — The Rulebook v3: layers of rules, comp-specific rules, and verdicts turned into rule changes (22 Oct 2026).
-- ADDITIVE ONLY: new nullable columns, trigger functions, one new function, and three functions replaced with the same
-- behaviour plus the new columns. Nothing is dropped or renamed, so older app versions keep working: they see a
-- comp-specific rule as an ordinary rule (title, wording, applies_to) and never send the new columns.
--
-- Layers (most general first; the app's src/lib/rulelayers.js works out what applies — the database only stores):
--   rules of golf (standard, in the app) → format rules (standard, in the app) → the group's local rules →
--   format-specific local rules → comp-specific rules (a comp, trophy, game, custom game or side comp).
--
-- 1. rules.scope_kind / scope_id / scope_key — what a rule belongs to (all null = a group-wide local rule):
--      'format'      scope_key = stableford | ambrose | stroke | fourball | cup
--      'comp'        scope_id = comps.id (same group)
--      'trophy'      scope_id = trophies.id (same group)
--      'game'        scope_key = skins | nassau | stableford_pot | birdie_pool | eclectic (every game of that kind)
--                    or scope_id = round_games.id (one game on one round)
--      'custom_game' scope_id = custom_games.id (same group)
--      'side_comp'   scope_key = ctp | ld, or scope_id = side_comp_defs.id (same group)
--    Checked by a trigger: the target must be the group's own.
-- 2. rules.overrides_rule — the group's own rule this one changes (073's rules.overrides stays for a standard rule id,
--    which can't hold a rule id because of its check). Same group, never itself.
-- 3. rule_versions keeps the scope and overrides of each version; a change of scope or overrides counts as a change
--    of the rule (a new version, and the group's decision rule for changing rules applies).
-- 4. apply_verdict_draft(case, draft): after a rule case (new rule, change, scrap, ruling) has passed, an organiser
--    confirms the exact rule change (drafted by the AI from the verdict, or typed from the case's own text). It goes in
--    through the normal Rulebook path — the history trigger records it against the case. A change still waiting for
--    the next trip is stored on the case and applied with it (case_apply now also applies scope and overrides).

-- ============================================================================================ 1–2. columns
alter table public.rules add column if not exists scope_kind text
  check (scope_kind is null or scope_kind in ('comp', 'trophy', 'game', 'custom_game', 'side_comp', 'format'));
alter table public.rules add column if not exists scope_id uuid;
alter table public.rules add column if not exists scope_key text
  check (scope_key is null or scope_key ~ '^[a-z_]{2,20}$');
alter table public.rules add column if not exists overrides_rule uuid references public.rules(id) on delete set null;
create index if not exists rules_scope_idx on public.rules (group_id, scope_kind, scope_id);
create index if not exists rules_overrides_rule_idx on public.rules (overrides_rule);

alter table public.rule_versions add column if not exists scope_kind text;
alter table public.rule_versions add column if not exists scope_id uuid;
alter table public.rule_versions add column if not exists scope_key text;
alter table public.rule_versions add column if not exists overrides text;
alter table public.rule_versions add column if not exists overrides_rule uuid;

-- Returns null when the scope is fine, else the problem.
create or replace function private.rule_scope_problem(p_group uuid, p_kind text, p_id uuid, p_key text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_kind is null then
    if p_id is not null or p_key is not null then return 'Pick what the rule is for'; end if;
    return null;
  end if;
  if p_kind = 'format' then
    if p_id is not null or coalesce(p_key, '') not in ('stableford', 'ambrose', 'stroke', 'fourball', 'cup') then return 'That isn''t a format'; end if;
  elsif p_kind = 'comp' then
    if p_key is not null or p_id is null or not exists (select 1 from public.comps where id = p_id and group_id = p_group) then return 'That comp isn''t one of this group''s'; end if;
  elsif p_kind = 'trophy' then
    if p_key is not null or p_id is null or not exists (select 1 from public.trophies where id = p_id and group_id = p_group) then return 'That trophy isn''t one of this group''s'; end if;
  elsif p_kind = 'custom_game' then
    if p_key is not null or p_id is null or not exists (select 1 from public.custom_games where id = p_id and group_id = p_group) then return 'That game isn''t one of this group''s'; end if;
  elsif p_kind = 'game' then
    if (p_id is null) = (p_key is null) then return 'Pick a game'; end if;
    if p_key is not null and p_key not in ('skins', 'nassau', 'stableford_pot', 'birdie_pool', 'eclectic') then return 'That isn''t a game'; end if;
    if p_id is not null and not exists (select 1 from public.round_games where id = p_id and group_id = p_group) then return 'That game isn''t one of this group''s'; end if;
  elsif p_kind = 'side_comp' then
    if (p_id is null) = (p_key is null) then return 'Pick a side comp'; end if;
    if p_key is not null and p_key not in ('ctp', 'ld') then return 'That isn''t a side comp'; end if;
    if p_id is not null and not exists (select 1 from public.side_comp_defs where id = p_id and group_id = p_group) then return 'That side comp isn''t one of this group''s'; end if;
  end if;
  return null;
end $$;
revoke all on function private.rule_scope_problem(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function private.rules_scope_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_problem text;
begin
  -- Old app versions never send the new columns: an update that doesn't change them is never checked.
  if tg_op = 'UPDATE' and (new.scope_kind, new.scope_id, new.scope_key, new.overrides_rule, new.group_id)
       is not distinct from (old.scope_kind, old.scope_id, old.scope_key, old.overrides_rule, old.group_id) then
    return new;
  end if;
  v_problem := private.rule_scope_problem(new.group_id, new.scope_kind, new.scope_id, new.scope_key);
  if v_problem is not null then raise exception '%', v_problem; end if;
  if new.overrides_rule is not null then
    if new.overrides_rule = new.id then raise exception 'A rule can''t change itself'; end if;
    if not exists (select 1 from public.rules where id = new.overrides_rule and group_id = new.group_id) then
      raise exception 'The rule it changes isn''t one of this group''s';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.rules_scope_check() from public, anon, authenticated;
create or replace trigger ac_rules_scope_check before insert or update on public.rules
  for each row execute function private.rules_scope_check();

-- ============================================================================================ 3. history + guard
-- As 061b, plus the scope and overrides (a change to them is a change to the rule).
create or replace function private.gov_rule_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ver int; v_event text; v_case uuid := nullif(current_setting('app.gov_case', true), '')::uuid; v_wording boolean;
begin
  begin
    if tg_op = 'INSERT' then
      v_ver := 1;
      v_event := case new.status when 'proposed' then 'proposed' when 'active' then 'added' else new.status end;
      if v_event not in ('proposed','added','rejected','retired') then v_event := 'recorded'; end if;
    else
      v_wording := (new.title, new.detail, new.value, new.category, new.applies_to, new.scope_kind, new.scope_id, new.scope_key, new.overrides, new.overrides_rule)
        is distinct from (old.title, old.detail, old.value, old.category, old.applies_to, old.scope_kind, old.scope_id, old.scope_key, old.overrides, old.overrides_rule);
      if not v_wording and new.status is not distinct from old.status then return new; end if;
      select coalesce(max(version), 0) into v_ver from public.rule_versions where rule_id = new.id;
      if v_ver = 0 then v_ver := 1; elsif v_wording and old.status = 'active' then v_ver := v_ver + 1; end if;
      v_event := case
        when new.status is distinct from old.status and new.status = 'active' and old.status = 'proposed' then 'adopted'
        when new.status is distinct from old.status and new.status = 'active' then 'restored'
        when new.status is distinct from old.status and new.status = 'retired' then 'retired'
        when new.status is distinct from old.status and new.status = 'rejected' then 'rejected'
        when new.status is distinct from old.status and new.status = 'proposed' then 'proposed'
        else 'changed' end;
    end if;
    insert into public.rule_versions (group_id, rule_id, version, event, title, detail, value, category, applies_to, status, case_id, changed_by, note,
      scope_kind, scope_id, scope_key, overrides, overrides_rule)
    values (new.group_id, new.id, v_ver, v_event, new.title, new.detail, new.value, new.category, new.applies_to, new.status,
      coalesce(v_case, (select id from public.cases where rule_id = new.id order by created_at desc limit 1)),
      private.my_player_id(new.group_id), new.decision_note,
      new.scope_kind, new.scope_id, new.scope_key, new.overrides, new.overrides_rule);
  exception when others then
    raise warning 'rule history: %', sqlerrm;   -- never stop a Rulebook change from an old app
  end;
  return new;
end $$;
revoke all on function private.gov_rule_history() from public, anon, authenticated;

-- As 061, plus: changing an active rule's scope or what it overrides is a change (the group's change rule applies).
create or replace function private.gov_rules_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_server boolean := coalesce(current_setting('app.gov_apply', true), '') = 'on';
        s_new text; s_change text; s_scrap text; v_wording boolean;
begin
  if v_server then return new; end if;
  s_new := private.gov_settings(new.group_id, 'new_rule')->>'decides';
  if tg_op = 'INSERT' then
    if new.status = 'active' and s_new <> 'organiser' and private.feature_on_safe(new.group_id, 'rule_voting')
       and exists (select 1 from public.rules where group_id = new.group_id and status = 'active') then
      raise exception 'Your group votes on new rules — put it up for a vote';
    end if;
    return new;
  end if;
  if old.status = 'proposed' and new.status in ('active', 'rejected') and s_new <> 'organiser' then
    raise exception 'Your group votes on new rules — the Tribunal decides this one';
  end if;
  if old.status = 'active' then
    v_wording := (new.title, new.detail, new.value, new.category, new.applies_to, new.scope_kind, new.scope_id, new.scope_key, new.overrides, new.overrides_rule)
      is distinct from (old.title, old.detail, old.value, old.category, old.applies_to, old.scope_kind, old.scope_id, old.scope_key, old.overrides, old.overrides_rule);
    s_change := private.gov_settings(new.group_id, 'change_rule')->>'decides';
    s_scrap := private.gov_settings(new.group_id, 'scrap_rule')->>'decides';
    if v_wording and s_change <> 'organiser' then raise exception 'Your group changes rules by vote — challenge the rule instead'; end if;
    if new.status in ('retired', 'rejected') and s_scrap <> 'organiser' then raise exception 'Your group scraps rules by vote — challenge the rule instead'; end if;
  end if;
  return new;
end $$;
revoke all on function private.gov_rules_guard() from public, anon, authenticated;

-- ============================================================================================ 4. verdict → rule
-- As 061, plus: a change_rule case's proposal may also carry category, applies_to, scope and overrides (a confirmed
-- draft stored while the change waits for the next trip).
create or replace function private.case_apply(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases; p jsonb; s jsonb; v_seat public.committee_seats; v_tally text;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or c.status <> 'passed' or c.apply_state = 'applied' then return; end if;
  p := c.proposal;
  v_tally := coalesce(c.votes_for, 0) || '–' || coalesce(c.votes_against, 0);
  perform set_config('app.gov_apply', 'on', true);
  perform set_config('app.gov_case', c.id::text, true);
  if c.kind = 'new_rule' then
    update public.rules set status = 'active', decided_at = now(),
      decision_note = coalesce(nullif(c.verdict, ''), 'Passed by the Tribunal ' || v_tally || '.')
    where id = c.rule_id and status = 'proposed';
  elsif c.kind = 'change_rule' then
    update public.rules set
      title = coalesce(nullif(btrim(p->>'title'), ''), title),
      detail = case when p ? 'detail' then nullif(btrim(p->>'detail'), '') else detail end,
      value = case when p ? 'value' then nullif(btrim(p->>'value'), '') else value end,
      category = case when p ? 'category' and p->>'category' in ('format','side_comp','bonus','handicap','etiquette','fines','other') then p->>'category' else category end,
      applies_to = case when jsonb_typeof(p->'applies_to') = 'array' and jsonb_array_length(p->'applies_to') > 0
                        then array(select jsonb_array_elements_text(p->'applies_to')) else applies_to end,
      -- Scope and overrides only from a draft an organiser checked (apply_verdict_draft validates it and sets
      -- draft_applied_at), never straight from whoever raised the case (release review B1).
      scope_kind = case when p ? 'draft_applied_at' and p ? 'scope_kind' then nullif(p->>'scope_kind', '') else scope_kind end,
      scope_id = case when p ? 'draft_applied_at' and p ? 'scope_kind' then nullif(p->>'scope_id', '')::uuid else scope_id end,
      scope_key = case when p ? 'draft_applied_at' and p ? 'scope_kind' then nullif(p->>'scope_key', '') else scope_key end,
      overrides = case when p ? 'draft_applied_at' and p ? 'overrides' then nullif(p->>'overrides', '') else overrides end,
      overrides_rule = case when p ? 'draft_applied_at' and p ? 'overrides_rule' then nullif(p->>'overrides_rule', '')::uuid else overrides_rule end,
      decision_note = 'Changed by the Tribunal ' || v_tally || '.'
    where id = c.rule_id and status = 'active';
  elsif c.kind = 'scrap_rule' then
    update public.rules set status = 'retired', decided_at = now(), decision_note = 'Scrapped by the Tribunal ' || v_tally || '.'
    where id = c.rule_id and status = 'active';
  elsif c.kind = 'governance' then
    if p ? 'preset' then
      perform private.gov_apply_preset(c.group_id, p->>'preset', c.raised_by);
    else
      perform private.gov_write(c.group_id, p->>'target_kind', private.gov_settings(c.group_id, p->>'target_kind') || coalesce(p->'settings', '{}'::jsonb));
      insert into public.governance_group (group_id, preset, updated_at) values (c.group_id, 'custom', now())
      on conflict (group_id) do update set preset = 'custom', updated_at = now();
    end if;
  elsif c.kind = 'election' then
    insert into public.committee_seats (group_id, committee_id, seat_no, player_id, started_at)
    values (c.group_id, (p->>'committee_id')::uuid, (p->>'seat_no')::int, (p->>'candidate')::uuid, now())
    on conflict (committee_id, seat_no) do update set player_id = excluded.player_id, started_at = now(), reminded_at = null, election_opened_at = null;
  end if;
  perform set_config('app.gov_apply', '', true);
  perform set_config('app.gov_case', '', true);
  update public.cases set apply_state = 'applied', applied_at = now() where id = p_case;
end $$;
revoke all on function private.case_apply(uuid) from public, anon, authenticated;

-- An organiser confirms the rule change a passed rule case leads to. p_draft:
--   { action: 'add' | 'change', rule_id (change: the rule; defaults to the case's), title, detail, value, category,
--     applies_to, scope_kind, scope_id, scope_key, overrides, overrides_rule }
-- new_rule / change_rule: always a change to the case's rule. ruling: add a new rule, or change the case's rule.
-- scrap_rule: nothing to write (the verdict already retires it). Returns the rule's id. Once only per case.
create or replace function public.apply_verdict_draft(p_case uuid, p_draft jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.cases; d jsonb := coalesce(p_draft, '{}'::jsonb); v_action text; v_rule public.rules; v_id uuid;
        v_title text; v_detail text; v_value text; v_cat text; v_applies text[]; v_problem text; v_waiting boolean;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not (c.group_id = any (private.my_group_ids())) then raise exception 'Case not found'; end if;
  if not private.is_group_organiser(c.group_id) then raise exception 'Only an organiser can write a verdict into the Rulebook'; end if;
  perform private.require_case_feature(c.group_id, c.kind);
  if c.kind not in ('new_rule', 'change_rule', 'ruling') then raise exception 'This kind of case doesn''t change the wording of a rule'; end if;
  if c.status <> 'passed' then raise exception 'Only a case that passed changes the Rulebook'; end if;
  if c.proposal ? 'draft_applied_at' then raise exception 'This verdict is already in the Rulebook'; end if;
  if jsonb_typeof(d) <> 'object' or octet_length(d::text) > 4000 then raise exception 'That rule change is too long'; end if;

  v_action := coalesce(d->>'action', 'change');
  if c.kind in ('new_rule', 'change_rule') then v_action := 'change'; end if;
  if v_action not in ('add', 'change') then raise exception 'A rule is added or changed'; end if;
  v_title := btrim(coalesce(d->>'title', ''));
  v_detail := nullif(btrim(coalesce(d->>'detail', '')), '');
  v_value := nullif(btrim(coalesce(d->>'value', '')), '');
  v_cat := coalesce(nullif(d->>'category', ''), 'other');
  if length(v_title) < 3 or length(v_title) > 80 then raise exception 'The rule needs a short title (3–80 letters)'; end if;
  if length(coalesce(v_detail, '')) > 1000 then raise exception 'The wording is up to 1000 letters'; end if;
  if length(coalesce(v_value, '')) > 40 then raise exception 'The amount is up to 40 letters'; end if;
  if v_cat not in ('format','side_comp','bonus','handicap','etiquette','fines','other') then raise exception 'That isn''t a type of rule'; end if;
  if jsonb_typeof(d->'applies_to') = 'array' and jsonb_array_length(d->'applies_to') between 1 and 7 then
    v_applies := array(select jsonb_array_elements_text(d->'applies_to'));
    if not (v_applies <@ array['all','stableford','ambrose','stroke','fourball','cup','trip']) then raise exception 'That isn''t something a rule applies to'; end if;
  end if;
  v_problem := private.rule_scope_problem(c.group_id, nullif(d->>'scope_kind', ''), nullif(d->>'scope_id', '')::uuid, nullif(d->>'scope_key', ''));
  if v_problem is not null then raise exception '%', v_problem; end if;
  if nullif(d->>'overrides', '') is not null and (d->>'overrides') !~ '^[a-z0-9_]{2,30}\.[a-z0-9_]{2,30}$' then raise exception 'That isn''t a standard rule'; end if;
  if nullif(d->>'overrides_rule', '') is not null and not exists (select 1 from public.rules where id = (d->>'overrides_rule')::uuid and group_id = c.group_id) then
    raise exception 'The rule it changes isn''t one of this group''s';
  end if;

  perform set_config('app.gov_apply', 'on', true);
  perform set_config('app.gov_case', c.id::text, true);
  if v_action = 'add' then
    insert into public.rules (group_id, title, detail, value, category, applies_to, status, proposed_by, decided_at, decision_note,
      scope_kind, scope_id, scope_key, overrides, overrides_rule, sort)
    values (c.group_id, v_title, v_detail, v_value, v_cat, coalesce(v_applies, '{all}'), 'active', c.raised_by, now(),
      'From the Tribunal’s ruling: ' || left(c.title, 120),
      nullif(d->>'scope_kind', ''), nullif(d->>'scope_id', '')::uuid, nullif(d->>'scope_key', ''), nullif(d->>'overrides', ''), nullif(d->>'overrides_rule', '')::uuid,
      coalesce((select max(sort) from public.rules where group_id = c.group_id), 0) + 1)
    returning id into v_id;
  else
    v_id := coalesce(case when c.kind = 'ruling' then nullif(d->>'rule_id', '')::uuid end, c.rule_id);
    select * into v_rule from public.rules where id = v_id and group_id = c.group_id;
    if v_rule.id is null then raise exception 'That rule isn''t in the Rulebook any more'; end if;
    if nullif(d->>'overrides_rule', '')::uuid = v_rule.id then raise exception 'A rule can''t change itself'; end if;
    v_waiting := c.kind = 'change_rule' and c.apply_state in ('waiting_next_trip', 'next_round');
    if v_waiting then
      -- Not in force yet: the confirmed wording goes with the case and is applied when the change starts.
      update public.cases set proposal = proposal || jsonb_strip_nulls(jsonb_build_object(
          'title', v_title, 'detail', coalesce(v_detail, ''), 'value', coalesce(v_value, ''), 'category', v_cat,
          'applies_to', to_jsonb(v_applies), 'scope_kind', coalesce(d->>'scope_kind', ''), 'scope_id', coalesce(d->>'scope_id', ''),
          'scope_key', coalesce(d->>'scope_key', ''), 'overrides', coalesce(d->>'overrides', ''), 'overrides_rule', coalesce(d->>'overrides_rule', '')))
      where id = c.id;
    else
      update public.rules set title = v_title, detail = v_detail, value = v_value, category = v_cat,
        applies_to = coalesce(v_applies, applies_to),
        scope_kind = nullif(d->>'scope_kind', ''), scope_id = nullif(d->>'scope_id', '')::uuid, scope_key = nullif(d->>'scope_key', ''),
        overrides = nullif(d->>'overrides', ''), overrides_rule = nullif(d->>'overrides_rule', '')::uuid,
        decision_note = case when status = 'active' then 'Worded from the Tribunal’s verdict: ' || left(c.title, 120) else decision_note end
      where id = v_id;
    end if;
  end if;
  perform set_config('app.gov_apply', '', true);
  perform set_config('app.gov_case', '', true);
  update public.cases set proposal = proposal || jsonb_build_object('draft_applied_at', now(), 'draft_rule_id', v_id,
    'draft_by', private.my_player_id(c.group_id), 'draft_ai', coalesce((d->>'ai')::boolean, false)) where id = c.id;
  if not c.hidden then
    perform private.gov_post(c.group_id, '📘 Rulebook updated from the verdict: ' || v_title, private.my_player_id(c.group_id), c.id);
  end if;
  return v_id;
end $$;
revoke all on function public.apply_verdict_draft(uuid, jsonb) from public, anon;
grant execute on function public.apply_verdict_draft(uuid, jsonb) to authenticated;
revoke execute on function public.apply_verdict_draft(uuid, jsonb) from service_role;

-- Release review B1: a raised case can't carry the keys only a checked verdict draft may set (scope, overrides, the
-- draft marker). Stripped whenever a case is created, whoever creates it.
create or replace function private.cases_strip_draft_keys() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.proposal is not null and jsonb_typeof(new.proposal) = 'object' then
    new.proposal := new.proposal - array['draft_applied_at', 'draft_rule_id', 'draft_by', 'draft_ai',
                                         'scope_kind', 'scope_id', 'scope_key', 'overrides', 'overrides_rule'];
  end if;
  return new;
end $$;
revoke all on function private.cases_strip_draft_keys() from public, anon, authenticated;
create trigger aa_cases_strip_draft_keys before insert on public.cases
  for each row execute function private.cases_strip_draft_keys();

select private.add_same_group_checks();
