-- 073 — The Rulebook v2, standard game options, custom games and side comp conditions (22 Oct 2026). ADDITIVE ONLY:
-- new columns (all with defaults or nullable), two new tables, trigger functions. Nothing is dropped or renamed, so
-- older app versions keep working exactly as before.
--
-- 1. The Rulebook: standard rules come from the app (src/lib/standardrules.js), not the database. A group's own rule
--    can say which standard rule it changes: rules.overrides = a standard rule id like 'golf.ob' (nullable).
--    rules.applies_to (016) already says which formats / comps a rule applies to.
-- 2. Standard game options: every standard setting of a game is part of the standard game. The 055 `options` column
--    keeps its check (net / carry / scoring) for old app versions; the newer standard options go in
--    round_games.settings, checked here against an allow-list per kind (same as STANDARD_OPTIONS in games.js):
--      skins { validate: bool }   nassau { front, back, total: null | $0–1000, press: 0 | 2 | 3 }
--      stableford_pot { net: bool }   birdie_pool { eagle_double: bool }   eclectic {}
-- 3. Custom games: a standard game plus the group's own house rules (required — otherwise it's just the standard
--    game), saved under its own name for the group (custom_games). settings = the base game's standard options + a
--    default stake. Picked for a round like a standard game: round_games gets kind = base_type and
--    custom_game_id (nullable). Old app versions just see the base game with its options.
-- 4. Side comp conditions: the standard options of a measured comp ("fairway only", "first shot", "on the green
--    only"…) plus a short note: { "picks": [key…], "note": "…" }. side_comp_defs.conditions (nullable; the 068
--    `settings` can't change once set, conditions can) and, for closest to the pin / longest drive (not
--    side_comp_defs rows), the new side_comp_conditions table. Same keys as src/lib/conditions.js.

-- ============================================================================================ 1. the Rulebook
alter table public.rules add column if not exists overrides text
  check (overrides is null or overrides ~ '^[a-z0-9_]{2,30}\.[a-z0-9_]{2,30}$');

