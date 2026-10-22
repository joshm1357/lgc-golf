-- 051b — Own side comps: review tidy-ups (21 Oct 2026). Run after 051. From the independent review:
--  * rounds.own_comps: each item is exactly { "comp": id, "holes": [...] } with at most 18 holes, and it can only be
--    changed (other than cleared) while side comps are switched on.
--  (Deleting a comp with side comps switched off is still allowed — the app never deletes comps, it "puts them away".)
--  * "Download your data" (export_group) includes the Cup and the own side comps tables.

create or replace function private.rounds_own_comps_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.own_comps is not distinct from old.own_comps then return new; end if;
  end if;
  if jsonb_typeof(new.own_comps) <> 'array' or jsonb_array_length(new.own_comps) > 10 then
    raise exception 'Up to 10 of your own side comps a round';
  end if;
  if jsonb_array_length(new.own_comps) > 0 and not public.feature_on(new.group_id, 'side_comps') then
    raise exception 'Side comps are switched off for this group';
  end if;
  -- One step at a time, so each check only sees the shape the one before it allowed.
  if exists (select 1 from jsonb_array_elements(new.own_comps) c where jsonb_typeof(c) <> 'object') then
    raise exception 'Each of your own side comps needs a comp and its holes';
  end if;
  if exists (select 1 from jsonb_array_elements(new.own_comps) c, jsonb_object_keys(c) k where k not in ('comp', 'holes'))
     or exists (select 1 from jsonb_array_elements(new.own_comps) c where jsonb_typeof(c -> 'holes') is distinct from 'array') then
    raise exception 'Each of your own side comps needs a comp and its holes';
  end if;
  if exists (select 1 from jsonb_array_elements(new.own_comps) c
             where jsonb_array_length(c -> 'holes') > 18
                or not exists (select 1 from public.side_comp_defs d where d.id::text = c ->> 'comp' and d.group_id = new.group_id)
                or exists (select 1 from jsonb_array_elements_text(c -> 'holes') h where h !~ '^([1-9]|1[0-8])$')) then
    raise exception 'That side comp isn''t one of this group''s, or a hole isn''t 1 to 18';
  end if;
  return new;
end $$;
revoke all on function private.rounds_own_comps_check() from public, anon, authenticated;

create or replace function public.export_group()
returns json language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); t text; v_out jsonb := '{}'; v_rows json;
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), true) then
    raise exception 'Add a sign-in first (Group & invites) — then you can download your group''s data';
  end if;
  foreach t in array array['players', 'handicap_history', 'trips', 'courses', 'rounds', 'round_players', 'teams', 'team_players',
    'scores', 'quick_results', 'side_entries', 'draws', 'round_pins', 'honour_board', 'trophies', 'posts', 'comments', 'reactions',
    'rules', 'rule_votes', 'tribunal_cases', 'tribunal_votes', 'plans', 'plan_polls', 'plan_options', 'plan_votes', 'plan_rsvps',
    'plan_items', 'plan_costs', 'plan_payments', 'plan_transfers', 'plan_groups', 'plan_comments',
    'cup_sides', 'cup_matches', 'side_comp_defs', 'side_comp_entries'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(json_agg(x), ''[]''::json) from public.%I x where x.group_id = $1', t) into v_rows using v_g;
      v_out := v_out || jsonb_build_object(t, v_rows);
    end if;
  end loop;
  v_out := v_out || jsonb_build_object(
    'plan_group_members', (select coalesce(json_agg(json_build_object('room_or_car', m.group_id, 'player_id', m.player_id)), '[]'::json)
                           from public.plan_group_members m join public.plan_groups pg on pg.id = m.group_id where pg.group_id = v_g),
    'features', (select coalesce(json_object_agg(feature_key, enabled), '{}'::json) from public.group_features where group_id = v_g),
    'group', (select json_build_object('name', name, 'slug', slug, 'created_at', created_at) from public.groups where id = v_g),
    'members', (select coalesce(json_agg(json_build_object('player_id', player_id, 'role', role, 'joined', created_at)), '[]'::json)
                from public.group_members where group_id = v_g),
    'exported_at', now());
  return v_out::json;
end $$;
