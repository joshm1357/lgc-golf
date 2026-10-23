-- 098 — Side games: "Who's in", opt-in, anyone can propose; house rules optional (ov29, 23 Oct 2026).
--
-- Josh (23 Oct): "The side games need to be proposed by someone to other people, or put out for an opt-in." and
-- "You need to fill in the house rules, but it should not be a compulsory field."
--
-- Parts 1–5 are ADDITIVE ONLY: one new column with a default, one stamp column, one new table, new functions,
-- triggers and policies. Nothing is dropped or renamed, so older app versions keep working exactly as before — every
-- existing game (and every game an old app adds) is "everyone in the round".
-- Part 6 (at the end, in its own block) is the ONE agreed exception: it drops and replaces a single check on
-- custom_games.rules_text so house rules can be empty.
--
--  1. round_games.who_in: 'everyone' (default — today's behaviour) or 'opt_in' (only players who tapped "I'm in" are in
--     that game's results and money; the app's maths is src/lib/games.js playGame / subjectsIn).
--     round_games.offered_at: when an opt-in game was first put out (stamped once; the Feed post goes out then).
--  2. round_game_players: who's in an opt-in game. Your own row ("I'm in" / "I'm out"); an organiser can add or take
--     out anyone (the bloke without his phone), even after opt-ins close.
--  3. Opt-ins close when the round starts (status live or locked), or at its first tee time if one is set (the earliest
--     tee_groups.tee_time on its play date, Sydney time). public.side_game_closes_at / public.side_game_open; the app
--     uses the same rule (games.js optInState).
--  4. Anyone in the group (not guests) can put up an opt-in side game for a round: they must be its creator and they
--     are automatically in. Only the creator or an organiser can change or remove it; a creator who isn't an organiser
--     can only take it down, and only before the round starts. Up to 3 games up per person per round. The existing
--     "organisers change" policy is untouched, so organisers work exactly as before.
--  5. Putting a game out for opt-in posts once to the Feed ("🎲 Bo’s put up $5 skins for Saturday. You in?") as the
--     creator, with a link the Feed turns into In / Out buttons. The notification is the notify function's
--     'game_proposed' kind (once per game, at most 3 a day from one person).
--  6. custom_games.rules_text: house rules optional — the 073 check (3 to 1000 letters, trimmed) is replaced by
--     0 to 1000. See the clearly marked block at the end.

-- =================================================================================================== 1. columns
alter table public.round_games add column if not exists who_in text not null default 'everyone'
  check (who_in in ('everyone', 'opt_in'));
alter table public.round_games add column if not exists offered_at timestamptz;

