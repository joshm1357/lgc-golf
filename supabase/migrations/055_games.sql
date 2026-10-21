-- 055 — Games and side bets (21 Oct 2026). Additive only. Part of the games feature ('games', switch in 053).
-- An organiser adds games to a round: skins, Nassau, a Stableford pot, a birdie pool, or an eclectic for the trip.
-- The app works out every result and the money from the scores already entered (src/lib/games.js) — nothing about
-- results is stored. Each game row is just: which game, the stake, and a few options.
--   options: skins { net, carry }, nassau { net, scoring: 'stroke'|'stableford' }, birdie_pool { net },
--            eclectic { net }, stableford_pot {} — missing keys take the defaults in games.js.
-- Removing a game in the app sets retired = true (nothing is deleted); organisers may still delete via RLS.

create table if not exists public.round_games (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  kind text not null check (kind in ('skins', 'nassau', 'stableford_pot', 'birdie_pool', 'eclectic')),
  stake numeric(8, 2) not null default 0 check (stake >= 0 and stake <= 1000),
  options jsonb not null default '{}'::jsonb check (
    jsonb_typeof(options) = 'object'
    and options - array['net', 'carry', 'scoring'] = '{}'::jsonb
    and (not options ? 'net' or (kind <> 'stableford_pot' and jsonb_typeof(options -> 'net') = 'boolean'))
    and (not options ? 'carry' or (kind = 'skins' and jsonb_typeof(options -> 'carry') = 'boolean'))
    and (not options ? 'scoring' or (kind = 'nassau' and options ->> 'scoring' in ('stroke', 'stableford')))
  ),
  retired boolean not null default false,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists round_games_round_idx on public.round_games (round_id);
create index if not exists round_games_group_idx on public.round_games (group_id);
create index if not exists round_games_created_by_idx on public.round_games (created_by);
alter table public.round_games enable row level security;
create policy "members read" on public.round_games for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.round_games for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.round_games as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: games (add)" on public.round_games as restrictive for insert with check (public.feature_on(group_id, 'games'));
create policy "feature on: games (change)" on public.round_games as restrictive for update using (public.feature_on(group_id, 'games')) with check (public.feature_on(group_id, 'games'));
create policy "feature on: games (remove)" on public.round_games as restrictive for delete using (public.feature_on(group_id, 'games'));
revoke all on public.round_games from anon;
grant select, insert, update, delete on public.round_games to authenticated;
create trigger aa_fill_group_id before insert or update on public.round_games
  for each row execute function private.fill_group_id('rounds:round_id');

-- Ambrose is played in teams: only skins and Nassau make sense there (team v team).
create or replace function private.round_games_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_format text;
begin
  if tg_op = 'UPDATE' and new.kind is not distinct from old.kind and new.round_id is not distinct from old.round_id then
    return new;
  end if;
  select r.format into v_format from public.rounds r where r.id = new.round_id;
  if v_format = 'ambrose' and new.kind not in ('skins', 'nassau') then
    raise exception 'Ambrose rounds only have skins and Nassau (team v team)';
  end if;
  return new;
end $$;
revoke all on function private.round_games_check() from public, anon, authenticated;
create or replace trigger ab_round_games_check before insert or update on public.round_games
  for each row execute function private.round_games_check();

alter publication supabase_realtime add table public.round_games;
select private.add_same_group_checks();
