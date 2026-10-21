-- 051 — A group's own side comps (21 Oct 2026). Additive only. Part of the side comps feature ('side_comps').
-- Closest to the pin and longest drive stay exactly as they are (side_entries, rounds.ctp_holes / ld_holes).
-- An organiser adds the group's own comps ("Longest putt", "Nearest the pin in 2", "Best shot of the day"):
--   * how it's won: 'lowest' (smallest number wins, e.g. metres from the pin), 'highest' (biggest wins, e.g. a putt's
--     length), or 'pick' (no number: the organiser picks the winner from the entries / nominations);
--   * a unit for the number (m, ft, shots… — words only, nothing is converted);
--   * per round: which holes it's on, or the whole round (rounds.own_comps: [{ "comp": id, "holes": [n…] }], holes
--     empty = the whole round).
-- Entries (side_comp_entries) work like side_entries: anyone in the group enters, the organiser confirms a winner.

create table if not exists public.side_comp_defs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 40),
  emoji text check (emoji is null or length(emoji) <= 8),
  how text not null default 'lowest' check (how in ('lowest', 'highest', 'pick')),
  unit text check (unit is null or length(unit) <= 12),
  retired boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists side_comp_defs_group_idx on public.side_comp_defs (group_id);
alter table public.side_comp_defs enable row level security;
create policy "members read" on public.side_comp_defs for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.side_comp_defs for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.side_comp_defs as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: side_comps (add)" on public.side_comp_defs as restrictive for insert with check (public.feature_on(group_id, 'side_comps'));
create policy "feature on: side_comps (change)" on public.side_comp_defs as restrictive for update using (public.feature_on(group_id, 'side_comps')) with check (public.feature_on(group_id, 'side_comps'));
revoke all on public.side_comp_defs from anon;
grant select, insert, update, delete on public.side_comp_defs to authenticated;
create trigger aa_fill_group_id before insert or update on public.side_comp_defs
  for each row execute function private.fill_group_id();

-- Which of the group's comps a round has, and on which holes. Organisers set it (rounds' existing rules).
alter table public.rounds add column if not exists own_comps jsonb not null default '[]'::jsonb;
create or replace function private.rounds_own_comps_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.own_comps is not distinct from old.own_comps then return new; end if;
  end if;
  if jsonb_typeof(new.own_comps) <> 'array' or jsonb_array_length(new.own_comps) > 10 then
    raise exception 'Up to 10 of your own side comps a round';
  end if;
  if exists (select 1 from jsonb_array_elements(new.own_comps) c
             where jsonb_typeof(c -> 'holes') <> 'array'
                or not exists (select 1 from public.side_comp_defs d where d.id::text = c ->> 'comp' and d.group_id = new.group_id)
                or exists (select 1 from jsonb_array_elements_text(c -> 'holes') h where h !~ '^([1-9]|1[0-8])$')) then
    raise exception 'That side comp isn''t one of this group''s, or a hole isn''t 1 to 18';
  end if;
  return new;
end $$;
revoke all on function private.rounds_own_comps_check() from public, anon, authenticated;
create or replace trigger ae_rounds_own_comps before insert or update on public.rounds
  for each row execute function private.rounds_own_comps_check();

create table if not exists public.side_comp_entries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  comp_id uuid not null references public.side_comp_defs(id) on delete cascade,
  hole int check (hole is null or hole between 1 and 18),        -- null = a whole-round comp
  player_id uuid not null references public.players(id) on delete cascade,
  value numeric check (value is null or (value >= 0 and value < 100000)),
  note text check (note is null or length(note) <= 200),
  photo_url text check (photo_url is null or length(photo_url) <= 400),
  confirmed boolean not null default false,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists side_comp_entries_round_idx on public.side_comp_entries (round_id, comp_id, hole);
create index if not exists side_comp_entries_group_idx on public.side_comp_entries (group_id);
create index if not exists side_comp_entries_comp_idx on public.side_comp_entries (comp_id);
create index if not exists side_comp_entries_player_idx on public.side_comp_entries (player_id);
create index if not exists side_comp_entries_created_by_idx on public.side_comp_entries (created_by);
alter table public.side_comp_entries enable row level security;
create policy "members read" on public.side_comp_entries for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
-- Anyone in the group enters (as themselves); the organiser can enter for anyone.
create policy "members add" on public.side_comp_entries for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[])
              and (created_by = private.my_player_id(group_id) or group_id = any ((select private.my_organiser_group_ids())::uuid[]))
              and (confirmed = false or group_id = any ((select private.my_organiser_group_ids())::uuid[])));
-- Only organisers change entries (confirming a winner); whoever made an entry (or an organiser) removes it.
create policy "organisers change" on public.side_comp_entries for update
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "remove own or organiser" on public.side_comp_entries for delete
  using (created_by = private.my_player_id(group_id) or group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.side_comp_entries as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: side_comps (add)" on public.side_comp_entries as restrictive for insert with check (public.feature_on(group_id, 'side_comps'));
create policy "feature on: side_comps (change)" on public.side_comp_entries as restrictive for update using (public.feature_on(group_id, 'side_comps')) with check (public.feature_on(group_id, 'side_comps'));
create policy "feature on: side_comps (remove)" on public.side_comp_entries as restrictive for delete using (public.feature_on(group_id, 'side_comps'));
revoke all on public.side_comp_entries from anon;
grant select, insert, update, delete on public.side_comp_entries to authenticated;
create trigger aa_fill_group_id before insert or update on public.side_comp_entries
  for each row execute function private.fill_group_id('rounds:round_id', 'side_comp_defs:comp_id');

alter publication supabase_realtime add table public.side_comp_defs, public.side_comp_entries;
select private.add_same_group_checks();
