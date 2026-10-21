-- 068 — The side comps library (21 Oct 2026). Additive only. Part of the side comps feature ('side_comps').
-- Organisers add comps from a catalogue with one tap (src/lib/sidecomplib.js). A library comp is still a row in
-- side_comp_defs (051) with three new columns:
--   preset   — the catalogue key it came from ('greenie', 'birdies_gross'…); null for a group's own made-up comp;
--   scoring  — null: measured or picked as before (how = lowest | highest | pick);
--              'count': a tally ("dots") — players log each time it happens, most wins;
--              'count_last': whoever logged last holds it (the snake);
--              'auto': worked out from the scores already entered — no entries at all;
--   settings — for 'auto': { "metric": ..., "basis": "gross" | "net" }; otherwise {}.
-- The existing `how` check stays as it is: the trigger below keeps `how` in step with `scoring` so older app versions
-- (which only know `how`) still show something sensible: a tally as "biggest number wins" (each dot is 1), the snake
-- as "organiser picks" (newest first = whoever holds it), and a comp worked out from the scores with no entries.
-- Also: a round can now have up to 20 of the group's own side comps (was 10).

alter table public.side_comp_defs add column if not exists preset text
  check (preset is null or preset ~ '^[a-z0-9_]{2,40}$');
alter table public.side_comp_defs add column if not exists scoring text
  check (scoring is null or scoring in ('count', 'count_last', 'auto'));
alter table public.side_comp_defs add column if not exists settings jsonb not null default '{}'::jsonb;

-- One live copy of each library comp per group (a put-away one can be brought back).
create unique index if not exists side_comp_defs_preset_idx on public.side_comp_defs (group_id, preset)
  where preset is not null and not retired;

create or replace function private.side_comp_defs_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_metric text;
begin
  if tg_op = 'UPDATE' and (new.scoring is distinct from old.scoring or new.preset is distinct from old.preset
                           or new.settings is distinct from old.settings) then
    raise exception 'A side comp''s kind can''t be changed — put it away and add it again';
  end if;
  if new.settings is null or jsonb_typeof(new.settings) <> 'object' or pg_column_size(new.settings) > 500 then
    raise exception 'Side comp settings must be a short set of options';
  end if;
  if exists (select 1 from jsonb_object_keys(new.settings) k where k not in ('metric', 'basis')) then
    raise exception 'Side comp settings can only be the metric and gross or net';
  end if;
  if new.settings ? 'basis' and coalesce(new.settings ->> 'basis', '') not in ('gross', 'net') then
    raise exception 'A side comp is gross or net';
  end if;
  if new.scoring = 'auto' then
    v_metric := new.settings ->> 'metric';
    if v_metric is null or v_metric not in ('birdies', 'pars', 'bogeys', 'wipes', 'front9', 'back9', 'par3s', 'par4s',
                                            'par5s', 'finish', 'improved') then
      raise exception 'That comp can''t be worked out from the scores';
    end if;
    new.how := case when v_metric = 'wipes' then 'lowest' else 'highest' end;
    new.unit := null;
  else
    if new.settings ? 'metric' or new.settings ? 'basis' then
      raise exception 'Only a comp worked out from the scores has a metric';
    end if;
    if new.scoring = 'count' then
      new.how := 'highest'; new.unit := null;
    elsif new.scoring = 'count_last' then
      new.how := 'pick'; new.unit := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.side_comp_defs_check() from public, anon, authenticated;
create or replace trigger ab_side_comp_defs_check before insert or update on public.side_comp_defs
  for each row execute function private.side_comp_defs_check();

-- Entries: none for a comp worked out from the scores; each tally entry is one dot (value 1).
create or replace function private.side_comp_entries_kind_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_scoring text;
begin
  select d.scoring into v_scoring from public.side_comp_defs d where d.id = new.comp_id;
  if v_scoring = 'auto' then
    raise exception 'That comp is worked out from the scores — there''s nothing to enter';
  end if;
  if v_scoring in ('count', 'count_last') then
    new.value := 1;
  end if;
  return new;
end $$;
revoke all on function private.side_comp_entries_kind_check() from public, anon, authenticated;
create or replace trigger ab_side_comp_entries_kind before insert or update on public.side_comp_entries
  for each row execute function private.side_comp_entries_kind_check();

-- rounds.own_comps: as 051b, but up to 20 comps a round.
create or replace function private.rounds_own_comps_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.own_comps is not distinct from old.own_comps then return new; end if;
  end if;
  if jsonb_typeof(new.own_comps) <> 'array' or jsonb_array_length(new.own_comps) > 20 then
    raise exception 'Up to 20 of your own side comps a round';
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

select private.add_same_group_checks();
