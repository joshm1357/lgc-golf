-- 090 — Committees and elections (ov19, 23 Oct 2026). ADDITIVE ONLY: new columns, two new tables, new functions and
-- triggers. Nothing is dropped or renamed. Five 061 functions are re-created with the same name and arguments
-- (case_evaluate, vote_case, decide_case, seat_term_ended, governance_tick_group): each keeps its 061 behaviour and
-- only adds the election steps below, so old app versions keep working.
--
-- How a committee seat is filled now, in plain words:
--  * An ELECTION is a case (kind 'election', proposal.mode = 'contest'). It runs in two parts:
--      1. Nominations (committees.nominate_hours, default 3 days): anyone in the group (not guests) nominates themselves
--         or a mate. Someone nominated by a mate has to accept. Standing for yourself counts as accepting.
--      2. The vote (the group's "Committee election" decision rule: who votes and how long it stays open). One person,
--         one vote per seat, secret ballot. Most votes wins (with two candidates that's a majority). It settles early
--         once nobody can catch the leader.
--    Nobody stands: the seat stays as it is. One person stands: elected unopposed. A tie for the most votes: an
--    organiser who isn't in the tie picks the winner (the "casting" stage). If the group's rule is "an organiser
--    decides", an organiser picks from the nominees instead of a vote.
--  * The winner takes the seat straight away; the result goes to the feed.
--  * TERM LIMIT (committees.term_limit): the most terms in a row one person can hold the same seat. Someone at the limit
--    can't be nominated, re-elected or re-appointed to that seat until somebody else has held it (they sit one out).
--  * STAGGERED TERMS (committees.staggered): even-numbered seats' first term is half length, so after that half the
--    seats come up at a time.
--  * When a term ends the hourly job (lgc-governance-hourly) opens the election for that seat (the holder is
--    nominated to stand again unless they're at the limit); appointed seats remind the organisers instead.
--  * RESIGNING: the holder can step down; an elected seat then gets a by-election automatically.
--  * The old single-candidate election ("Put X in seat 2 — yes/no?") still works for old app versions.

-- =================================================================================================== columns
alter table public.committees add column if not exists term_limit int
  check (term_limit is null or term_limit between 1 and 10);
alter table public.committees add column if not exists staggered boolean not null default false;
alter table public.committees add column if not exists nominate_hours int not null default 72
  check (nominate_hours between 1 and 720);
-- term_no: how many terms in a row the current holder has held this seat (0 = empty).
alter table public.committee_seats add column if not exists term_no int not null default 0 check (term_no >= 0);
-- half_term: this seat's current (or, if empty, next) term is half length — staggered committees only.
alter table public.committee_seats add column if not exists half_term boolean not null default false;
alter table public.committee_seats add column if not exists vacant_reminded_at timestamptz;
-- An election's part: nominations, then the vote. Null for every other case.
alter table public.cases add column if not exists election_phase text
  check (election_phase is null or election_phase in ('nominating', 'voting'));

update public.committee_seats set term_no = 1 where player_id is not null and term_no = 0;

-- =================================================================================================== tables
create table if not exists public.election_nominations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,     -- the nominee
  nominated_by uuid references public.players(id) on delete set null,          -- null = the app (standing again)
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (case_id, player_id)
);
create index if not exists election_nominations_group_idx on public.election_nominations (group_id);
create index if not exists election_nominations_player_idx on public.election_nominations (player_id);
create index if not exists election_nominations_by_idx on public.election_nominations (nominated_by);

-- Secret ballot: you see your own vote; the totals come out with the result.
create table if not exists public.election_ballots (
  case_id uuid not null references public.cases(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  voter_id uuid not null references public.players(id) on delete cascade,
  nominee_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (case_id, voter_id)
);
create index if not exists election_ballots_group_idx on public.election_ballots (group_id);
create index if not exists election_ballots_voter_idx on public.election_ballots (voter_id);
create index if not exists election_ballots_nominee_idx on public.election_ballots (nominee_id);

do $$
declare t text;
begin
  foreach t in array array['election_nominations', 'election_ballots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    continue when exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'same group only');
    execute format('create policy "same group only" on public.%I as restrictive for all using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]))', t);
  end loop;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'election_nominations' and policyname = 'members read') then
    create policy "members read" on public.election_nominations for select using (group_id = any ((select private.my_group_ids())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'election_ballots' and policyname = 'own ballot') then
    create policy "own ballot" on public.election_ballots for select using (
      group_id = any ((select private.my_group_ids())::uuid[]) and voter_id = private.my_player_id(group_id));
  end if;
end $$;

create or replace trigger aa_fill_group_id before insert or update on public.election_nominations
  for each row execute function private.fill_group_id('cases:case_id', 'players:player_id');
create or replace trigger aa_fill_group_id before insert or update on public.election_ballots
  for each row execute function private.fill_group_id('cases:case_id', 'players:voter_id');

-- =================================================================================================== seats
-- Every change of holder, from any path (an election, an appointment, the old yes/no election, resigning), keeps the
-- term count, the half-term and the two seat rules: the term limit, and one seat per person per committee.
create or replace function private.seat_terms() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.committees; v_name text;
begin
  -- Same holder and no new start (or a start moved earlier, e.g. an organiser correcting it): nothing to count.
  if tg_op = 'UPDATE' and new.player_id is not distinct from old.player_id
     and (new.started_at is null or old.started_at is null or new.started_at <= old.started_at) then
    return new;
  end if;
  select * into c from public.committees where id = new.committee_id;
  if new.player_id is null then
    new.term_no := 0;
    if tg_op = 'UPDATE' and old.player_id is not null then new.half_term := false; end if;
    return new;
  end if;
  if exists (select 1 from public.committee_seats s where s.committee_id = new.committee_id and s.seat_no <> new.seat_no
             and s.player_id = new.player_id and s.seat_no <= c.seats) then
    raise exception 'They already hold a seat on the %', c.name;
  end if;
  if tg_op = 'UPDATE' and old.player_id = new.player_id then
    -- The same person again (re-elected / re-appointed): one more term in a row.
    if c.term_limit is not null and old.term_no >= c.term_limit then
      select coalesce(nickname, name) into v_name from public.players where id = new.player_id;
      raise exception '% has served % term% in a row on this seat — they can stand again after sitting one out',
        coalesce(v_name, 'They'), c.term_limit, case when c.term_limit = 1 then '' else 's' end;
    end if;
    new.term_no := old.term_no + 1;
    new.half_term := false;
  else
    new.term_no := 1;
    -- A seat that was empty keeps its half-term (a staggered seat's first term); taking over from someone doesn't.
    if tg_op = 'UPDATE' and old.player_id is not null then new.half_term := false; end if;
  end if;
  return new;
end $$;
create or replace trigger zz_seat_terms before insert or update on public.committee_seats
  for each row execute function private.seat_terms();

-- Can this player stand for this seat? Returns why not, or null.
create or replace function private.stand_problem(p_committee uuid, p_seat_no int, p_player uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare c public.committees; s public.committee_seats; v_name text;
begin
  select * into c from public.committees where id = p_committee;
  select * into s from public.committee_seats where committee_id = p_committee and seat_no = p_seat_no;
  select coalesce(nickname, name) into v_name from public.players where id = p_player;
  if not exists (select 1 from public.group_members where group_id = c.group_id and player_id = p_player and role <> 'guest') then
    return 'Pick a player in the group (not a guest)';
  end if;
  if exists (select 1 from public.committee_seats x where x.committee_id = p_committee and x.seat_no <> p_seat_no and x.player_id = p_player and x.seat_no <= c.seats) then
    return coalesce(v_name, 'They') || ' already holds a seat on the ' || c.name;
  end if;
  if c.term_limit is not null and s.player_id = p_player and s.term_no >= c.term_limit then
    return coalesce(v_name, 'They') || ' has served ' || c.term_limit || ' term' || case when c.term_limit = 1 then '' else 's' end
      || ' in a row on this seat — they can stand again after sitting one out';
  end if;
  return null;
end $$;

-- The old single-candidate election (old app versions): refuse up front if the candidate can't stand.
create or replace function private.election_case_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_problem text;
begin
  if new.kind = 'election' and coalesce(new.proposal->>'mode', '') <> 'contest' and new.proposal ? 'candidate' then
    v_problem := private.stand_problem(nullif(new.proposal->>'committee_id', '')::uuid, (new.proposal->>'seat_no')::int, nullif(new.proposal->>'candidate', '')::uuid);
    if v_problem is not null then raise exception '%', v_problem; end if;
  end if;
  return new;
end $$;
create or replace trigger zz_election_case_guard before insert on public.cases
  for each row execute function private.election_case_guard();

-- Has a seat's term ended? As 061, plus a staggered seat's half-length first term.
create or replace function private.seat_term_ended(p_seat uuid, out ended boolean, out soon boolean)
language plpgsql stable security definer set search_path = '' as $$
declare s public.committee_seats; c public.committees; v_trips int; v_end timestamptz; v_today date := (now() at time zone 'Australia/Sydney')::date;
        v_tt int; v_months int;
begin
  select * into s from public.committee_seats where id = p_seat;
  select * into c from public.committees where id = s.committee_id;
  ended := false; soon := false;
  if s.started_at is null or s.player_id is null then return; end if;
  v_tt := case when c.term_trips is null then null when s.half_term then greatest(1, ceil(c.term_trips / 2.0)::int) else c.term_trips end;
  v_months := case when c.term_years is null then null when s.half_term then greatest(1, round(c.term_years * 6)::int) else round(c.term_years * 12)::int end;
  select count(*) into v_trips from public.trips where group_id = s.group_id and start_date > s.started_at::date and start_date <= v_today;
  v_end := case when v_months is not null then s.started_at + make_interval(months => v_months) end;
  ended := (v_tt is not null and v_trips >= v_tt) or (v_end is not null and now() >= v_end);
  soon := not ended and ((v_tt is not null and v_trips = v_tt - 1) or (v_end is not null and v_end - now() <= interval '14 days'));
end $$;

-- =================================================================================================== committees
-- Organisers set up committees (name, what it decides, seats, election or appointment, term, term limit, staggered).
-- Who decides each kind of case is still the group's decision rules (Governance settings) — this only sets up the
-- committee itself.
create or replace function public.save_committee_v2(p_id uuid, p_name text, p_kinds text[], p_seats int, p_fill text,
  p_term_trips int, p_term_years numeric, p_term_limit int, p_staggered boolean, p_nominate_hours int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_id uuid := p_id; i int; v_was boolean := false;
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can set up committees'; end if;
  perform private.require_feature(v_g, 'committees');
  if coalesce(length(btrim(p_name)), 0) not between 2 and 40 then raise exception 'Give the committee a name (2–40 characters)'; end if;
  if coalesce(p_seats, 0) not between 1 and 15 then raise exception 'A committee has 1 to 15 seats'; end if;
  if coalesce(p_fill, 'election') not in ('election', 'appointment') then raise exception 'Seats are filled by election or appointment'; end if;
  if p_term_limit is not null and p_term_limit not between 1 and 10 then raise exception 'A term limit is 1 to 10 terms in a row'; end if;
  if coalesce(p_staggered, false) and p_term_trips is null and p_term_years is null then raise exception 'Staggered terms need a term length'; end if;
  if v_id is null then
    insert into public.committees (group_id, name, kinds, seats, fill, term_trips, term_years, term_limit, staggered, nominate_hours)
    values (v_g, btrim(p_name), coalesce(p_kinds, '{}'), p_seats, coalesce(p_fill, 'election'), p_term_trips, p_term_years, p_term_limit,
      coalesce(p_staggered, false), coalesce(p_nominate_hours, 72))
    returning id into v_id;
  else
    select staggered into v_was from public.committees where id = v_id and group_id = v_g;
    if not found then raise exception 'No such committee'; end if;
    if exists (select 1 from public.committee_seats where committee_id = v_id and player_id is not null and seat_no > p_seats) then
      raise exception 'Someone holds a seat you''d be removing — replace them first';
    end if;
    update public.committees set name = btrim(p_name), kinds = coalesce(p_kinds, '{}'), seats = p_seats, fill = coalesce(p_fill, 'election'),
      term_trips = p_term_trips, term_years = p_term_years, term_limit = p_term_limit, staggered = coalesce(p_staggered, false),
      nominate_hours = coalesce(p_nominate_hours, nominate_hours)
    where id = v_id;
  end if;
  for i in 1..p_seats loop
    insert into public.committee_seats (group_id, committee_id, seat_no) values (v_g, v_id, i) on conflict (committee_id, seat_no) do nothing;
  end loop;
  -- Staggering switched on: even seats (empty, or in their first term) get a half-length term. Off: none do.
  if coalesce(p_staggered, false) and not coalesce(v_was, false) then
    update public.committee_seats set half_term = (seat_no % 2 = 0)
    where committee_id = v_id and (player_id is null or term_no <= 1);
  elsif not coalesce(p_staggered, false) then
    update public.committee_seats set half_term = false where committee_id = v_id and half_term;
  end if;
  return v_id;
end $$;

-- =================================================================================================== elections
create or replace function private.is_contest(c public.cases) returns boolean
language sql immutable set search_path = '' as $$
  select c.kind = 'election' and coalesce(c.proposal->>'mode', '') = 'contest'
$$;

-- Open an election for one seat. p_why: 'call' (an organiser), 'term' (the term is up), 'by' (a by-election).
create or replace function private.election_open(p_group uuid, p_committee uuid, p_seat_no int, p_by uuid, p_why text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.committees; s public.committee_seats; v_set jsonb; v_id uuid; v_holder text; v_title text; v_until timestamptz;
begin
  select * into c from public.committees where id = p_committee and group_id = p_group;
  if c.id is null then raise exception 'No such committee'; end if;
  if not public.feature_on(p_group, 'committees') then raise exception 'Committees are switched off for this group'; end if;
  if c.fill <> 'election' then raise exception 'This committee is appointed — an organiser fills its seats'; end if;
  if coalesce(p_seat_no, 0) not between 1 and c.seats then raise exception 'No such seat'; end if;
  if exists (select 1 from public.cases x where x.group_id = p_group and x.kind = 'election' and x.status = 'open'
             and x.proposal->>'committee_id' = c.id::text and (x.proposal->>'seat_no')::int = p_seat_no) then
    raise exception 'There''s already an election open for that seat';
  end if;
  select * into s from public.committee_seats where committee_id = c.id and seat_no = p_seat_no;
  select coalesce(nickname, name) into v_holder from public.players where id = s.player_id;
  v_set := private.gov_settings(p_group, 'election');
  v_until := now() + make_interval(hours => c.nominate_hours);
  v_title := c.name || ', seat ' || p_seat_no || ': ' || case p_why when 'by' then 'by-election' else 'election' end;
  insert into public.cases (group_id, kind, title, body, committee_id, proposal, raised_by, raised_via, settings, stage, election_phase, closes_at)
  values (p_group, 'election', left(v_title, 140),
    case p_why when 'term' then coalesce(v_holder, 'The holder') || '''s term is up. Nominate yourself or a mate.'
               when 'by' then 'The seat is empty. Nominate yourself or a mate.'
               else 'Nominate yourself or a mate.' end,
    c.id, jsonb_build_object('mode', 'contest', 'committee_id', c.id, 'seat_no', p_seat_no, 'why', p_why, 'holder', s.player_id),
    p_by, 'app', v_set, 'voting', 'nominating', v_until)
  returning id into v_id;
  update public.committee_seats set election_opened_at = now() where committee_id = c.id and seat_no = p_seat_no;
  -- The holder is nominated to stand again (they accept or decline), unless they're at the term limit.
  if p_why = 'term' and s.player_id is not null and private.stand_problem(c.id, p_seat_no, s.player_id) is null then
    insert into public.election_nominations (group_id, case_id, player_id, nominated_by) values (p_group, v_id, s.player_id, null);
    perform private.gov_queue(p_group, array[s.player_id], 'election_nominated', '🗳️ Stand again for the ' || c.name || '?', 'Accept or decline in Governance → Committees.', null);
  end if;
  perform private.gov_post(p_group, '🗳️ Nominations open: ' || v_title || '. Nominate yourself or a mate.', p_by, v_id, null);
  perform private.gov_queue(p_group, null, 'election_open', '🗳️ Nominations open: ' || v_title, 'Nominate yourself or a mate.', p_by);
  return v_id;
end $$;

create or replace function public.call_election(p_committee uuid, p_seat_no int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_g uuid;
begin
  select group_id into v_g from public.committees where id = p_committee;
  if v_g is null or not private.is_group_member(v_g) then raise exception 'No such committee'; end if;
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can call an election'; end if;
  return private.election_open(v_g, p_committee, p_seat_no, private.my_player_id(v_g), 'call');
end $$;

-- Fill the seat with the winner, close the case, post the result.
create or replace function private.election_fill(p_case uuid, p_winner uuid, p_reason text, p_decider uuid, p_results jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.cases; com public.committees; v_name text; v_for int; v_against int; v_line text;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or c.status <> 'open' then return; end if;
  select * into com from public.committees where id = (c.proposal->>'committee_id')::uuid;
  insert into public.committee_seats (group_id, committee_id, seat_no, player_id, started_at)
  values (c.group_id, com.id, (c.proposal->>'seat_no')::int, p_winner, now())
  on conflict (committee_id, seat_no) do update set player_id = excluded.player_id, started_at = excluded.started_at,
    reminded_at = null, election_opened_at = null, vacant_reminded_at = null;
  v_for := coalesce((select (r->>'votes')::int from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where r->>'player_id' = p_winner::text), 0);
  v_against := coalesce((select sum((r->>'votes')::int) from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where r->>'player_id' <> p_winner::text), 0);
  select coalesce(nickname, name) into v_name from public.players where id = p_winner;
  update public.cases set status = 'passed', reason = left(p_reason, 200), decided_by = p_decider, decided_at = now(),
    subject_id = p_winner, verdict = left(coalesce(v_name, 'Someone') || ' elected', 600),
    votes_for = v_for, votes_against = v_against, votes_abstain = 0, apply_state = 'applied', applied_at = now(),
    election_phase = null,
    proposal = c.proposal || jsonb_build_object('candidate', p_winner, 'results', coalesce(p_results, '[]'::jsonb))
  where id = p_case;
  v_line := '🗳️ Elected: ' || coalesce(v_name, 'someone') || ' takes seat ' || (c.proposal->>'seat_no') || ' on the ' || com.name
    || case when jsonb_array_length(coalesce(p_results, '[]'::jsonb)) > 1 and v_for + v_against > 0 then ' (' || v_for || '–' || v_against || ')' else '' end
    || ' — ' || lower(left(p_reason, 1)) || substr(p_reason, 2) || '.';
  if not c.hidden then
    perform private.gov_post(c.group_id, v_line, null, p_case);
    perform private.gov_queue(c.group_id, null, 'case_verdict', v_line, null, null);
  end if;
end $$;

-- Close an election with nobody elected (the seat stays as it is).
create or replace function private.election_none(p_case uuid, p_reason text, p_results jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or c.status <> 'open' then return; end if;
  update public.cases set status = 'failed', reason = left(p_reason, 200), decided_at = now(), apply_state = 'none', election_phase = null,
    votes_for = 0, votes_against = 0, votes_abstain = 0,
    proposal = c.proposal || jsonb_build_object('results', coalesce(p_results, '[]'::jsonb))
  where id = p_case;
  if not c.hidden then perform private.gov_post(c.group_id, '🗳️ ' || c.title || ': nobody elected — ' || lower(left(p_reason, 1)) || substr(p_reason, 2) || '.', null, p_case); end if;
end $$;

-- The count: [{player_id, votes}] for every accepted nominee, most votes first. Only ballots from people with a vote.
create or replace function private.election_results(p_case uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('player_id', x.player_id, 'votes', x.n) order by x.n desc, x.created_at), '[]'::jsonb)
  from (
    select n.player_id, n.created_at,
      (select count(*) from public.election_ballots b where b.case_id = p_case and b.nominee_id = n.player_id
         and b.voter_id = any (private.case_voters(p_case)))::int as n
    from public.election_nominations n where n.case_id = p_case and n.status = 'accepted'
  ) x
$$;

-- Where an election stands; moves it on when its time is up (or nobody can catch the leader).
-- Returns 'nominating' | 'open' | 'organiser' | 'casting' | 'passed' | 'failed'.
create or replace function private.election_evaluate(p_case uuid, p_closed boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_n int; v_only uuid; v_res jsonb; v_voters uuid[]; v_cast int; v_top int; v_second int; v_rem int;
        v_tied jsonb; v_hours int; v_names text;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or c.status <> 'open' then return c.status; end if;
  if c.stage in ('casting', 'organiser') then return c.stage; end if;
  if c.election_phase = 'nominating' then
    if not (p_closed or c.closes_at <= now()) then return 'nominating'; end if;
    select count(*), min(player_id::text)::uuid into v_n, v_only from public.election_nominations where case_id = p_case and status = 'accepted';
    -- Anyone who never answered is out.
    update public.election_nominations set status = 'declined', answered_at = now() where case_id = p_case and status = 'pending';
    if v_n = 0 then perform private.election_none(p_case, 'Nobody stood, so the seat stays as it is', '[]'); return 'failed'; end if;
    if v_n = 1 then
      perform private.election_fill(p_case, v_only, 'Elected unopposed', null, jsonb_build_array(jsonb_build_object('player_id', v_only, 'votes', 0)));
      return 'passed';
    end if;
    if c.settings->>'decides' in ('organiser', 'trip_organiser') then
      update public.cases set election_phase = 'voting', stage = 'organiser', closes_at = null, reason = 'An organiser picks from the nominees' where id = p_case;
      perform private.gov_queue(c.group_id, (select array_agg(player_id) from public.group_members where group_id = c.group_id and role = 'organiser'),
        'case_fallback', '🗳️ Pick the winner: ' || c.title, null, null);
      return 'organiser';
    end if;
    v_hours := coalesce((c.settings->>'close_hours')::int, 48);
    update public.cases set election_phase = 'voting', closes_at = now() + make_interval(hours => v_hours), reminded_at = null where id = p_case;
    select string_agg(coalesce(p.nickname, p.name), ', ' order by coalesce(p.nickname, p.name)) into v_names
      from public.election_nominations n join public.players p on p.id = n.player_id where n.case_id = p_case and n.status = 'accepted';
    if not c.hidden then
      perform private.gov_post(c.group_id, '🗳️ Voting open: ' || c.title || ' — ' || coalesce(v_names, '') || '.', null, p_case);
      perform private.gov_queue(c.group_id, private.case_voters(p_case), 'election_vote', '🗳️ Vote: ' || c.title, coalesce(v_names, ''), null);
    end if;
    return 'open';
  end if;
  -- The vote.
  v_voters := private.case_voters(p_case);
  v_res := private.election_results(p_case);
  select count(*) into v_cast from public.election_ballots where case_id = p_case and voter_id = any (v_voters)
    and nominee_id in (select player_id from public.election_nominations where case_id = p_case and status = 'accepted');
  v_rem := greatest(coalesce(cardinality(v_voters), 0) - v_cast, 0);
  v_top := coalesce((v_res->0->>'votes')::int, 0);
  v_second := coalesce((v_res->1->>'votes')::int, 0);
  if not (p_closed or c.closes_at <= now() or v_rem = 0 or v_top - v_second > v_rem) then return 'open'; end if;
  if v_cast = 0 then perform private.election_none(p_case, 'Nobody voted, so the seat stays as it is', v_res); return 'failed'; end if;
  select coalesce(jsonb_agg(r->'player_id'), '[]'::jsonb) into v_tied from jsonb_array_elements(v_res) r where (r->>'votes')::int = v_top;
  if jsonb_array_length(v_tied) > 1 then
    update public.cases set stage = 'casting', reason = 'A tie — an organiser who isn''t in the tie picks the winner',
      proposal = c.proposal || jsonb_build_object('tied', v_tied, 'results', v_res) where id = p_case;
    perform private.gov_queue(c.group_id, (select array_agg(player_id) from public.group_members where group_id = c.group_id and role = 'organiser'),
      'case_casting', '🗳️ A tie — pick the winner: ' || c.title, null, null);
    return 'casting';
  end if;
  perform private.election_fill(p_case, (v_res->0->>'player_id')::uuid, 'Most votes', null, v_res);
  return 'passed';
end $$;

-- Nominate yourself or a mate. Standing for yourself counts as accepting.
create or replace function public.nominate(p_case uuid, p_player uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid; v_problem text; v_status text; com public.committees;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such election'; end if;
  if not private.is_contest(c) then raise exception 'That isn''t an election with nominations'; end if;
  perform private.require_case_feature(c.group_id, 'election');
  if private.is_group_guest(c.group_id) then raise exception 'Guests can''t nominate'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if c.status <> 'open' or c.election_phase <> 'nominating' or c.closes_at <= now() then raise exception 'Nominations have closed'; end if;
  if not exists (select 1 from public.players where id = p_player and group_id = c.group_id) then raise exception 'No such player'; end if;
  v_problem := private.stand_problem((c.proposal->>'committee_id')::uuid, (c.proposal->>'seat_no')::int, p_player);
  if v_problem is not null then raise exception '%', v_problem; end if;
  select status into v_status from public.election_nominations where case_id = p_case and player_id = p_player;
  if v_status is not null then
    if p_player = v_me and v_status <> 'accepted' then
      update public.election_nominations set status = 'accepted', answered_at = now() where case_id = p_case and player_id = p_player;
      return 'accepted';
    end if;
    return v_status;   -- already nominated
  end if;
  insert into public.election_nominations (group_id, case_id, player_id, nominated_by, status, answered_at)
  values (c.group_id, p_case, p_player, v_me, case when p_player = v_me then 'accepted' else 'pending' end, case when p_player = v_me then now() end);
  if p_player <> v_me then
    select * into com from public.committees where id = (c.proposal->>'committee_id')::uuid;
    perform private.gov_queue(c.group_id, array[p_player], 'election_nominated', '🗳️ You''ve been nominated for the ' || com.name,
      'Accept or decline in Governance → Committees.', v_me);
    return 'pending';
  end if;
  return 'accepted';
end $$;

-- The nominee accepts or declines (or withdraws, while nominations are open).
create or replace function public.answer_nomination(p_case uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid; v_problem text;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such election'; end if;
  if not private.is_contest(c) then raise exception 'That isn''t an election with nominations'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null or not exists (select 1 from public.election_nominations where case_id = p_case and player_id = v_me) then
    raise exception 'You haven''t been nominated';
  end if;
  if c.status <> 'open' or c.election_phase <> 'nominating' or c.closes_at <= now() then raise exception 'Nominations have closed'; end if;
  if coalesce(p_accept, false) then
    v_problem := private.stand_problem((c.proposal->>'committee_id')::uuid, (c.proposal->>'seat_no')::int, v_me);
    if v_problem is not null then raise exception '%', v_problem; end if;
  end if;
  update public.election_nominations set status = case when coalesce(p_accept, false) then 'accepted' else 'declined' end, answered_at = now()
  where case_id = p_case and player_id = v_me;
  return case when coalesce(p_accept, false) then 'accepted' else 'declined' end;
end $$;

-- One person, one vote per seat (you can change it until the vote closes).
create or replace function public.vote_election(p_case uuid, p_nominee uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such election'; end if;
  if not private.is_contest(c) then raise exception 'That isn''t an election with nominations'; end if;
  perform private.require_case_feature(c.group_id, 'election');
  if c.status <> 'open' then raise exception 'This election is over'; end if;
  if c.election_phase <> 'voting' or c.stage <> 'voting' then raise exception 'Voting isn''t open'; end if;
  if c.closes_at <= now() then return 'closed:' || private.election_evaluate(p_case, true); end if;
  if private.is_group_guest(c.group_id) then raise exception 'Guests don''t vote in elections'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if not (v_me = any (private.case_voters(p_case))) then raise exception 'You don''t have a vote in this election'; end if;
  if not exists (select 1 from public.election_nominations where case_id = p_case and player_id = p_nominee and status = 'accepted') then
    raise exception 'Pick one of the candidates';
  end if;
  insert into public.election_ballots (case_id, group_id, voter_id, nominee_id) values (p_case, c.group_id, v_me, p_nominee)
  on conflict (case_id, voter_id) do update set nominee_id = excluded.nominee_id, created_at = now();
  return private.election_evaluate(p_case, false);
end $$;

-- An organiser picks the winner: a tie (from the tied candidates; never if they're in the tie), or a group where an
-- organiser decides elections (from the nominees; never themselves).
create or replace function public.decide_election(p_case uuid, p_winner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such election'; end if;
  if not private.is_contest(c) then raise exception 'That isn''t an election with nominations'; end if;
  if not private.is_group_organiser(c.group_id) then raise exception 'Only an organiser can pick the winner'; end if;
  if c.status <> 'open' or c.stage not in ('casting', 'organiser') then raise exception 'There''s nothing to pick yet'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if c.stage = 'casting' then
    if not (c.proposal->'tied') ? p_winner::text then raise exception 'Pick one of the tied candidates'; end if;
    if (c.proposal->'tied') ? v_me::text then raise exception 'You''re in the tie, so another organiser picks'; end if;
  else
    if not exists (select 1 from public.election_nominations where case_id = p_case and player_id = p_winner and status = 'accepted') then
      raise exception 'Pick one of the candidates';
    end if;
    if p_winner = v_me then raise exception 'You can''t pick yourself — another organiser picks'; end if;
  end if;
  perform private.election_fill(p_case, p_winner, case c.stage when 'casting' then 'A tie, decided by an organiser' else 'Picked by an organiser' end,
    v_me, coalesce(c.proposal->'results', private.election_results(p_case)));
end $$;

-- Step down from a seat. An elected seat gets a by-election straight away; an appointed one tells the organisers.
create or replace function public.resign_seat(p_committee uuid, p_seat_no int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare com public.committees; s public.committee_seats; v_me uuid; v_name text; v_case uuid;
begin
  select * into com from public.committees where id = p_committee;
  if com.id is null or not private.is_group_member(com.group_id) then raise exception 'No such committee'; end if;
  v_me := private.my_player_id(com.group_id);
  select * into s from public.committee_seats where committee_id = com.id and seat_no = p_seat_no;
  if v_me is null or s.player_id is distinct from v_me then raise exception 'Only the person in the seat can resign it'; end if;
  update public.committee_seats set player_id = null, started_at = null, reminded_at = null, election_opened_at = null, vacant_reminded_at = null
  where id = s.id;
  select coalesce(nickname, name) into v_name from public.players where id = v_me;
  perform private.gov_post(com.group_id, '🪑 ' || coalesce(v_name, 'Someone') || ' has stepped down from seat ' || p_seat_no || ' on the ' || com.name || '.', v_me, null, null);
  if com.fill = 'election' and public.feature_on(com.group_id, 'committees')
     and not exists (select 1 from public.cases x where x.group_id = com.group_id and x.kind = 'election' and x.status = 'open'
                     and x.proposal->>'committee_id' = com.id::text and (x.proposal->>'seat_no')::int = p_seat_no) then
    v_case := private.election_open(com.group_id, com.id, p_seat_no, null, 'by');
  elsif com.fill = 'appointment' then
    perform private.gov_queue(com.group_id, (select array_agg(player_id) from public.group_members where group_id = com.group_id and role = 'organiser'),
      'term_ending', '🪑 ' || com.name || ': seat ' || p_seat_no || ' is empty', 'Appoint someone in Governance → Committees.', v_me);
  end if;
  return v_case;
end $$;

-- The vote count so far, without saying who voted for whom: how many have voted, out of how many, and your vote.
create or replace function public.election_turnout(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.cases; v uuid[]; v_me uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) or not private.is_contest(c) then return null; end if;
  v := private.case_voters(p_case);
  v_me := private.my_player_id(c.group_id);
  return jsonb_build_object(
    'voted', (select count(*) from public.election_ballots where case_id = p_case and voter_id = any (v)),
    'voters', coalesce(cardinality(v), 0),
    'can_vote', v_me is not null and v_me = any (v) and not private.is_group_guest(c.group_id),
    'mine', (select nominee_id from public.election_ballots where case_id = p_case and voter_id = v_me));
end $$;

-- =================================================================================================== 061, extended
-- case_evaluate: elections with nominations settle by their own count (everything else exactly as 061).
create or replace function private.case_evaluate(p_case uuid, p_closed boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cases; r record;
begin
  select * into c from public.cases where id = p_case;
  if private.is_contest(c) then return private.election_evaluate(p_case, p_closed); end if;
  if c.id is null or c.status <> 'open' or c.stage <> 'voting' then return c.status; end if;
  select * into r from private.case_state(p_case, p_closed);
  if r.state in ('passed', 'failed') then
    perform private.case_finish(p_case, r.state, r.reason, null, null);
  elsif r.state = 'fallback' then
    update public.cases set stage = 'fallback', reason = r.reason where id = p_case;
    perform private.gov_queue(c.group_id, (select array_agg(player_id) from public.group_members where group_id = c.group_id and role = 'organiser'),
      'case_fallback', '⚖️ Over to you: ' || c.title, r.reason, c.subject_id);
  elsif r.state = 'casting' then
    update public.cases set stage = 'casting', reason = r.reason where id = p_case;
    perform private.gov_queue(c.group_id, (select array_agg(player_id) from public.group_members where group_id = c.group_id and role = 'organiser'),
      'case_casting', '⚖️ A tie — your casting vote: ' || c.title, null, c.subject_id);
  end if;
  return r.state;
end $$;

-- vote_case / decide_case: an election with nominations uses its own ballot (vote_election / decide_election).
create or replace function public.vote_case(p_case uuid, p_vote text, p_comment text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  if private.is_contest(c) then raise exception 'Vote for a candidate on the election page (update the app)'; end if;
  perform private.require_case_feature(c.group_id, c.kind);
  if c.status <> 'open' then raise exception 'This case is closed'; end if;
  if c.stage not in ('voting', 'organiser') then raise exception 'Voting has closed — it''s with the organisers now'; end if;
  if c.stage = 'voting' and c.closes_at is not null and c.closes_at <= now() then
    return 'closed:' || private.case_evaluate(p_case, true);
  end if;
  if private.is_group_guest(c.group_id) then raise exception 'Guests don''t vote in the Tribunal'; end if;
  if p_vote not in ('for', 'against', 'abstain') then raise exception 'Vote for, against or abstain'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if not (v_me = any (private.case_voters(p_case))) then
    if v_me = c.subject_id then raise exception 'You can''t vote on a case about yourself'; end if;
    raise exception 'You don''t have a vote on this case';
  end if;
  if c.kind = 'new_rule' and c.rule_id is not null then
    insert into public.rule_votes (group_id, rule_id, player_id, vote, comment, updated_at)
    values (c.group_id, c.rule_id, v_me, p_vote, nullif(left(btrim(coalesce(p_comment, '')), 200), ''), now())
    on conflict (rule_id, player_id) do update set vote = excluded.vote, comment = excluded.comment, updated_at = now();
  else
    insert into public.case_votes (case_id, group_id, player_id, vote, comment)
    values (p_case, c.group_id, v_me, p_vote, nullif(left(btrim(coalesce(p_comment, '')), 200), ''))
    on conflict (case_id, player_id) do update set vote = excluded.vote, comment = excluded.comment, created_at = now();
  end if;
  return private.case_evaluate(p_case, false);
end $$;

create or replace function public.decide_case(p_case uuid, p_outcome text, p_verdict text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  if private.is_contest(c) then raise exception 'Pick the winner on the election page (update the app)'; end if;
  perform private.require_case_feature(c.group_id, c.kind);
  if not private.is_group_organiser(c.group_id) then raise exception 'Only an organiser can decide this'; end if;
  if c.status <> 'open' then raise exception 'This case is closed'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is not null and v_me = c.subject_id then raise exception 'You can''t decide a case about yourself'; end if;
  if c.stage = 'voting' then raise exception 'This case is decided by vote'; end if;
  if p_outcome not in ('passed', 'failed') then raise exception 'Pass it or turn it down'; end if;
  if c.kind = 'ruling' and p_outcome = 'passed' and coalesce(btrim(coalesce(p_verdict, c.proposal->>'answer', '')), '') = '' then
    raise exception 'Write the ruling';
  end if;
  perform private.case_finish(p_case, p_outcome, case c.stage when 'casting' then 'Organiser''s casting vote' when 'fallback' then 'Decided by the organisers' else 'Decided by an organiser' end,
    v_me, coalesce(nullif(btrim(coalesce(p_verdict, '')), ''), case when c.kind = 'ruling' and p_outcome = 'passed' then c.proposal->>'answer' end));
end $$;

-- The hourly clock (061), plus: elections move from nominations to the vote; "voting closes tomorrow" counts ballots;
-- a term that's up opens an election with nominations (the holder is asked to stand again); an appointed seat whose
-- term is up reminds the organisers once.
create or replace function private.governance_tick_group(p_group uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare c record; s record; n int := 0; v_voted uuid[]; v_name text; v_comm public.committees;
begin
  for c in select id from public.cases where group_id = p_group and status = 'open' and stage = 'voting' and closes_at <= now() loop
    perform private.case_evaluate(c.id, true); n := n + 1;
  end loop;
  n := n + private.gov_apply_due(p_group, null);
  for c in select * from public.cases where group_id = p_group and status = 'open' and stage = 'voting' and reminded_at is null
           and election_phase is distinct from 'nominating'
           and closes_at > now() and closes_at <= now() + interval '24 hours' loop
    select coalesce(array_agg(player_id), '{}') into v_voted from (
      select player_id from public.case_votes where case_id = c.id
      union select player_id from public.rule_votes where rule_id = c.rule_id and c.kind = 'new_rule'
      union select voter_id from public.election_ballots where case_id = c.id) x;
    perform private.gov_queue(p_group, (select array_agg(v) from unnest(private.case_voters(c.id)) v where not (v = any (v_voted))),
      'case_closing', '⏳ Voting closes tomorrow: ' || c.title, 'Have your say in Governance.', null);
    update public.cases set reminded_at = now() where id = c.id;
  end loop;
  if public.feature_on(p_group, 'committees') then
    for s in select cs.*, t.ended, t.soon from public.committee_seats cs cross join lateral private.seat_term_ended(cs.id) t
             where cs.group_id = p_group and cs.player_id is not null loop
      select * into v_comm from public.committees where id = s.committee_id;
      continue when s.seat_no > v_comm.seats;
      select coalesce(nickname, name) into v_name from public.players where id = s.player_id;
      if s.soon and s.reminded_at is null then
        perform private.gov_queue(p_group, array[s.player_id] || (select array_agg(player_id) from public.group_members where group_id = p_group and role = 'organiser'),
          'term_ending', '🪑 ' || v_comm.name || ': ' || coalesce(v_name, 'a') || '''s term is nearly up',
          case when v_comm.fill = 'election' then 'An election opens when it ends.' else 'An organiser re-appoints or appoints someone new.' end, null);
        update public.committee_seats set reminded_at = now() where id = s.id;
      elsif s.ended and s.election_opened_at is null then
        if v_comm.fill = 'election' then
          begin
            if not exists (select 1 from public.cases x where x.group_id = p_group and x.kind = 'election' and x.status = 'open'
                           and x.proposal->>'committee_id' = v_comm.id::text and (x.proposal->>'seat_no')::int = s.seat_no) then
              perform private.election_open(p_group, v_comm.id, s.seat_no, null, 'term');
            end if;
          exception when others then raise warning 'term election: %', sqlerrm;
          end;
        else
          perform private.gov_queue(p_group, (select array_agg(player_id) from public.group_members where group_id = p_group and role = 'organiser'),
            'term_ending', '🪑 ' || v_comm.name || ': ' || coalesce(v_name, 'a') || '''s term is up', 'Re-appoint them or appoint someone new.', null);
        end if;
        update public.committee_seats set election_opened_at = now() where id = s.id;
      end if;
    end loop;
  end if;
  return n;
end $$;

-- =================================================================================================== grants
revoke all on function private.seat_terms(), private.stand_problem(uuid, int, uuid), private.election_case_guard(),
  private.is_contest(public.cases), private.election_open(uuid, uuid, int, uuid, text),
  private.election_fill(uuid, uuid, text, uuid, jsonb), private.election_none(uuid, text, jsonb), private.election_results(uuid),
  private.election_evaluate(uuid, boolean), private.seat_term_ended(uuid), private.case_evaluate(uuid, boolean),
  private.governance_tick_group(uuid)
from public, anon, authenticated;
revoke all on function public.save_committee_v2(uuid, text, text[], int, text, int, numeric, int, boolean, int),
  public.call_election(uuid, int), public.nominate(uuid, uuid), public.answer_nomination(uuid, boolean),
  public.vote_election(uuid, uuid), public.decide_election(uuid, uuid), public.resign_seat(uuid, int),
  public.election_turnout(uuid), public.vote_case(uuid, text, text), public.decide_case(uuid, text, text)
from public, anon, service_role;   -- assistants (the connector's key) never vote, nominate, decide or appoint (as 061b)
grant execute on function public.save_committee_v2(uuid, text, text[], int, text, int, numeric, int, boolean, int),
  public.call_election(uuid, int), public.nominate(uuid, uuid), public.answer_nomination(uuid, boolean),
  public.vote_election(uuid, uuid), public.decide_election(uuid, uuid), public.resign_seat(uuid, int),
  public.election_turnout(uuid), public.vote_case(uuid, text, text), public.decide_case(uuid, text, text)
to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'election_nominations') then
    alter publication supabase_realtime add table public.election_nominations;
  end if;
end $$;
select private.add_same_group_checks();