-- ===================================================================== shared: one option of a game, checked
-- Returns null when fine, else the problem. p_where: 'round' (round_games.settings) or 'custom' (custom_games.settings).
create or replace function private.game_option_problem(p_kind text, p_key text, p_val jsonb, p_where text) returns text
language plpgsql immutable set search_path = '' as $$
declare v_allowed text[];
begin
  v_allowed := case p_kind
    when 'skins' then array['validate']
    when 'nassau' then array['front', 'back', 'total', 'press']
    when 'stableford_pot' then array['net']
    when 'birdie_pool' then array['eagle_double']
    else array[]::text[] end;
  if p_where = 'custom' then
    v_allowed := v_allowed || case p_kind
      when 'skins' then array['net', 'carry'] when 'nassau' then array['net', 'scoring']
      when 'birdie_pool' then array['net'] when 'eclectic' then array['net'] else array[]::text[] end || array['stake'];
  end if;
  if not (p_key = any (v_allowed)) then return p_key || ' isn''t an option for this game'; end if;
  if p_key in ('net', 'carry', 'validate', 'eagle_double') then
    if jsonb_typeof(p_val) <> 'boolean' then return p_key || ' is yes or no'; end if;
  elsif p_key = 'scoring' then
    if coalesce(p_val #>> '{}', '') not in ('stroke', 'stableford') then return 'Nassau is strokes or Stableford points'; end if;
  elsif p_key = 'press' then
    if jsonb_typeof(p_val) <> 'number' or (p_val #>> '{}')::numeric not in (0, 2, 3) then return 'Auto-press is off, 2 or 3'; end if;
  elsif p_key in ('front', 'back', 'total', 'stake') then
    if p_key <> 'stake' and jsonb_typeof(p_val) = 'null' then return null; end if;
    if jsonb_typeof(p_val) <> 'number' or (p_val #>> '{}')::numeric < 0 or (p_val #>> '{}')::numeric > 1000 then
      return 'Money is dollars, up to $1000';
    end if;
  end if;
  return null;
end $$;
revoke all on function private.game_option_problem(text, text, jsonb, text) from public, anon, authenticated;

-- ============================================================================================ 3. custom games
create table if not exists public.custom_games (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 40),
  base_type text not null check (base_type in ('skins', 'nassau', 'stableford_pot', 'birdie_pool', 'eclectic')),
  settings jsonb not null default '{}'::jsonb,
  rules_text text not null check (length(btrim(rules_text)) between 3 and 1000),
  retired boolean not null default false,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists custom_games_group_idx on public.custom_games (group_id);
create index if not exists custom_games_created_by_idx on public.custom_games (created_by);
alter table public.custom_games enable row level security;
create policy "members read" on public.custom_games for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.custom_games for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.custom_games as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: games (add)" on public.custom_games as restrictive for insert with check (public.feature_on(group_id, 'games'));
create policy "feature on: games (change)" on public.custom_games as restrictive for update using (public.feature_on(group_id, 'games')) with check (public.feature_on(group_id, 'games'));
create policy "feature on: games (remove)" on public.custom_games as restrictive for delete using (public.feature_on(group_id, 'games'));
revoke all on public.custom_games from anon;
grant select, insert, update, delete on public.custom_games to authenticated;
create trigger aa_fill_group_id before insert or update on public.custom_games
  for each row execute function private.fill_group_id();

create or replace function private.custom_games_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; v_problem text;
begin
  if new.settings is null or jsonb_typeof(new.settings) <> 'object' or pg_column_size(new.settings) > 600 then
    raise exception 'A custom game''s settings must be a short set of options';
  end if;
  if tg_op = 'UPDATE' and new.base_type is distinct from old.base_type then
    raise exception 'A custom game''s base game can''t change — make a new one';
  end if;
  for k in select jsonb_object_keys(new.settings) loop
    v_problem := private.game_option_problem(new.base_type, k, new.settings -> k, 'custom');
    if v_problem is not null then raise exception '%', v_problem; end if;
  end loop;
  new.name := btrim(new.name);
  new.rules_text := btrim(new.rules_text);
  return new;
end $$;
revoke all on function private.custom_games_check() from public, anon, authenticated;
create or replace trigger ab_custom_games_check before insert or update on public.custom_games
  for each row execute function private.custom_games_check();

-- ================================================================== 2. round_games: standard options + link
alter table public.round_games add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.round_games add column if not exists custom_game_id uuid references public.custom_games(id) on delete set null;
create index if not exists round_games_custom_idx on public.round_games (custom_game_id);

create or replace function private.round_games_settings_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; v_problem text; c public.custom_games;
begin
  if tg_op = 'UPDATE' and new.settings is not distinct from old.settings and new.kind is not distinct from old.kind
     and new.custom_game_id is not distinct from old.custom_game_id then
    return new;   -- an old app changing the stake or options: nothing new to check
  end if;
  if new.settings is null or jsonb_typeof(new.settings) <> 'object' or pg_column_size(new.settings) > 400 then
    raise exception 'A game''s settings must be a short set of options';
  end if;
  for k in select jsonb_object_keys(new.settings) loop
    v_problem := private.game_option_problem(new.kind, k, new.settings -> k, 'round');
    if v_problem is not null then raise exception '%', v_problem; end if;
  end loop;
  if new.custom_game_id is not null and (tg_op = 'INSERT' or new.custom_game_id is distinct from old.custom_game_id or new.kind is distinct from old.kind) then
    select * into c from public.custom_games where id = new.custom_game_id;
    if c.id is null or c.group_id <> new.group_id then raise exception 'That custom game isn''t one of this group''s'; end if;
    if c.base_type <> new.kind then raise exception 'That custom game is based on a different game'; end if;
    if c.retired then raise exception 'That custom game has been put away'; end if;
  end if;
  return new;
end $$;
revoke all on function private.round_games_settings_check() from public, anon, authenticated;
create or replace trigger ac_round_games_settings before insert or update on public.round_games
  for each row execute function private.round_games_settings_check();

-- ==================================================================================== 4. side comp conditions
create or replace function private.comp_conditions_problem(c jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if c is null then return null; end if;
  if jsonb_typeof(c) <> 'object' or pg_column_size(c) > 600 then return 'Conditions must be a short set of picks and a note'; end if;
  if exists (select 1 from jsonb_object_keys(c) x where x not in ('picks', 'note')) then return 'Conditions are picks and a note'; end if;
  if c ? 'picks' then
    if jsonb_typeof(c -> 'picks') <> 'array' or jsonb_array_length(c -> 'picks') > 6 then return 'Up to 6 conditions'; end if;
    for k in select jsonb_array_elements(c -> 'picks') #>> '{}' loop
      if k is null or k not in ('fairway', 'first_shot', 'tee_shot', 'green_only', 'one_go', 'no_mulligans', 'make_par',
                                'driver_only', 'holed', 'first_putt', 'paces') then
        return 'That isn''t one of the conditions';
      end if;
    end loop;
  end if;
  if c ? 'note' and (jsonb_typeof(c -> 'note') <> 'string' or length(c ->> 'note') > 140) then return 'The note is up to 140 letters'; end if;
  return null;
end $$;
revoke all on function private.comp_conditions_problem(jsonb) from public, anon, authenticated;

alter table public.side_comp_defs add column if not exists conditions jsonb;

create or replace function private.side_comp_defs_conditions_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_problem text;
begin
  if tg_op = 'UPDATE' and new.conditions is not distinct from old.conditions then return new; end if;
  if new.conditions is null then return new; end if;
  if new.scoring is not null then raise exception 'Only a measured or picked comp has conditions'; end if;
  v_problem := private.comp_conditions_problem(new.conditions);
  if v_problem is not null then raise exception '%', v_problem; end if;
  return new;
end $$;
revoke all on function private.side_comp_defs_conditions_check() from public, anon, authenticated;
create or replace trigger ac_side_comp_defs_conditions before insert or update on public.side_comp_defs
  for each row execute function private.side_comp_defs_conditions_check();

create table if not exists public.side_comp_conditions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  comp text not null check (comp in ('ctp', 'ld')),
  conditions jsonb,
  updated_at timestamptz not null default now(),
  unique (group_id, comp)
);
alter table public.side_comp_conditions enable row level security;
create policy "members read" on public.side_comp_conditions for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.side_comp_conditions for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.side_comp_conditions as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: side_comps (add)" on public.side_comp_conditions as restrictive for insert with check (public.feature_on(group_id, 'side_comps'));
create policy "feature on: side_comps (change)" on public.side_comp_conditions as restrictive for update using (public.feature_on(group_id, 'side_comps')) with check (public.feature_on(group_id, 'side_comps'));
create policy "feature on: side_comps (remove)" on public.side_comp_conditions as restrictive for delete using (public.feature_on(group_id, 'side_comps'));
revoke all on public.side_comp_conditions from anon;
grant select, insert, update, delete on public.side_comp_conditions to authenticated;
create trigger aa_fill_group_id before insert or update on public.side_comp_conditions
  for each row execute function private.fill_group_id();

create or replace function private.side_comp_conditions_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_problem text;
begin
  v_problem := private.comp_conditions_problem(new.conditions);
  if v_problem is not null then raise exception '%', v_problem; end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.side_comp_conditions_check() from public, anon, authenticated;
create or replace trigger ab_side_comp_conditions_check before insert or update on public.side_comp_conditions
  for each row execute function private.side_comp_conditions_check();

alter publication supabase_realtime add table public.custom_games, public.side_comp_conditions;
select private.add_same_group_checks();
