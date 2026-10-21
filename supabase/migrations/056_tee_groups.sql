-- 056 — Tee groups (21 Oct 2026). Additive only: one new table. Behind the feature switch 'tee_groups' (053, off by
-- default). The app works out fair groups of four for a round (src/lib/teegroups.js: new partners each day, handicaps
-- mixed, teams/pairs/Cup matches kept together) and the organiser saves them here, one row per group, with its tee
-- time ('HH:MM') or, for a shotgun start, the same time and a starting hole.
--   * Everyone in the group reads them (the leaderboard shows "Your group: 8:16 with Al, Bo and Cy").
--   * Only organisers add, change or remove them. Switched off = the database refuses changes (rows are kept).
--   * group_id is the golf group (filled from the round); group_no is the tee group's number in the round (1, 2, 3…).

create table if not exists public.tee_groups (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  group_no int not null check (group_no between 1 and 60),
  tee_time text check (tee_time is null or tee_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  start_hole int check (start_hole is null or start_hole between 1 and 18),
  player_ids uuid[] not null check (cardinality(player_ids) between 1 and 5),
  created_at timestamptz not null default now(),
  unique (round_id, group_no)
);
create index if not exists tee_groups_group_idx on public.tee_groups (group_id);
alter table public.tee_groups enable row level security;
create policy "members read" on public.tee_groups for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.tee_groups for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.tee_groups as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: tee_groups (add)" on public.tee_groups as restrictive for insert with check (public.feature_on(group_id, 'tee_groups'));
create policy "feature on: tee_groups (change)" on public.tee_groups as restrictive for update using (public.feature_on(group_id, 'tee_groups')) with check (public.feature_on(group_id, 'tee_groups'));
create policy "feature on: tee_groups (remove)" on public.tee_groups as restrictive for delete using (public.feature_on(group_id, 'tee_groups'));
revoke all on public.tee_groups from anon;
grant select, insert, update, delete on public.tee_groups to authenticated;
create trigger aa_fill_group_id before insert or update on public.tee_groups
  for each row execute function private.fill_group_id('rounds:round_id');

-- Everyone in a tee group is a player in this group, and nobody is listed twice in it.
create or replace function private.tee_group_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.player_ids) p
             where not exists (select 1 from public.players x where x.id = p and x.group_id = new.group_id)) then
    raise exception 'A player in that tee group isn''t in this group';
  end if;
  if (select count(distinct p) from unnest(new.player_ids) p) <> cardinality(new.player_ids) then
    raise exception 'Someone is listed twice in that tee group';
  end if;
  return new;
end $$;
revoke all on function private.tee_group_check() from public, anon, authenticated;
create or replace trigger ab_tee_group_check before insert or update on public.tee_groups
  for each row execute function private.tee_group_check();

alter publication supabase_realtime add table public.tee_groups;
select private.add_same_group_checks();
