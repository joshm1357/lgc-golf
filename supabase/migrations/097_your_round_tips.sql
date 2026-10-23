-- 097 — Your round, tee times on Cup matches, tipping on teams and matches, the night-before buzz (ov28, 23 Oct 2026).
-- ADDITIVE ONLY: two new columns, one new table, one feature switch row, functions, triggers and one scheduled job.
-- Nothing is dropped or renamed; the previous app version keeps working (it never reads or writes the new bits).
--
-- From Josh's walkthrough review:
--   C2  "No tee times anywhere (Cup matches or the normal day)" → a Cup match gets a tee time and a starting hole
--       (cup_matches.tee_time / start_hole, same rules as tee_groups). Playing groups already have them (056).
--   I9  "Tip the Cup … and other betting opportunities. Bragging rights only — still no real money in the app."
--       → tips: one pick per person per thing — the Cup (pick a side), a Cup match (a, b or halved), or a round
--       (pick a team or pair for Ambrose / 4BBB, a player for Stableford / stroke play). Locks once it starts.
--       The trip's main-trophy tip stays where it is (trip_tips, 094).
--   I11 "Night before: your tee time tomorrow … (only if selected)" → a new evening call to the notify function
--       ({"type":"evening"}), 7pm Sydney in summer time (6pm in winter). It only buzzes people with a tee time or a
--       playing group for tomorrow's round.
--   I8 / I13 (the draw is out, swing alerts) need no database change: they're new kinds in the notify function, which
--       writes the words itself and keeps its "once" keys in notify_log (014).
--
-- Security: tips has RLS like every table — members read; you write only your own pick; guests never write; the
-- restrictive "same group only" policy; links checked to stay in the group; a feature switch ('tipping', on for new
-- groups). The locks are checked in the database, not just hidden in the app.

-- =================================================================================================== C2: Cup tee times
alter table public.cup_matches add column if not exists tee_time text
  check (tee_time is null or tee_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.cup_matches add column if not exists start_hole int
  check (start_hole is null or start_hole between 1 and 18);

-- =================================================================================================== I9: tipping
insert into public.feature_catalogue (key, default_on, parent, tier) values ('tipping', true, null, 'free') on conflict (key) do nothing;

create table if not exists public.tips (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  target text not null check (target in ('cup', 'match', 'round')),
  target_id uuid not null,                       -- cup: the trip; match: cup_matches.id; round: rounds.id
  pick text not null check (length(pick) between 1 and 40),   -- cup: a side id; match: a | b | h; round: a team or player id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, target, target_id)
);
create index if not exists tips_group_idx on public.tips (group_id);
create index if not exists tips_trip_idx on public.tips (trip_id);
create index if not exists tips_target_idx on public.tips (target, target_id);

create or replace trigger aa_fill_group_id before insert or update on public.tips
  for each row execute function private.fill_group_id('trips:trip_id', 'players:player_id');

-- The thing tipped belongs to this trip, the pick fits it, and it hasn't started yet.
create or replace function private.tips_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_round public.rounds; v_match public.cup_matches; v_trip uuid := coalesce(new.trip_id, old.trip_id);
        v_target text := coalesce(new.target, old.target); v_tid uuid := coalesce(new.target_id, old.target_id);