-- =================================================================================================== 2. who's in
create table if not exists public.round_game_players (
  game_id uuid not null references public.round_games(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  added_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index if not exists round_game_players_group_idx on public.round_game_players (group_id);
create index if not exists round_game_players_player_idx on public.round_game_players (player_id);
create index if not exists round_game_players_added_by_idx on public.round_game_players (added_by);

create or replace trigger aa_fill_group_id before insert or update on public.round_game_players
  for each row execute function private.fill_group_id('round_games:game_id', 'players:player_id', 'players:added_by');

alter table public.round_game_players enable row level security;
revoke all on public.round_game_players from anon;
grant select, insert, delete on public.round_game_players to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'round_game_players' and policyname = 'members read') then
    create policy "members read" on public.round_game_players for select to authenticated
      using (group_id = any ((select private.my_group_ids())::uuid[]));
    create policy "same group only" on public.round_game_players as restrictive for all to authenticated
      using (group_id = any ((select private.my_group_ids())::uuid[]))
      with check (group_id = any ((select private.my_group_ids())::uuid[]));
    -- "I'm in" / "I'm out": your own row. An organiser can put anyone in or take them out.
    create policy "im in" on public.round_game_players for insert to authenticated
      with check (player_id = private.my_player_id(group_id) or private.is_group_organiser(group_id));
    create policy "im out" on public.round_game_players for delete to authenticated
      using (player_id = private.my_player_id(group_id) or private.is_group_organiser(group_id));
    -- Guests read but never write.
    create policy "no guest writes (add)" on public.round_game_players as restrictive for insert to authenticated
      with check (not private.is_group_guest(group_id));
    create policy "no guest writes (remove)" on public.round_game_players as restrictive for delete to authenticated
      using (not private.is_group_guest(group_id));
    -- Switched off: hidden in the app and refused here.
    create policy "feature on: games (add)" on public.round_game_players as restrictive for insert
      with check (public.feature_on(group_id, 'games'));
    create policy "feature on: games (remove)" on public.round_game_players as restrictive for delete
      using (public.feature_on(group_id, 'games'));
  end if;
end $$;

-- =================================================================================================== 3. when opt-ins close
-- The first tee: the round's play date at its earliest tee time (Sydney). Null when either isn't set.
create or replace function public.side_game_closes_at(p_round uuid)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare v_day date; v_tee text;
begin
  select r.play_date into v_day from public.rounds r where r.id = p_round;
  if v_day is null then return null; end if;
  select min(t.tee_time) into v_tee from public.tee_groups t
    where t.round_id = p_round and t.tee_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  if v_tee is null then return null; end if;
  return (v_day + v_tee::time) at time zone 'Australia/Sydney';
end $$;
revoke all on function public.side_game_closes_at(uuid) from public, anon;
grant execute on function public.side_game_closes_at(uuid) to authenticated;

-- Open until the round is under way (live or locked) or its first tee time has passed.
create or replace function public.side_game_open(p_round uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_status text; v_close timestamptz;
begin
  select r.status into v_status from public.rounds r where r.id = p_round;
  if v_status is null or v_status in ('live', 'locked') then return false; end if;
  v_close := public.side_game_closes_at(p_round);
  return v_close is null or now() < v_close;
end $$;
revoke all on function public.side_game_open(uuid) from public, anon;
grant execute on function public.side_game_open(uuid) to authenticated;

-- "I'm in" / "I'm out" checks: only an opt-in game that's still up; after the first tee only an organiser changes the
-- list. A game (or round) being deleted takes its list with it — never blocked.
create or replace function private.round_game_players_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare g public.round_games;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  select * into g from public.round_games where id = case when tg_op = 'DELETE' then old.game_id else new.game_id end;
  if g.id is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' then
    if g.who_in <> 'opt_in' then raise exception 'Everyone in the round is in that game already'; end if;
    if g.retired then raise exception 'That side game has been taken down'; end if;
    new.added_by := coalesce(new.added_by, private.my_player_id(g.group_id));
  end if;
  if auth.uid() is not null and not private.is_group_organiser(g.group_id) and not public.side_game_open(g.round_id) then
    raise exception 'Opt-in closed at the first tee — the list is fixed (an organiser can still change it)';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.round_game_players_guard() from public, anon, authenticated;
create or replace trigger ab_round_game_players_guard before insert or delete on public.round_game_players
  for each row execute function private.round_game_players_guard();

-- =================================================================================================== 4. anyone proposes
-- New permissive policies sit beside 055's "organisers change" (which still covers everything an organiser does).
-- The restrictive "same group only" and "feature on: games" policies from 055 still apply to all of these.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'round_games' and policyname = 'members propose') then
    create policy "members propose" on public.round_games for insert to authenticated
      with check (who_in = 'opt_in' and not retired and created_by is not null
                  and created_by = private.my_player_id(group_id) and not private.is_group_guest(group_id));
    create policy "proposer changes" on public.round_games for update to authenticated
      using (who_in = 'opt_in' and created_by = private.my_player_id(group_id) and not private.is_group_guest(group_id))
      with check (who_in = 'opt_in' and created_by = private.my_player_id(group_id) and not private.is_group_guest(group_id));
    create policy "proposer removes" on public.round_games for delete to authenticated
      using (who_in = 'opt_in' and created_by = private.my_player_id(group_id) and not private.is_group_guest(group_id));
  end if;
end $$;

-- What a creator who isn't an organiser may do: put a game up while the round is open (up to 3 per round), and take it
-- down before the round starts. Nothing else — to change the stake, take it down and put up a new one (people opted
-- in to what they saw). Organisers, the server and cascades are never stopped here.
-- Also stamps offered_at the first time a game is opt-in (the Feed post goes out then — part 5).
create or replace function private.round_games_who_in()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_g uuid := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if auth.uid() is not null and not private.is_group_organiser(v_g) then
    if tg_op = 'INSERT' then
      if not public.side_game_open(new.round_id) then
        raise exception 'Opt-in has closed for that round — the first tee has gone';
      end if;
      if (select count(*) from public.round_games x
          where x.round_id = new.round_id and x.created_by = new.created_by and not x.retired) >= 3 then
        raise exception 'You''ve already got 3 side games up for that round';
      end if;
    elsif tg_op = 'UPDATE' then
      if not public.side_game_open(old.round_id) then
        raise exception 'That round has started — the side game stays as it is';
      end if;
      if not (new.retired and not old.retired)
         or (new.round_id, new.kind, new.stake, new.options, new.settings, new.who_in, new.custom_game_id, new.created_by)
            is distinct from (old.round_id, old.kind, old.stake, old.options, old.settings, old.who_in, old.custom_game_id, old.created_by) then
        raise exception 'You can only take your side game down — put up a new one to change it';
      end if;
    else
      if not public.side_game_open(old.round_id) then
        raise exception 'That round has started — the side game stays as it is';
      end if;
      return old;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.who_in = 'opt_in' and new.offered_at is null then new.offered_at := now(); end if;
  return new;
end $$;
revoke all on function private.round_games_who_in() from public, anon, authenticated;
create or replace trigger ad_round_games_who_in before insert or update or delete on public.round_games
  for each row execute function private.round_games_who_in();

-- =================================================================================================== 5. the Feed post
-- Once per game, when it's first put out for opt-in (offered_at stamped just now): the creator is in, and a post goes
-- to the Feed as them (only while the round is open and the Feed is on). The post's link (/games?r=…&g=…) is what the
-- Feed turns into In / Out buttons.
create or replace function private.round_games_offer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.rounds; v_who uuid; v_name text; v_game text; v_money text; v_day text;
begin
  if new.who_in <> 'opt_in' or new.offered_at is null then return null; end if;
  if tg_op = 'UPDATE' and old.offered_at is not null then return null; end if;
  -- The proposer is in (a game put up as opt-in; an organiser switching an existing game over isn't put in).
  if tg_op = 'INSERT' and new.created_by is not null then
    insert into public.round_game_players (game_id, group_id, player_id, added_by)
    values (new.id, new.group_id, new.created_by, new.created_by) on conflict do nothing;
  end if;
  if new.retired or not public.side_game_open(new.round_id) or not public.feature_on(new.group_id, 'feed') then return null; end if;
  select * into r from public.rounds where id = new.round_id;
  v_who := coalesce(new.created_by, private.my_player_id(new.group_id));
  select split_part(coalesce(nullif(btrim(p.nickname), ''), p.name), ' ', 1) into v_name from public.players p where p.id = v_who;
  v_money := '$' || case when new.stake = trunc(new.stake) then trunc(new.stake)::text else to_char(new.stake, 'FM999990.00') end;
  select c.name into v_game from public.custom_games c where c.id = new.custom_game_id;
  v_game := coalesce(v_game, case new.kind when 'skins' then 'skins' when 'nassau' then 'Nassau' when 'stableford_pot' then 'Stableford pot'
                                           when 'birdie_pool' then 'birdie pool' when 'eclectic' then 'eclectic' else 'side game' end);
  v_day := coalesce(to_char(r.play_date, 'FMDay'), r.name, 'the round');
  insert into public.posts (group_id, trip_id, round_id, kind, body, player_id, link)
  values (new.group_id, r.trip_id, r.id, 'user',
          '🎲 ' || coalesce(v_name, 'Someone') || '’s put up ' || v_money || ' ' || v_game || ' for ' || v_day || '. You in?',
          v_who, '/games?r=' || r.id || '&g=' || new.id);
  return null;
end $$;
revoke all on function private.round_games_offer() from public, anon, authenticated;
create or replace trigger zz_round_games_offer after insert or update of who_in, offered_at on public.round_games
  for each row execute function private.round_games_offer();

-- =================================================================================================== realtime + links
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'round_game_players') then
    alter publication supabase_realtime add table public.round_game_players;
  end if;
end $$;
select private.add_same_group_checks();

-- =================================================================================================== 6. THE ONE DROP
-- ⚠️  NOT ADDITIVE — agreed with Josh (23 Oct): "You need to fill in the house rules, but it should not be a
-- compulsory field."
--
-- DROPPED:   check constraint custom_games_rules_text_check (from 073), i.e.
--              check (length(btrim(rules_text)) between 3 and 1000)
-- ADDED:     check constraint custom_games_rules_text_len, i.e.
--              check (length(btrim(rules_text)) between 0 and 1000)
--
-- Nothing else changes: the column stays NOT NULL (no house rules = an empty string ''), the 1000-letter limit
-- stays, and no data is touched — every existing row already passes the looser check. Older app versions still ask
-- for house rules (their own check), so they just keep doing what they did.
alter table public.custom_games drop constraint if exists custom_games_rules_text_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.custom_games'::regclass and conname = 'custom_games_rules_text_len') then
    alter table public.custom_games add constraint custom_games_rules_text_len check (length(btrim(rules_text)) between 0 and 1000);
  end if;
end $$;
