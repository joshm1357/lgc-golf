-- 087 — Dispute a player's handicap (ov15, 22 Oct 2026). ADDITIVE ONLY: nothing is dropped, renamed or removed.
-- Three existing functions are replaced with the same names, arguments and results, each only gaining one more case:
--   private.dispute_fields   'players' → ['handicap'] (everything 082 allowed is still allowed)
--   private.dispute_value    players.handicap: a number from −10 to 54 (same as a team handicap)
--   public.apply_dispute_verdict  when the setting is players.handicap, the change is recorded in the handicap
--                            history as "Tribunal verdict (dispute)" with the case (the handicap guard, 022, writes it)
-- Older app versions never send 'players', so they behave exactly as before.
--
-- Why: the players list (Players & group) shows everyone's handicap. Only organisers change one; anyone else taps it
-- and disputes it (raise_dispute, 082). If the Tribunal upholds it, an organiser applies the verdict from the case
-- (apply_dispute_verdict, 084) — still only an organiser, only once, only an upheld verdict.
--
-- Staging first (ttkaojaqhckiwpgrpxkh). Live only after Josh's OK.

-- ============================================================================================ what can be disputed
create or replace function private.dispute_fields(p_table text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_table
    when 'rounds' then array['comp_bonus', 'min_drives', 'rules', 'format', 'ctp_holes', 'ld_holes', 'own_comps']
    when 'teams' then array['handicap']
    when 'players' then array['handicap']
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

-- ============================================================================================ checking a new value
create or replace function private.dispute_value(p_table text, p_field text, p_value jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare t text := jsonb_typeof(p_value); n numeric; a jsonb; s text;
begin
  -- Whole numbers / numbers with a range.
  if (p_table, p_field) in (('rounds','comp_bonus'), ('rounds','min_drives'), ('teams','handicap'), ('players','handicap'), ('round_games','stake'),
                            ('cup_matches','points'), ('cup_matches','a_hcp'), ('cup_matches','b_hcp'), ('trips','cup_points')) then
    if t = 'null' and (p_table, p_field) in (('rounds','min_drives'), ('trips','cup_points')) then return 'null'::jsonb; end if;
    begin n := (p_value #>> '{}')::numeric; exception when others then raise exception 'That needs to be a number'; end;
    if n is null then raise exception 'That needs to be a number'; end if;
    if p_field = 'comp_bonus' and (n <> trunc(n) or n < 0 or n > 10) then raise exception 'Side comp strokes: a whole number from 0 to 10'; end if;
    if p_field = 'min_drives' and (n <> trunc(n) or n < 0 or n > 9) then raise exception 'Minimum drives: a whole number from 0 to 9'; end if;
    if p_table = 'teams' and (n < -10 or n > 54) then raise exception 'A team handicap is between −10 and 54'; end if;
    if p_table = 'players' and (n < -10 or n > 54) then raise exception 'A handicap is between −10 and 54'; end if;
    if p_field in ('a_hcp', 'b_hcp') and (n < -10 or n > 54) then raise exception 'A handicap is between −10 and 54'; end if;
    if p_field = 'stake' and (n < 0 or n > 1000 or n * 100 <> trunc(n * 100)) then raise exception 'A stake is dollars and cents, up to $1000'; end if;
    if p_field = 'points' and (n <= 0 or n > 10) then raise exception 'A match is worth more than 0 and up to 10 points'; end if;
    if p_field = 'cup_points' and (n < 0 or n > 200) then raise exception 'The Cup is worth 0 to 200 points'; end if;
    return to_jsonb(n);
  end if;
  -- Holes.
  if (p_table, p_field) in (('rounds','ctp_holes'), ('rounds','ld_holes')) then
    if t <> 'array' or jsonb_array_length(p_value) > 18 then raise exception 'Holes: a list of hole numbers'; end if;
    if exists (select 1 from jsonb_array_elements_text(p_value) h where h !~ '^([1-9]|1[0-8])$') then raise exception 'Holes are 1 to 18'; end if;
    select coalesce(jsonb_agg(distinct (h)::int order by (h)::int), '[]'::jsonb) into a from jsonb_array_elements_text(p_value) h;
    return a;
  end if;
  -- Words.
  if (p_table, p_field) in (('rounds','rules'), ('side_comp_defs','how'), ('side_comp_defs','unit'), ('trophies','description'), ('custom_games','rules_text')) then
    if t not in ('string', 'null') then raise exception 'That needs to be words'; end if;
    s := nullif(btrim(coalesce(p_value #>> '{}', '')), '');
    if p_field = 'how' and coalesce(s, '') not in ('lowest', 'highest', 'pick') then raise exception 'How it''s won: lowest, highest or pick'; end if;
    if p_field = 'unit' and length(coalesce(s, '')) > 12 then raise exception 'A unit is up to 12 letters'; end if;
    if p_field = 'rules' and length(coalesce(s, '')) > 1000 then raise exception 'Up to 1000 letters'; end if;
    if p_field = 'description' and length(coalesce(s, '')) > 500 then raise exception 'Up to 500 letters'; end if;
    if p_field = 'rules_text' and length(coalesce(s, '')) > 2000 then raise exception 'Up to 2000 letters'; end if;
    return to_jsonb(s);
  end if;
  raise exception 'This one can''t be changed from the case — change it where it''s set';
end $$;
revoke all on function private.dispute_value(text, text, jsonb) from public, anon, authenticated;

-- ============================================================================================ applying the verdict
create or replace function public.apply_dispute_verdict(p_case uuid, p_value jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cases; r jsonb; v_table text; v_field text; v_id uuid; v_now jsonb; v_found boolean; v_new jsonb; v_me uuid; v_label text;
        v_words text;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not (c.group_id = any (private.my_group_ids())) then raise exception 'Case not found'; end if;
  if not private.is_group_organiser(c.group_id) then raise exception 'Only an organiser can apply a verdict'; end if;
  if c.subject_kind is distinct from 'setting' or c.kind <> 'ruling' then raise exception 'This case isn''t about a setting'; end if;
  if c.status <> 'passed' then raise exception 'Only an upheld verdict can be applied'; end if;
  if c.setting_applied_at is not null then raise exception 'This verdict has already been applied'; end if;
  r := c.subject_ref; v_table := r->>'table'; v_field := r->>'field';
  if not (v_field = any (private.dispute_fields(v_table))) or v_table in ('rules', 'standard') or nullif(r->>'key', '') is not null then
    raise exception 'This one can''t be changed from the case — change it where it''s set';
  end if;
  v_id := (r->>'id')::uuid;
  v_new := private.dispute_value(v_table, v_field, p_value);
  -- The table and field come from the fixed list (dispute_fields), so naming them here is safe.
  execute format('select true, to_jsonb(t) -> %L from public.%I t where t.id = $1 and t.group_id = $2 for update', v_field, v_table)
    into v_found, v_now using v_id, c.group_id;
  if v_found is null then raise exception 'That setting isn''t there any more'; end if;
  if v_now is distinct from (r->'value') and not coalesce(p_force, false) then
    return jsonb_build_object('status', 'changed', 'now', v_now, 'raised', r->'value');
  end if;
  if v_new is not distinct from v_now then raise exception 'That''s what it already is'; end if;
  -- A player's handicap (087): the handicap guard records it in the handicap history as the Tribunal's verdict.
  if v_table = 'players' then
    perform set_config('app.handicap_reason', 'Tribunal verdict (dispute)', true);
    perform set_config('app.case_id', c.id::text, true);
  end if;
  -- Write it. Arrays become int[]; the table's own triggers (feature switches, checks) still run.
  if jsonb_typeof(v_new) = 'array' then
    execute format('update public.%I set %I = (select coalesce(array_agg(x::int), ''{}'') from jsonb_array_elements_text($1) x) where id = $2', v_table, v_field)
      using v_new, v_id;
  else
    execute format('update public.%I t set %I = (jsonb_populate_record(t, jsonb_build_object(%L, $1))).%I where id = $2', v_table, v_field, v_field, v_field)
      using v_new, v_id;
  end if;
  v_me := private.my_player_id(c.group_id);
  update public.cases set setting_applied_by = v_me, setting_applied_at = now(),
    setting_change = jsonb_build_object('field', v_field, 'old', v_now, 'new', v_new, 'raised', r->'value', 'forced', coalesce(p_force, false) and v_now is distinct from (r->'value'))
  where id = c.id;
  v_label := coalesce(r->>'label', v_field);
  v_words := coalesce(v_now #>> '{}', 'not set') || ' → ' || coalesce(v_new #>> '{}', 'not set');
  if not c.hidden then
    perform private.gov_post(c.group_id, '⚖️ Verdict applied: ' || left(v_label, 100) || ' — ' || left(v_words, 200), v_me, c.id);
  end if;
  return jsonb_build_object('status', 'applied', 'old', v_now, 'new', v_new);
end $$;
revoke all on function public.apply_dispute_verdict(uuid, jsonb, boolean) from public, anon;
grant execute on function public.apply_dispute_verdict(uuid, jsonb, boolean) to authenticated;
revoke execute on function public.apply_dispute_verdict(uuid, jsonb, boolean) from service_role;