begin
  -- A trip, player or group being deleted takes its tips with it (a cascade, from inside another trigger): no checks.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op = 'UPDATE' and (new.target, new.target_id, new.trip_id, new.player_id) is distinct from (old.target, old.target_id, old.trip_id, old.player_id) then
    raise exception 'Change your pick, not what it''s on';
  end if;
  if v_target = 'cup' then
    if v_tid <> v_trip then raise exception 'That tip isn''t for this trip''s Cup'; end if;
    if exists (select 1 from public.cup_matches m join public.rounds r on r.id = m.round_id
               where r.trip_id = v_trip and m.holes <> '{}'::jsonb) then
      raise exception 'Tipping on the Cup closed once the first match started';
    end if;
    if tg_op <> 'DELETE' and not exists (select 1 from public.cup_sides s where s.id::text = new.pick and s.group_id = new.group_id) then
      raise exception 'Pick one of the two teams';
    end if;
  elsif v_target = 'match' then
    select m.* into v_match from public.cup_matches m join public.rounds r on r.id = m.round_id
      where m.id = v_tid and r.trip_id = v_trip;
    if v_match.id is null then raise exception 'That match isn''t on this trip'; end if;
    if v_match.holes <> '{}'::jsonb then raise exception 'That match has started — tipping''s closed'; end if;
    if tg_op <> 'DELETE' and new.pick not in ('a', 'b', 'h') then raise exception 'Pick a team or a halve'; end if;
  else
    select * into v_round from public.rounds where id = v_tid and trip_id = v_trip;
    if v_round.id is null then raise exception 'That round isn''t on this trip'; end if;
    if v_round.status <> 'setup' then raise exception 'That round has started — tipping''s closed'; end if;
    if tg_op <> 'DELETE' then
      if v_round.format in ('ambrose', 'fourball') then
        if not exists (select 1 from public.teams t where t.id::text = new.pick and t.round_id = v_round.id) then
          raise exception 'Pick one of the round''s teams';
        end if;
      elsif not exists (select 1 from public.round_players rp where rp.player_id::text = new.pick and rp.round_id = v_round.id) then
        raise exception 'Pick someone playing that round';
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end $$;
revoke all on function private.tips_check() from public, anon, authenticated;
create or replace trigger ab_tips_check before insert or update or delete on public.tips
  for each row execute function private.tips_check();

alter table public.tips enable row level security;
revoke all on public.tips from anon;
grant select, insert, update, delete on public.tips to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tips' and policyname = 'same group only') then
    create policy "same group only" on public.tips as restrictive for all to authenticated
      using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]));
    create policy "members read" on public.tips for select to authenticated
      using (group_id = any ((select private.my_group_ids())::uuid[]));
    create policy "own tip" on public.tips for all to authenticated
      using (player_id = private.my_player_id(group_id)) with check (player_id = private.my_player_id(group_id));
    create policy "no guest writes (add)" on public.tips as restrictive for insert to authenticated with check (not private.is_group_guest(group_id));
    create policy "no guest writes (change)" on public.tips as restrictive for update to authenticated using (not private.is_group_guest(group_id)) with check (not private.is_group_guest(group_id));
    create policy "no guest writes (remove)" on public.tips as restrictive for delete to authenticated using (not private.is_group_guest(group_id));
    create policy "feature on: tipping (add)" on public.tips as restrictive for insert with check (public.feature_on(group_id, 'tipping'));
    create policy "feature on: tipping (change)" on public.tips as restrictive for update using (public.feature_on(group_id, 'tipping')) with check (public.feature_on(group_id, 'tipping'));
    create policy "feature on: tipping (remove)" on public.tips as restrictive for delete using (public.feature_on(group_id, 'tipping'));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tips') then
    alter publication supabase_realtime add table public.tips;
  end if;
end $$;

-- =================================================================================================== I11: the evening call
-- Same call as the 9am reminders (015), with type "evening", so it points at this project's notify function and
-- carries the cron secret. 08:00 UTC = 7pm Sydney (summer) / 6pm (winter). Only if the 9am job exists (it does on
-- staging and live); re-running this file never adds a second one.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'lgc-daily-reminders')
     and not exists (select 1 from cron.job where jobname = 'lgc-evening-tee-times') then
    perform cron.schedule('lgc-evening-tee-times', '0 8 * * *',
      (select replace(command, '"type":"daily"', '"type":"evening"') from cron.job where jobname = 'lgc-daily-reminders'));
  end if;
end $$;

select private.add_same_group_checks();
