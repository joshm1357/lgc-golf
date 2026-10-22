-- 061 — Governance and the Tribunal (Stage 11b, 21 Oct 2026). ADDITIVE ONLY: new tables, columns, functions and
-- triggers. Nothing is dropped or renamed; old functions keep their names, arguments and (for every group that hasn't
-- chosen new settings, which includes L.G.C) their behaviour.
--
-- Words: a CASE is anything raised for the group to decide, serious or silly. The HEARING is the time it's open (the
-- case is put, the person it's about can reply, people discuss and vote). The VERDICT is its result. A DECISION RULE is
-- who decides a kind of case and how. A COMMITTEE is a named set of players who decide certain kinds of case; a SEAT is
-- a place on it and a TERM is how long the holder keeps it.
--
-- How it fits what's already here:
--  * The Handicap Tribunal (tribunal_cases / tribunal_votes, lodge_case, cast_vote, set_defence, chair_close_case,
--    finalise_case, the players_handicap_guard) keeps working exactly as before: handicap cases ARE today's tables.
--    lodge_case and cast_vote gain one check each that only matters when a group picks stricter settings
--    (organisers-only raising; a Handicap Committee). With no settings (L.G.C) they behave exactly as before.
--  * Rulebook voting: a proposed rule (old app: insert into rules with status 'proposed') becomes a 'new_rule' case
--    automatically (trigger); its votes stay in rule_votes, so old and new app versions see the same votes. An
--    organiser adopting/rejecting it the old way closes the case — when the group's decision rule says an organiser
--    decides (L.G.C does). A group that has chosen "players decide" can't skip the vote from an old app: the database
--    refuses.
--  * groups.vote_decider stays the source of truth for "Trip decisions" (the planner's can_decide reads it).
--  * Each change to a rule is kept (rule_versions), and each round records which version of every rule it was
--    played under (round_rule_versions), taken when the round goes live.
--  * Rule and governance changes start from the next trip (or mid-trip from the next round, if the group allows it
--    and an organiser approves). A round in play never changes underneath anyone.
--  * Assistants (the connector) can raise cases (connector_raise_case, service role only) and read verdicts; there is
--    no way for them to vote, decide or approve — those functions need a signed-in person.
--  * Penalties are words only. Nothing here moves money.
--
-- Feature switches: tribunal (all cases), rule_challenges (change/scrap/ruling; also needs rule_voting), other_cases
-- ("anything else"), committees (committees and elections), rule_voting (new rules, as before). Migration 060 added
-- the keys.

-- =================================================================================================== tables
create table if not exists public.governance_group (
  group_id uuid primary key references public.groups(id) on delete cascade,
  preset text check (preset is null or preset in ('organiser', 'majority', 'club', 'lgc', 'custom')),
  share_cards boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.players(id) on delete set null
);

create table if not exists public.committees (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 40),
  kinds text[] not null default '{}' check (kinds <@ array['new_rule','change_rule','scrap_rule','ruling','handicap','other','election','governance']::text[]),
  seats int not null default 3 check (seats between 1 and 15),
  fill text not null default 'election' check (fill in ('election', 'appointment')),
  term_trips int check (term_trips is null or term_trips between 1 and 20),
  term_years numeric check (term_years is null or (term_years >= 0.25 and term_years <= 10)),
  created_at timestamptz not null default now()
);
create index if not exists committees_group_idx on public.committees (group_id);

create table if not exists public.committee_seats (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  committee_id uuid not null references public.committees(id) on delete cascade,
  seat_no int not null check (seat_no between 1 and 15),
  player_id uuid references public.players(id) on delete set null,
  started_at timestamptz,
  reminded_at timestamptz,
  election_opened_at timestamptz,
  unique (committee_id, seat_no)
);
create index if not exists committee_seats_group_idx on public.committee_seats (group_id);
create index if not exists committee_seats_player_idx on public.committee_seats (player_id);

create table if not exists public.governance_settings (
  group_id uuid not null references public.groups(id) on delete cascade,
  kind text not null check (kind in ('new_rule','change_rule','scrap_rule','ruling','handicap','other','trip_decision','election','governance')),
  decides text not null check (decides in ('organiser','organisers_majority','organisers_all','committee','players_majority','players_two_thirds','trip_organiser')),
  committee_id uuid references public.committees(id) on delete set null,
  raise_by text not null default 'players' check (raise_by in ('players', 'organisers')),
  close_hours int not null default 48 check (close_hours between 1 and 720),
  min_turnout numeric not null default 0 check (min_turnout >= 0 and min_turnout <= 1),
  tie_break text not null default 'status_quo' check (tie_break in ('status_quo', 'organiser')),
  subject_votes boolean not null default false,
  takes_effect text not null default 'next_trip' check (takes_effect in ('now', 'next_trip', 'mid_trip_approval')),
  updated_at timestamptz not null default now(),
  primary key (group_id, kind)
);
create index if not exists governance_settings_committee_idx on public.governance_settings (committee_id);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  kind text not null check (kind in ('new_rule','change_rule','scrap_rule','ruling','other','election','governance')),
  title text not null check (length(btrim(title)) between 3 and 140),
  body text check (body is null or length(body) <= 2000),
  subject_id uuid references public.players(id) on delete set null,          -- the person it's about
  rule_id uuid references public.rules(id) on delete set null,
  committee_id uuid references public.committees(id) on delete set null,
  proposal jsonb not null default '{}'::jsonb,                                 -- new wording, settings, candidate…
  penalty text check (penalty is null or length(penalty) <= 140),             -- words only
  evidence_url text check (evidence_url is null or length(evidence_url) <= 400),
  evidence_post_id uuid references public.posts(id) on delete set null,
  raised_by uuid references public.players(id) on delete set null,
  raised_via text not null default 'app' check (raised_via in ('app', 'assistant', 'rulebook')),
  settings jsonb not null,                                                     -- the decision rule when raised
  stage text not null default 'voting' check (stage in ('voting', 'organiser', 'casting', 'fallback')),
  status text not null default 'open' check (status in ('open', 'passed', 'failed', 'withdrawn')),
  closes_at timestamptz,
  reason text,
  verdict text check (verdict is null or length(verdict) <= 600),
  votes_for int, votes_against int, votes_abstain int,
  decided_by uuid references public.players(id) on delete set null,
  decided_at timestamptz,
  apply_state text check (apply_state is null or apply_state in ('waiting_next_trip', 'next_round', 'applied', 'none')),
  trip_at_verdict uuid references public.trips(id) on delete set null,
  approved_by uuid references public.players(id) on delete set null,
  approved_at timestamptz,
  applied_at timestamptz,
  reminded_at timestamptz,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists cases_group_idx on public.cases (group_id, created_at desc);
create index if not exists cases_rule_idx on public.cases (rule_id);
create index if not exists cases_subject_idx on public.cases (subject_id);
create index if not exists cases_raised_by_idx on public.cases (raised_by);
create index if not exists cases_decided_by_idx on public.cases (decided_by);
create index if not exists cases_approved_by_idx on public.cases (approved_by);
create index if not exists cases_committee_idx on public.cases (committee_id);
create index if not exists cases_post_idx on public.cases (evidence_post_id);
create index if not exists cases_trip_idx on public.cases (trip_at_verdict);
create index if not exists cases_open_idx on public.cases (group_id) where status = 'open';
create unique index if not exists cases_one_open_per_rule on public.cases (rule_id) where status = 'open' and rule_id is not null;

create table if not exists public.case_votes (
  case_id uuid not null references public.cases(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  vote text not null check (vote in ('for', 'against', 'abstain')),
  comment text check (comment is null or length(comment) <= 200),
  created_at timestamptz not null default now(),
  primary key (case_id, player_id)
);
create index if not exists case_votes_group_idx on public.case_votes (group_id);
create index if not exists case_votes_player_idx on public.case_votes (player_id);

create table if not exists public.case_posts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  kind text not null default 'comment' check (kind in ('comment', 'reply', 'evidence', 'report')),
  body text check (body is null or length(body) <= 1000),
  photo_url text check (photo_url is null or length(photo_url) <= 400),
  post_id uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists case_posts_case_idx on public.case_posts (case_id, created_at);
create index if not exists case_posts_group_idx on public.case_posts (group_id);
create index if not exists case_posts_player_idx on public.case_posts (player_id);
create index if not exists case_posts_post_idx on public.case_posts (post_id);

-- Every version of every rule (and when it was adopted, changed, retired…), newest last.
create table if not exists public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  rule_id uuid not null references public.rules(id) on delete cascade,
  version int not null,
  event text not null check (event in ('recorded', 'proposed', 'added', 'adopted', 'rejected', 'changed', 'retired', 'restored')),
  title text, detail text, value text, category text, applies_to text[], status text,
  case_id uuid references public.cases(id) on delete set null,
  changed_by uuid references public.players(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists rule_versions_rule_idx on public.rule_versions (rule_id, created_at);
create index if not exists rule_versions_group_idx on public.rule_versions (group_id);
create index if not exists rule_versions_case_idx on public.rule_versions (case_id);
create index if not exists rule_versions_by_idx on public.rule_versions (changed_by);

-- Which version of each rule a round was played under (recorded when the round goes live).
create table if not exists public.round_rule_versions (
  round_id uuid not null references public.rounds(id) on delete cascade,
  rule_id uuid not null references public.rules(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  version int not null,
  recorded_at timestamptz not null default now(),
  primary key (round_id, rule_id)
);
create index if not exists round_rule_versions_group_idx on public.round_rule_versions (group_id);
create index if not exists round_rule_versions_rule_idx on public.round_rule_versions (rule_id);

-- =================================================================================================== access
-- Members read; nobody writes directly — every change goes through the functions below, which check the group's
-- decision rules. (Restrictive "same group" and "feature on" policies as everywhere else.)
do $$
declare t text;
begin
  foreach t in array array['governance_group','governance_settings','committees','committee_seats','cases','case_votes',
                           'case_posts','rule_versions','round_rule_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "same group only" on public.%I as restrictive for all using (group_id = any ((select private.my_group_ids())::uuid[])) with check (group_id = any ((select private.my_group_ids())::uuid[]))', t);
  end loop;
end $$;
create policy "members read" on public.governance_group for select using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "members read" on public.governance_settings for select using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "members read" on public.committees for select using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "members read" on public.committee_seats for select using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "members read" on public.rule_versions for select using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "members read" on public.round_rule_versions for select using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "members read" on public.case_votes for select using (group_id = any ((select private.my_group_ids())::uuid[]));
-- A hidden case: only organisers and whoever raised it still see it.
create policy "members read" on public.cases for select using (
  group_id = any ((select private.my_group_ids())::uuid[])
  and (not hidden or group_id = any ((select private.my_organiser_group_ids())::uuid[]) or raised_by = private.my_player_id(group_id)));
-- Reports are for organisers' eyes only.
create policy "members read" on public.case_posts for select using (
  group_id = any ((select private.my_group_ids())::uuid[])
  and (kind <> 'report' or group_id = any ((select private.my_organiser_group_ids())::uuid[]) or player_id = private.my_player_id(group_id)));
-- Feature switches (writes only happen in the functions, which check them too).
create policy "feature on: tribunal (add)" on public.cases as restrictive for insert with check (public.feature_on(group_id, 'tribunal') or kind = 'new_rule');
create policy "feature on: committees (add)" on public.committees as restrictive for insert with check (public.feature_on(group_id, 'committees'));
create policy "feature on: committees (change)" on public.committees as restrictive for update using (public.feature_on(group_id, 'committees')) with check (public.feature_on(group_id, 'committees'));

create trigger aa_fill_group_id before insert or update on public.governance_group for each row execute function private.fill_group_id();
create trigger aa_fill_group_id before insert or update on public.governance_settings for each row execute function private.fill_group_id('committees:committee_id');
create trigger aa_fill_group_id before insert or update on public.committees for each row execute function private.fill_group_id();
create trigger aa_fill_group_id before insert or update on public.committee_seats for each row execute function private.fill_group_id('committees:committee_id', 'players:player_id');
create trigger aa_fill_group_id before insert or update on public.cases for each row execute function private.fill_group_id('rules:rule_id', 'players:subject_id');
create trigger aa_fill_group_id before insert or update on public.case_votes for each row execute function private.fill_group_id('cases:case_id', 'players:player_id');
create trigger aa_fill_group_id before insert or update on public.case_posts for each row execute function private.fill_group_id('cases:case_id');
create trigger aa_fill_group_id before insert or update on public.rule_versions for each row execute function private.fill_group_id('rules:rule_id');
create trigger aa_fill_group_id before insert or update on public.round_rule_versions for each row execute function private.fill_group_id('rounds:round_id', 'rules:rule_id');

-- =================================================================================================== settings
-- A preset's setting for one kind. Same as PRESETS in src/lib/governance.js. Unknown preset = 'lgc' (today).
create or replace function private.gov_preset(p_preset text, p_kind text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare s jsonb := jsonb_build_object('decides', 'players_majority', 'committee_id', null, 'raise_by', 'players', 'close_hours', 48,
  'min_turnout', 0, 'tie_break', 'status_quo', 'subject_votes', false, 'takes_effect', 'next_trip');
begin
  if p_preset = 'organiser' then
    return s || jsonb_build_object('decides', 'organiser', 'takes_effect', 'mid_trip_approval');
  elsif p_preset = 'majority' then
    if p_kind = 'trip_decision' then return s || '{"decides":"organiser"}'; end if;
    return s || jsonb_build_object('min_turnout', case when p_kind = 'handicap' then 0 else 0.5 end);
  elsif p_preset = 'club' then
    if p_kind = 'trip_decision' then return s || '{"decides":"organiser"}'; end if;
    if p_kind in ('handicap', 'new_rule', 'change_rule', 'scrap_rule', 'ruling') then return s || '{"decides":"committee","min_turnout":0.5}'; end if;
    if p_kind = 'governance' then return s || '{"decides":"players_two_thirds","min_turnout":0.5}'; end if;
    return s || '{"min_turnout":0.5}';
  end if;
  -- L.G.C, as today: the lads vote on handicaps (and on "anything else" and elections); organisers decide the rest.
  if p_kind in ('handicap', 'other', 'election') then return s || '{"takes_effect":"now"}'; end if;
  return s || '{"decides":"organiser","takes_effect":"now"}';
end $$;

-- What applies to a kind of case in a group: its own row, else today's behaviour. Trip decisions follow vote_decider.
create or replace function private.gov_settings(p_group uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.governance_settings; s jsonb; v_vd text;
begin
  select * into r from public.governance_settings where group_id = p_group and kind = p_kind;
  if r.group_id is null then s := private.gov_preset('lgc', p_kind);
  else
    s := jsonb_build_object('decides', r.decides, 'committee_id', r.committee_id, 'raise_by', r.raise_by, 'close_hours', r.close_hours,
      'min_turnout', r.min_turnout, 'tie_break', r.tie_break, 'subject_votes', r.subject_votes, 'takes_effect', r.takes_effect);
  end if;
  if p_kind = 'trip_decision' then
    select vote_decider into v_vd from public.groups where id = p_group;
    s := s || jsonb_build_object('decides', case when v_vd = 'admin_or_organiser' then 'trip_organiser' else 'organiser' end);
  end if;
  return s;
end $$;

-- Is a setting one that can pass? Returns a reason it can't, or null.
create or replace function private.gov_settings_problem(p_group uuid, p_kind text, s jsonb) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_seats int;
begin
  if p_kind = 'trip_decision' then
    if s->>'decides' not in ('organiser', 'trip_organiser') then return 'Trip decisions: an organiser, or the trip''s organiser'; end if;
    return null;
  end if;
  if p_kind = 'handicap' and s->>'decides' not in ('players_majority', 'organiser', 'committee') then
    return 'Handicap cases: the players, an organiser (the chair), or a committee';
  end if;
  if s->>'decides' not in ('organiser','organisers_majority','organisers_all','committee','players_majority','players_two_thirds') then
    return 'Unknown decision rule';
  end if;
  if s->>'decides' = 'committee' then
    select seats into v_seats from public.committees where id = nullif(s->>'committee_id', '')::uuid and group_id = p_group;
    if v_seats is null then return 'Pick a committee'; end if;
    if v_seats < 1 then return 'A committee needs at least one seat'; end if;
  end if;
  if coalesce(s->>'raise_by', 'players') not in ('players', 'organisers') then return 'Who can raise it: players or organisers'; end if;
  if coalesce((s->>'close_hours')::int, 48) not between 1 and 720 then return 'Voting closes after 1 hour to 30 days'; end if;
  if coalesce((s->>'min_turnout')::numeric, 0) not between 0 and 1 then return 'Minimum turnout is between none and everyone'; end if;
  if coalesce(s->>'tie_break', 'status_quo') not in ('status_quo', 'organiser') then return 'Unknown tie-break'; end if;
  if coalesce(s->>'takes_effect', 'next_trip') not in ('now', 'next_trip', 'mid_trip_approval') then return 'Unknown start'; end if;
  return null;
end $$;

-- Write one kind's setting (no permission check here: callers check).
create or replace function private.gov_write(p_group uuid, p_kind text, s jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_problem text := private.gov_settings_problem(p_group, p_kind, s);
begin
  if v_problem is not null then raise exception '%', v_problem; end if;
  if p_kind = 'trip_decision' then
    update public.groups set vote_decider = case when s->>'decides' = 'trip_organiser' then 'admin_or_organiser' else 'admin' end where id = p_group;
  end if;
  insert into public.governance_settings (group_id, kind, decides, committee_id, raise_by, close_hours, min_turnout, tie_break, subject_votes, takes_effect, updated_at)
  values (p_group, p_kind, case when p_kind = 'trip_decision' then 'organiser' else s->>'decides' end,
    case when s->>'decides' = 'committee' then nullif(s->>'committee_id', '')::uuid end,
    coalesce(s->>'raise_by', 'players'), coalesce((s->>'close_hours')::int, 48), coalesce((s->>'min_turnout')::numeric, 0),
    coalesce(s->>'tie_break', 'status_quo'), coalesce((s->>'subject_votes')::boolean, false), coalesce(s->>'takes_effect', 'next_trip'), now())
  on conflict (group_id, kind) do update set decides = excluded.decides, committee_id = excluded.committee_id, raise_by = excluded.raise_by,
    close_hours = excluded.close_hours, min_turnout = excluded.min_turnout, tie_break = excluded.tie_break,
    subject_votes = excluded.subject_votes, takes_effect = excluded.takes_effect, updated_at = now();
end $$;

-- Apply a preset to a group (Club style makes its two committees, and switches committees on).
create or replace function private.gov_apply_preset(p_group uuid, p_preset text, p_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare k text; s jsonb; v_hc uuid; v_rc uuid; i int;
begin
  if p_preset not in ('organiser', 'majority', 'club', 'lgc') then raise exception 'Unknown preset'; end if;
  if p_preset = 'club' then
    insert into public.group_features (group_id, feature_key, enabled) values (p_group, 'committees', true)
      on conflict (group_id, feature_key) do update set enabled = true;
    select id into v_hc from public.committees where group_id = p_group and kinds @> array['handicap'] order by created_at limit 1;
    if v_hc is null then
      insert into public.committees (group_id, name, kinds, seats, fill, term_trips, term_years)
      values (p_group, 'Handicap Committee', array['handicap'], 3, 'election', 2, 1) returning id into v_hc;
      for i in 1..3 loop insert into public.committee_seats (group_id, committee_id, seat_no) values (p_group, v_hc, i); end loop;
    end if;
    select id into v_rc from public.committees where group_id = p_group and kinds && array['new_rule','change_rule','scrap_rule','ruling'] order by created_at limit 1;
    if v_rc is null then
      insert into public.committees (group_id, name, kinds, seats, fill, term_trips, term_years)
      values (p_group, 'Rules Committee', array['new_rule','change_rule','scrap_rule','ruling'], 3, 'election', 2, 1) returning id into v_rc;
      for i in 1..3 loop insert into public.committee_seats (group_id, committee_id, seat_no) values (p_group, v_rc, i); end loop;
    end if;
  end if;
  foreach k in array array['new_rule','change_rule','scrap_rule','ruling','handicap','other','election','governance'] loop
    s := private.gov_preset(p_preset, k);
    if s->>'decides' = 'committee' then
      s := s || jsonb_build_object('committee_id', case when k = 'handicap' then v_hc else v_rc end);
    end if;
    perform private.gov_write(p_group, k, s);
  end loop;
  -- Trip decisions: presets leave vote_decider as the group has it.
  insert into public.governance_group (group_id, preset, updated_at, updated_by) values (p_group, p_preset, now(), p_by)
  on conflict (group_id) do update set preset = excluded.preset, updated_at = now(), updated_by = excluded.updated_by;
end $$;

-- Can governance settings be changed directly by this organiser? Only when governance changes are an organiser's call
-- (L.G.C and "Organiser runs it"), or the Tribunal is switched off. Otherwise a governance change is a case.
create or replace function private.gov_direct_ok(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_group_organiser(p_group)
     and (private.gov_settings(p_group, 'governance')->>'decides' = 'organiser' or not public.feature_on(p_group, 'tribunal'))
$$;

create or replace function public.apply_governance_preset(p_preset text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can change the Tribunal settings'; end if;
  if not private.gov_direct_ok(v_g) then raise exception 'Your group decides governance changes by vote — raise a Governance change case'; end if;
  perform private.gov_apply_preset(v_g, p_preset, private.my_player_id(v_g));
end $$;

create or replace function public.set_governance(p_kind text, p_settings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can change the Tribunal settings'; end if;
  if p_kind = 'trip_decision' then
    perform private.gov_write(v_g, p_kind, p_settings);   -- the planner setting organisers could always change (set_vote_decider)
    return;
  end if;
  if not private.gov_direct_ok(v_g) then raise exception 'Your group decides governance changes by vote — raise a Governance change case'; end if;
  perform private.gov_write(v_g, p_kind, private.gov_settings(v_g, p_kind) || coalesce(p_settings, '{}'::jsonb));
  insert into public.governance_group (group_id, preset, updated_at, updated_by) values (v_g, 'custom', now(), private.my_player_id(v_g))
  on conflict (group_id) do update set preset = 'custom', updated_at = now(), updated_by = excluded.updated_by;
end $$;

create or replace function public.set_tribunal_share_cards(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can change that'; end if;
  insert into public.governance_group (group_id, share_cards, updated_at, updated_by) values (v_g, coalesce(p_on, true), now(), private.my_player_id(v_g))
  on conflict (group_id) do update set share_cards = excluded.share_cards, updated_at = now(), updated_by = excluded.updated_by;
end $$;

-- New groups start on Majority rules (quick groups: Organiser runs it). Existing groups — L.G.C included — keep
-- today's behaviour until an organiser picks a preset.
create or replace function private.gov_new_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.gov_apply_preset(new.id, case when new.quick then 'organiser' else 'majority' end, null);
  exception when others then
    raise warning 'governance defaults for a new group: %', sqlerrm;   -- never stop a group being made
  end;
  return new;
end $$;
create or replace trigger zz_gov_new_group after insert on public.groups
  for each row when (new.legacy is not true) execute function private.gov_new_group();

-- =================================================================================================== helpers
-- The trip under way: a live round's trip, or a trip (not locked) whose dates include today in Sydney.
create or replace function private.gov_trip_in_progress(p_group uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select r.trip_id from public.rounds r where r.group_id = p_group and r.status = 'live' and r.trip_id is not null order by r.created_at desc limit 1),
    (select t.id from public.trips t where t.group_id = p_group and t.status <> 'locked' and t.start_date is not null
       and t.start_date <= (now() at time zone 'Australia/Sydney')::date
       and coalesce(t.end_date, t.start_date) >= (now() at time zone 'Australia/Sydney')::date
     order by t.start_date desc limit 1))
$$;

create or replace function private.gov_live_round(p_group uuid, p_except uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rounds where group_id = p_group and status = 'live' and id is distinct from p_except)
$$;

-- Who holds a seat on a committee now (seats within its size, still in the group, not guests).
create or replace function private.committee_members(p_group uuid, p_committee uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct s.player_id), '{}') from public.committee_seats s
  join public.committees c on c.id = s.committee_id
  where s.committee_id = p_committee and c.group_id = p_group and s.player_id is not null and s.seat_no <= c.seats
    and exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.player_id = s.player_id and gm.role <> 'guest')
$$;

-- Phone notifications through the existing hourly send (notify_queue; the notify function's digest picks them up).
-- p_players null = everyone in the group. p_except: never the person who caused it.
create or replace function private.gov_queue(p_group uuid, p_players uuid[], p_kind text, p_title text, p_body text, p_except uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.feature_on(p_group, 'notifications') then return; end if;
  insert into public.notify_queue (group_id, user_id, kind, title, body, url)
  select distinct p_group, gm.user_id, p_kind, left(p_title, 160), left(coalesce(p_body, ''), 300), null::text
  from public.group_members gm
  where gm.group_id = p_group and gm.user_id is not null
    and (p_players is null or gm.player_id = any (p_players))
    and gm.player_id is distinct from p_except
    and exists (select 1 from public.push_subscriptions s where s.user_id = gm.user_id);
end $$;

create or replace function private.gov_post(p_group uuid, p_body text, p_player uuid, p_case uuid, p_photo text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.feature_on(p_group, 'feed') then
    insert into public.posts (group_id, kind, body, player_id, link, photo_url)
    values (p_group, 'tribunal', left(p_body, 500), p_player, '/tribunal/case/' || p_case, p_photo);
  end if;
end $$;

-- Which feature a kind of case needs.
create or replace function private.case_feature_ok(p_group uuid, p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'new_rule' then public.feature_on(p_group, 'rule_voting')
    when 'change_rule' then public.feature_on(p_group, 'rule_challenges') and public.feature_on(p_group, 'rule_voting')
    when 'scrap_rule' then public.feature_on(p_group, 'rule_challenges') and public.feature_on(p_group, 'rule_voting')
    when 'ruling' then public.feature_on(p_group, 'rule_challenges') and public.feature_on(p_group, 'rule_voting')
    when 'other' then public.feature_on(p_group, 'other_cases')
    when 'election' then public.feature_on(p_group, 'committees')
    when 'governance' then public.feature_on(p_group, 'tribunal')
    else false end
$$;
create or replace function private.require_case_feature(p_group uuid, p_kind text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.case_feature_ok(p_group, p_kind) then
    raise exception '% cases are switched off for this group', case p_kind when 'other' then '"Anything else"'
      when 'election' then 'Committee' when 'new_rule' then 'Rule' when 'governance' then 'Governance' else 'Rule challenge' end;
  end if;
end $$;

-- =================================================================================================== deciding
-- The electorate of a case: who can vote (or, for an organiser-decided case, give a show of hands).
create or replace function private.case_voters(p_case uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare c public.cases; d text; v uuid[];
begin
  select * into c from public.cases where id = p_case;
  d := c.settings->>'decides';
  if c.stage in ('organiser', 'casting', 'fallback') or d in ('organiser', 'trip_organiser') or d like 'players%' then
    select coalesce(array_agg(distinct gm.player_id), '{}') into v from public.group_members gm
    where gm.group_id = c.group_id and gm.player_id is not null and gm.role <> 'guest'
      and (coalesce((c.settings->>'subject_votes')::boolean, false) or gm.player_id is distinct from c.subject_id);
    return v;
  elsif d like 'organisers%' then
    select coalesce(array_agg(distinct gm.player_id), '{}') into v from public.group_members gm
    where gm.group_id = c.group_id and gm.player_id is not null and gm.role = 'organiser' and gm.player_id is distinct from c.subject_id;
    return v;
  elsif d = 'committee' then
    return array_remove(private.committee_members(c.group_id, nullif(c.settings->>'committee_id', '')::uuid), c.subject_id);
  end if;
  return '{}';
end $$;

-- The votes on a case (a new rule's votes live in rule_votes, so old app versions see them too).
create or replace function private.case_tally(p_case uuid, p_voters uuid[], out n_for int, out n_against int, out n_abstain int)
language plpgsql stable security definer set search_path = '' as $$
declare c public.cases;
begin
  select * into c from public.cases where id = p_case;
  if c.kind = 'new_rule' and c.rule_id is not null then
    select count(*) filter (where vote = 'for'), count(*) filter (where vote = 'against'), count(*) filter (where vote = 'abstain')
      into n_for, n_against, n_abstain from public.rule_votes where rule_id = c.rule_id and player_id = any (p_voters);
  else
    select count(*) filter (where vote = 'for'), count(*) filter (where vote = 'against'), count(*) filter (where vote = 'abstain')
      into n_for, n_against, n_abstain from public.case_votes where case_id = p_case and player_id = any (p_voters);
  end if;
end $$;

-- Where a voting case stands. Same rules as evaluate() in src/lib/governance.js.
-- Returns 'open' | 'passed' | 'failed' | 'fallback' | 'casting', and a reason.
create or replace function private.case_state(p_case uuid, p_closed boolean, out state text, out reason text)
language plpgsql stable security definer set search_path = '' as $$
declare c public.cases; v uuid[]; n int; f int; a int; ab int; cast_n int; rem int; need int; met boolean; done boolean;
        d text; casting boolean;
begin
  select * into c from public.cases where id = p_case;
  d := c.settings->>'decides';
  if c.stage <> 'voting' or d in ('organiser', 'trip_organiser') then state := 'organiser'; reason := 'An organiser decides'; return; end if;
  v := private.case_voters(p_case);
  n := coalesce(cardinality(v), 0);
  if n = 0 then state := 'fallback'; reason := 'Nobody left to vote — the organisers decide'; return; end if;
  select t.n_for, t.n_against, t.n_abstain into f, a, ab from private.case_tally(p_case, v) t;
  cast_n := f + a + ab; rem := n - cast_n;
  need := ceil(coalesce((c.settings->>'min_turnout')::numeric, 0) * n - 0.000000001);
  met := cast_n >= need;
  done := p_closed or rem <= 0;
  casting := c.settings->>'tie_break' = 'organiser';
  if d = 'organisers_all' then
    if a > 0 or ab > 0 then state := 'failed'; reason := 'Not every organiser agreed'; return; end if;
    if f = n then state := 'passed'; reason := 'Every organiser agreed'; return; end if;
    if done then state := 'failed'; reason := 'Not every organiser voted'; else state := 'open'; reason := 'Waiting for every organiser'; end if;
    return;
  end if;
  if not done then
    if d = 'players_two_thirds' then
      if met and f * 3 >= 2 * (f + a + rem) then state := 'passed'; reason := 'Two-thirds are in'; return; end if;
      if (f + rem) * 3 < 2 * (f + rem + a) then state := 'failed'; reason := 'It can''t reach two-thirds now'; return; end if;
    else
      if met and f > a + rem then state := 'passed'; reason := 'A majority is in'; return; end if;
      if a > f + rem or (a = f + rem and not casting) then state := 'failed'; reason := 'It can''t pass now'; return; end if;
    end if;
    state := 'open'; reason := 'Voting'; return;
  end if;
  if not met then
    if d = 'committee' then state := 'fallback'; reason := 'The committee didn''t reach its turnout — the organisers decide';
    else state := 'failed'; reason := 'Not enough people voted, so it stays as it is'; end if;
    return;
  end if;
  if d = 'players_two_thirds' then
    if f > 0 and f * 3 >= 2 * (f + a) then state := 'passed'; reason := 'Two-thirds voted for';
    else state := 'failed'; reason := 'Short of two-thirds'; end if;
    return;
  end if;
  if f > a then state := 'passed'; reason := 'Majority for';
  elsif f < a then state := 'failed'; reason := 'Majority against';
  elsif casting then state := 'casting'; reason := 'A tie — an organiser has the casting vote';
  else state := 'failed'; reason := 'A tie, so it stays as it is'; end if;
end $$;

-- Do what a passed case says. Only ever called by the server functions below, once the decision rule is met.
create or replace function private.case_apply(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases; p jsonb; s jsonb; v_seat public.committee_seats; v_tally text;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or c.status <> 'passed' or c.apply_state = 'applied' then return; end if;
  p := c.proposal;
  v_tally := coalesce(c.votes_for, 0) || '–' || coalesce(c.votes_against, 0);
  perform set_config('app.gov_apply', 'on', true);
  perform set_config('app.gov_case', c.id::text, true);
  if c.kind = 'new_rule' then
    update public.rules set status = 'active', decided_at = now(),
      decision_note = coalesce(nullif(c.verdict, ''), 'Passed by the Tribunal ' || v_tally || '.')
    where id = c.rule_id and status = 'proposed';
  elsif c.kind = 'change_rule' then
    update public.rules set
      title = coalesce(nullif(btrim(p->>'title'), ''), title),
      detail = case when p ? 'detail' then nullif(btrim(p->>'detail'), '') else detail end,
      value = case when p ? 'value' then nullif(btrim(p->>'value'), '') else value end,
      decision_note = 'Changed by the Tribunal ' || v_tally || '.'
    where id = c.rule_id and status = 'active';
  elsif c.kind = 'scrap_rule' then
    update public.rules set status = 'retired', decided_at = now(), decision_note = 'Scrapped by the Tribunal ' || v_tally || '.'
    where id = c.rule_id and status = 'active';
  elsif c.kind = 'governance' then
    if p ? 'preset' then
      perform private.gov_apply_preset(c.group_id, p->>'preset', c.raised_by);
    else
      perform private.gov_write(c.group_id, p->>'target_kind', private.gov_settings(c.group_id, p->>'target_kind') || coalesce(p->'settings', '{}'::jsonb));
      insert into public.governance_group (group_id, preset, updated_at) values (c.group_id, 'custom', now())
      on conflict (group_id) do update set preset = 'custom', updated_at = now();
    end if;
  elsif c.kind = 'election' then
    insert into public.committee_seats (group_id, committee_id, seat_no, player_id, started_at)
    values (c.group_id, (p->>'committee_id')::uuid, (p->>'seat_no')::int, (p->>'candidate')::uuid, now())
    on conflict (committee_id, seat_no) do update set player_id = excluded.player_id, started_at = now(), reminded_at = null, election_opened_at = null;
  end if;
  perform set_config('app.gov_apply', '', true);
  perform set_config('app.gov_case', '', true);
  update public.cases set apply_state = 'applied', applied_at = now() where id = p_case;
end $$;

-- Close a case with its verdict, then apply it now or mark it waiting (next trip / next round).
create or replace function private.case_finish(p_case uuid, p_outcome text, p_reason text, p_decider uuid, p_verdict text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.cases; v uuid[]; f int; a int; ab int; v_trip uuid; v_name text; v_word text; v_line text; v_timed boolean;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or c.status <> 'open' then return; end if;
  v := private.case_voters(p_case);
  select t.n_for, t.n_against, t.n_abstain into f, a, ab from private.case_tally(p_case, v) t;
  v_timed := c.kind in ('new_rule', 'change_rule', 'scrap_rule', 'governance');
  v_trip := case when v_timed and p_outcome = 'passed' then private.gov_trip_in_progress(c.group_id) end;
  update public.cases set status = p_outcome, reason = left(p_reason, 200), decided_by = p_decider, decided_at = now(),
    verdict = coalesce(nullif(btrim(coalesce(p_verdict, '')), ''), verdict,
      case when c.kind = 'ruling' and p_outcome = 'passed' then nullif(btrim(coalesce(c.proposal->>'answer', '')), '') end), votes_for = f, votes_against = a, votes_abstain = ab,
    trip_at_verdict = v_trip,
    apply_state = case when p_outcome <> 'passed' then 'none'
                       when v_timed and v_trip is not null and coalesce(c.settings->>'takes_effect', 'next_trip') <> 'now' then 'waiting_next_trip'
                       else null end
  where id = p_case;
  -- A rule that doesn't pass is rejected (old and new app versions see the same thing).
  if c.kind = 'new_rule' and p_outcome = 'failed' then
    perform set_config('app.gov_apply', 'on', true);
    update public.rules set status = 'rejected', decided_at = now(), decision_note = 'Not passed by the Tribunal ' || f || '–' || a || '.'
    where id = c.rule_id and status = 'proposed';
    perform set_config('app.gov_apply', '', true);
  end if;
  if p_outcome = 'passed' and (select apply_state from public.cases where id = p_case) is null then
    perform private.case_apply(p_case);
  end if;
  select coalesce(nickname, name) into v_name from public.players where id = c.subject_id;
  v_word := case when c.kind = 'other' then case when p_outcome = 'passed' then 'GUILTY' else 'NOT GUILTY' end
                 when c.kind = 'election' then case when p_outcome = 'passed' then 'Elected' else 'Not elected' end
                 else case when p_outcome = 'passed' then 'Passed' else 'Failed' end end;
  v_line := case when c.kind = 'other' then 'The Tribunal finds ' || coalesce(v_name, 'the accused') || ' ' || v_word || ': ' || c.title || '.'
                   || case when p_outcome = 'passed' and c.penalty is not null then ' Penalty: ' || c.penalty || '.' else '' end
                 else 'Verdict: ' || c.title || ' — ' || v_word || ' (' || f || '–' || a || ').' end;
  if not c.hidden then
    perform private.gov_post(c.group_id, v_line, null, p_case);
    perform private.gov_queue(c.group_id, null, 'case_verdict', '⚖️ ' || v_line, null, null);
  end if;
end $$;

-- Look at a case and settle it if its decision rule is met (or its time is up).
create or replace function private.case_evaluate(p_case uuid, p_closed boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cases; r record;
begin
  select * into c from public.cases where id = p_case;
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

-- =================================================================================================== raising
-- The shared part of raising a case (the app and the connector). p_me: the player raising it (null = the assistant
-- with no player). p_organiser: whether that counts as an organiser (the connector does).
create or replace function private.gov_raise(p_group uuid, p_me uuid, p_organiser boolean, p_via text, p_kind text, p_title text,
  p_body text, p_subject uuid, p_rule uuid, p_proposal jsonb, p_penalty text, p_evidence_url text, p_evidence_post uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s jsonb; v_id uuid; r public.rules; v_title text := btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]+', ' ', 'g'));
        p jsonb := coalesce(p_proposal, '{}'::jsonb); v_last_start date; v_comm public.committees; v_subject uuid := p_subject;
        v_rule_id uuid; v_name text; v_stage text; v_kind_label text;
begin
  if p_kind = 'handicap' then raise exception 'Handicap cases go through the Handicap Tribunal (lodge_case)'; end if;
  if p_kind = 'trip_decision' then raise exception 'Trip decisions are made in the trip''s votes'; end if;
  if p_kind not in ('new_rule','change_rule','scrap_rule','ruling','other','election','governance') then raise exception 'Unknown kind of case'; end if;
  if not public.feature_on(p_group, 'tribunal') and p_kind <> 'new_rule' then raise exception 'The Tribunal is switched off for this group'; end if;
  perform private.require_case_feature(p_group, p_kind);
  s := private.gov_settings(p_group, p_kind);
  if s->>'raise_by' = 'organisers' and not p_organiser then raise exception 'Only organisers can raise this kind of case'; end if;
  if length(v_title) not between 3 and 140 then raise exception 'Give the case a title (3–140 characters)'; end if;
  if v_subject is not null and not exists (select 1 from public.players where id = v_subject and group_id = p_group) then raise exception 'No such player'; end if;
  if p_evidence_post is not null and not exists (select 1 from public.posts where id = p_evidence_post and group_id = p_group) then raise exception 'No such post'; end if;
  -- One open case per rule; a failed challenge waits for the next trip.
  if p_kind in ('change_rule', 'scrap_rule', 'ruling') then
    select * into r from public.rules where id = p_rule and group_id = p_group;
    if r.id is null or r.status <> 'active' then raise exception 'Pick a rule that''s in force'; end if;
    if exists (select 1 from public.cases where rule_id = r.id and status = 'open') then raise exception 'This rule already has an open case'; end if;
    select max(start_date) into v_last_start from public.trips where group_id = p_group and start_date <= (now() at time zone 'Australia/Sydney')::date;
    if exists (select 1 from public.cases where rule_id = r.id and status = 'failed' and kind in ('change_rule','scrap_rule','ruling')
               and (decided_at at time zone 'Australia/Sydney')::date >= coalesce(v_last_start, '-infinity'::date)) then
      raise exception 'A challenge to this rule failed — it can be raised again from the next trip';
    end if;
    if p_kind = 'change_rule' and coalesce(btrim(p->>'title'), '') = '' and coalesce(btrim(p->>'detail'), '') = '' and coalesce(btrim(p->>'value'), '') = '' then
      raise exception 'Say what the rule should become';
    end if;
    v_rule_id := r.id;
  elsif p_kind = 'election' then
    select * into v_comm from public.committees where id = nullif(p->>'committee_id', '')::uuid and group_id = p_group;
    if v_comm.id is null then raise exception 'No such committee'; end if;
    if coalesce((p->>'seat_no')::int, 0) not between 1 and v_comm.seats then raise exception 'No such seat'; end if;
    v_subject := nullif(p->>'candidate', '')::uuid;
    if v_subject is null or not exists (select 1 from public.group_members where group_id = p_group and player_id = v_subject and role <> 'guest') then
      raise exception 'Pick a player to stand';
    end if;
    p := jsonb_build_object('committee_id', v_comm.id, 'seat_no', (p->>'seat_no')::int, 'candidate', v_subject);
  elsif p_kind = 'governance' then
    if p ? 'preset' then
      if p->>'preset' not in ('organiser', 'majority', 'club', 'lgc') then raise exception 'Unknown preset'; end if;
      p := jsonb_build_object('preset', p->>'preset');
    else
      if p->>'target_kind' not in ('new_rule','change_rule','scrap_rule','ruling','handicap','other','election','governance') then raise exception 'Which kind of case should change?'; end if;
      if private.gov_settings_problem(p_group, p->>'target_kind', private.gov_settings(p_group, p->>'target_kind') || coalesce(p->'settings', '{}'::jsonb)) is not null then
        raise exception '%', private.gov_settings_problem(p_group, p->>'target_kind', private.gov_settings(p_group, p->>'target_kind') || coalesce(p->'settings', '{}'::jsonb));
      end if;
      p := jsonb_build_object('target_kind', p->>'target_kind', 'settings', coalesce(p->'settings', '{}'::jsonb));
    end if;
  elsif p_kind = 'other' then
    v_rule_id := null;
  end if;
  -- A new rule is a proposed rule in the Rulebook: the rules trigger makes its case. Take that case and fill it in.
  if p_kind = 'new_rule' then
    perform set_config('app.gov_via', p_via, true);
    insert into public.rules (group_id, title, detail, category, applies_to, value, status, proposed_by)
    values (p_group, v_title, nullif(btrim(p->>'detail'), ''), coalesce(nullif(p->>'category', ''), 'other'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p->'applies_to') = 'array' then p->'applies_to' else '["all"]'::jsonb end) x), array['all']),
      nullif(btrim(p->>'value'), ''), 'proposed', p_me)
    returning id into v_rule_id;
    perform set_config('app.gov_via', '', true);
    update public.cases set body = nullif(btrim(coalesce(p_body, '')), ''), evidence_url = p_evidence_url, evidence_post_id = p_evidence_post
    where rule_id = v_rule_id and status = 'open' returning id into v_id;
    if v_id is null then raise exception 'Couldn''t open the case for that rule'; end if;
    return v_id;
  end if;
  v_stage := case when s->>'decides' in ('organiser', 'trip_organiser') then 'organiser' else 'voting' end;
  if s->>'decides' = 'committee' and coalesce(cardinality(array_remove(private.committee_members(p_group, nullif(s->>'committee_id', '')::uuid), v_subject)), 0) = 0 then
    v_stage := 'fallback';   -- nobody on the committee who can hear it: the organisers decide
  end if;
  insert into public.cases (group_id, kind, title, body, subject_id, rule_id, committee_id, proposal, penalty, evidence_url, evidence_post_id,
    raised_by, raised_via, settings, stage, closes_at)
  values (p_group, p_kind, v_title, nullif(btrim(coalesce(p_body, '')), ''), v_subject, v_rule_id, nullif(s->>'committee_id', '')::uuid, p,
    nullif(btrim(coalesce(p_penalty, '')), ''), p_evidence_url, p_evidence_post, p_me, p_via, s, v_stage,
    now() + make_interval(hours => coalesce((s->>'close_hours')::int, 48)))
  returning id into v_id;
  select coalesce(nickname, name) into v_name from public.players where id = v_subject;
  v_kind_label := case p_kind when 'other' then 'Case' when 'ruling' then 'Ruling sought' when 'change_rule' then 'Rule challenged'
    when 'scrap_rule' then 'Scrap a rule' when 'election' then 'Election' else 'Governance change' end;
  perform private.gov_post(p_group, '⚖️ ' || v_kind_label || ': ' || v_title || case when p_kind = 'other' and v_name is not null then ' (The Lads v ' || v_name || ')' else '' end,
    p_me, v_id, p_evidence_url);
  -- Phones: the person it's about (important), the committee hearing it, and everyone else.
  if v_subject is not null then
    perform private.gov_queue(p_group, array[v_subject], 'case_about_you', '⚖️ A case about you: ' || v_title, 'Have your say before the vote closes.', p_me);
  end if;
  if s->>'decides' = 'committee' then
    perform private.gov_queue(p_group, private.committee_members(p_group, nullif(s->>'committee_id', '')::uuid), 'case_committee', '⚖️ For your committee: ' || v_title, null, p_me);
  end if;
  perform private.gov_queue(p_group, (select array_agg(gm.player_id) from public.group_members gm where gm.group_id = p_group and gm.player_id is distinct from v_subject),
    'case_new', '⚖️ ' || v_kind_label || ': ' || v_title, null, p_me);
  return v_id;
end $$;

create or replace function public.raise_case(p_kind text, p_title text, p_body text default null, p_subject uuid default null,
  p_rule uuid default null, p_proposal jsonb default '{}'::jsonb, p_penalty text default null, p_evidence_url text default null,
  p_evidence_post uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_me uuid;
begin
  if v_g is null or not private.is_group_member(v_g) then raise exception 'Join a group first'; end if;
  if private.is_group_guest(v_g) then raise exception 'Guests can''t raise cases'; end if;
  v_me := private.my_player_id(v_g);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  return private.gov_raise(v_g, v_me, private.is_group_organiser(v_g), 'app', p_kind, p_title, p_body, p_subject, p_rule, p_proposal,
    p_penalty, p_evidence_url, p_evidence_post);
end $$;

-- The Claude connector (service role only): an assistant may raise a case for its group. It can never vote, decide or
-- approve — there is no function for that without a signed-in person.
create or replace function public.connector_raise_case(p_group uuid, p_author uuid, p_kind text, p_title text, p_body text default null,
  p_subject uuid default null, p_rule uuid default null, p_proposal jsonb default '{}'::jsonb, p_penalty text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_author is not null and not exists (select 1 from public.players where id = p_author and group_id = p_group) then p_author := null; end if;
  return private.gov_raise(p_group, p_author, true, 'assistant', p_kind, p_title, p_body, p_subject, p_rule, p_proposal, p_penalty, null, null);
end $$;

-- =================================================================================================== the hearing
create or replace function public.vote_case(p_case uuid, p_vote text, p_comment text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  perform private.require_case_feature(c.group_id, c.kind);
  if c.status <> 'open' then raise exception 'This case is closed'; end if;
  if c.stage not in ('voting', 'organiser') then raise exception 'Voting has closed — it''s with the organisers now'; end if;
  if c.stage = 'voting' and c.closes_at is not null and c.closes_at <= now() then
    -- Time's up: settle it as it stands (no new vote). The app shows the verdict.
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

-- An organiser's decision: for an organiser-decided case, a tie with a casting vote, or a committee that fell back.
-- Never on a case about yourself.
create or replace function public.decide_case(p_case uuid, p_outcome text, p_verdict text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
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

-- A passed rule or governance change waiting for the next trip: an organiser may let it start mid-trip, if the group
-- allows it. It then starts from the next round (now, if no round is in play). Recorded on the case.
create or replace function public.approve_mid_trip(p_case uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  if not private.is_group_organiser(c.group_id) then raise exception 'Only an organiser can approve that'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if c.status <> 'passed' or c.apply_state <> 'waiting_next_trip' then raise exception 'Nothing waiting to approve'; end if;
  if coalesce(c.settings->>'takes_effect', 'next_trip') <> 'mid_trip_approval' then raise exception 'This group''s changes wait for the next trip'; end if;
  update public.cases set approved_by = v_me, approved_at = now(), apply_state = 'next_round' where id = p_case;
  if not private.gov_live_round(c.group_id) then
    perform private.case_apply(p_case);
    return 'applied';
  end if;
  return 'next_round';
end $$;

-- The hearing: the person it's about replies; anyone (not guests) discusses, or adds evidence (a photo or a feed post).
create or replace function public.add_case_post(p_case uuid, p_body text, p_photo_url text default null, p_post uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid; v_id uuid; v_kind text;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  perform private.require_case_feature(c.group_id, c.kind);
  if c.status <> 'open' then raise exception 'The hearing is over'; end if;
  if private.is_group_guest(c.group_id) then raise exception 'Guests can watch the hearing but not speak'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if coalesce(btrim(p_body), '') = '' and p_photo_url is null and p_post is null then raise exception 'Say something'; end if;
  if p_post is not null and not exists (select 1 from public.posts where id = p_post and group_id = c.group_id) then raise exception 'No such post'; end if;
  if (select count(*) from public.case_posts where case_id = p_case and player_id = v_me and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Slow down, counsel';
  end if;
  v_kind := case when v_me = c.subject_id then 'reply' when p_photo_url is not null or p_post is not null then 'evidence' else 'comment' end;
  insert into public.case_posts (case_id, group_id, player_id, kind, body, photo_url, post_id)
  values (p_case, c.group_id, v_me, v_kind, nullif(left(btrim(coalesce(p_body, '')), 1000), ''), p_photo_url, p_post) returning id into v_id;
  return v_id;
end $$;

create or replace function public.withdraw_case(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  v_me := private.my_player_id(c.group_id);
  if c.status <> 'open' then raise exception 'This case is closed'; end if;
  if not (private.is_group_organiser(c.group_id) or (v_me is not null and v_me = c.raised_by)) then raise exception 'Only whoever raised it, or an organiser, can withdraw it'; end if;
  update public.cases set status = 'withdrawn', decided_by = v_me, decided_at = now(), apply_state = 'none', reason = 'Withdrawn' where id = p_case;
  if c.kind = 'new_rule' and c.rule_id is not null then
    perform set_config('app.gov_apply', 'on', true);
    update public.rules set status = 'rejected', decided_at = now(), decision_note = 'Withdrawn.' where id = c.rule_id and status = 'proposed';
    perform set_config('app.gov_apply', '', true);
  end if;
end $$;

-- Stage 12's guardrails: an organiser can hide a case; anyone can report one (organisers see reports).
create or replace function public.hide_case(p_case uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_organiser(c.group_id) then raise exception 'Only an organiser can hide a case'; end if;
  update public.cases set hidden = coalesce(p_hidden, true) where id = p_case;
end $$;

create or replace function public.report_case(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_me uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  v_me := private.my_player_id(c.group_id);
  if exists (select 1 from public.case_posts where case_id = p_case and kind = 'report' and player_id is not distinct from v_me) then return; end if;
  insert into public.case_posts (case_id, group_id, player_id, kind, body) values (p_case, c.group_id, v_me, 'report', nullif(left(btrim(coalesce(p_reason, '')), 300), ''));
  perform private.gov_queue(c.group_id, (select array_agg(player_id) from public.group_members where group_id = c.group_id and role = 'organiser'),
    'case_report', '🚩 A case was reported: ' || c.title, 'Have a look, and hide it if it crosses the line.', v_me);
end $$;

-- =================================================================================================== committees
create or replace function public.save_committee(p_id uuid, p_name text, p_kinds text[], p_seats int, p_fill text,
  p_term_trips int default null, p_term_years numeric default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_id uuid := p_id; i int; v_filled int;
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can set up committees'; end if;
  perform private.require_feature(v_g, 'committees');
  if not private.gov_direct_ok(v_g) then raise exception 'Your group decides governance changes by vote — raise a Governance change case'; end if;
  if coalesce(p_seats, 0) < 1 then raise exception 'A committee needs at least one seat'; end if;
  if v_id is null then
    insert into public.committees (group_id, name, kinds, seats, fill, term_trips, term_years)
    values (v_g, btrim(p_name), coalesce(p_kinds, '{}'), p_seats, coalesce(p_fill, 'election'), p_term_trips, p_term_years) returning id into v_id;
  else
    if not exists (select 1 from public.committees where id = v_id and group_id = v_g) then raise exception 'No such committee'; end if;
    select count(*) into v_filled from public.committee_seats where committee_id = v_id and player_id is not null and seat_no > p_seats;
    if v_filled > 0 then raise exception 'Someone holds a seat you''d be removing — replace them first'; end if;
    update public.committees set name = btrim(p_name), kinds = coalesce(p_kinds, '{}'), seats = p_seats, fill = coalesce(p_fill, 'election'),
      term_trips = p_term_trips, term_years = p_term_years where id = v_id;
  end if;
  for i in 1..p_seats loop
    insert into public.committee_seats (group_id, committee_id, seat_no) values (v_g, v_id, i) on conflict (committee_id, seat_no) do nothing;
  end loop;
  return v_id;
end $$;

-- Appointment (committees filled by appointment): an organiser puts someone in a seat, and the term starts.
create or replace function public.appoint_seat(p_committee uuid, p_seat_no int, p_player uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c public.committees;
begin
  select * into v_c from public.committees where id = p_committee;
  if v_c.id is null or not private.is_group_organiser(v_c.group_id) then raise exception 'Only an organiser can appoint'; end if;
  perform private.require_feature(v_c.group_id, 'committees');
  if v_c.fill <> 'appointment' then raise exception 'This committee is elected — raise an election case'; end if;
  if p_seat_no not between 1 and v_c.seats then raise exception 'No such seat'; end if;
  if p_player is not null and not exists (select 1 from public.group_members where group_id = v_c.group_id and player_id = p_player and role <> 'guest') then
    raise exception 'Pick a player in the group';
  end if;
  insert into public.committee_seats (group_id, committee_id, seat_no, player_id, started_at)
  values (v_c.group_id, v_c.id, p_seat_no, p_player, case when p_player is not null then now() end)
  on conflict (committee_id, seat_no) do update set player_id = excluded.player_id, started_at = excluded.started_at, reminded_at = null, election_opened_at = null;
end $$;

-- Has a seat's term ended? Trips started since it was filled, or years, whichever comes first (none = until replaced).
-- Same as termStatus() in src/lib/governance.js.
create or replace function private.seat_term_ended(p_seat uuid, out ended boolean, out soon boolean)
language plpgsql stable security definer set search_path = '' as $$
declare s public.committee_seats; c public.committees; v_trips int; v_end timestamptz; v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  select * into s from public.committee_seats where id = p_seat;
  select * into c from public.committees where id = s.committee_id;
  ended := false; soon := false;
  if s.started_at is null or s.player_id is null then return; end if;
  select count(*) into v_trips from public.trips where group_id = s.group_id and start_date > s.started_at::date and start_date <= v_today;
  v_end := case when c.term_years is not null then s.started_at + make_interval(months => round(c.term_years * 12)::int) end;
  ended := (c.term_trips is not null and v_trips >= c.term_trips) or (v_end is not null and now() >= v_end);
  soon := not ended and ((c.term_trips is not null and v_trips = c.term_trips - 1) or (v_end is not null and v_end - now() <= interval '14 days'));
end $$;

-- =================================================================================================== timing
-- Apply passed changes that are due: waiting for the next trip (a new trip has started, or none is under way), or
-- approved for mid-trip (no round in play). p_round: a round that is just going live (its trip counts as started).
create or replace function private.gov_apply_due(p_group uuid, p_round uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare c record; v_trip uuid; v_round_trip uuid; n int := 0;
begin
  if p_round is not null then select trip_id into v_round_trip from public.rounds where id = p_round; end if;
  v_trip := private.gov_trip_in_progress(p_group);
  for c in select id, apply_state, trip_at_verdict from public.cases where group_id = p_group and status = 'passed'
           and apply_state in ('waiting_next_trip', 'next_round') order by decided_at loop
    if c.apply_state = 'next_round' then
      if not private.gov_live_round(p_group, p_round) then perform private.case_apply(c.id); n := n + 1; end if;
    elsif p_round is not null then
      if v_round_trip is distinct from c.trip_at_verdict then perform private.case_apply(c.id); n := n + 1; end if;
    elsif v_trip is null or v_trip is distinct from c.trip_at_verdict then
      perform private.case_apply(c.id); n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Rounds: just before a round goes live, apply what's due; then record the version of every rule it's played under.
-- When a round finishes, approved mid-trip changes can start. This never stops a round starting or finishing.
create or replace function private.gov_round_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from (case when tg_op = 'UPDATE' then old.status end) then return new; end if;
  begin
    if new.status = 'live' then
      perform private.gov_apply_due(new.group_id, new.id);
      insert into public.round_rule_versions (round_id, rule_id, group_id, version)
      select new.id, r.id, r.group_id, coalesce((select max(v.version) from public.rule_versions v where v.rule_id = r.id), 1)
      from public.rules r where r.group_id = new.group_id and r.status = 'active'
      on conflict (round_id, rule_id) do nothing;
    elsif tg_op = 'UPDATE' and old.status = 'live' then
      perform private.gov_apply_due(new.group_id, null);
    end if;
  exception when others then
    raise warning 'governance on round status: %', sqlerrm;
  end;
  return new;
end $$;
create or replace trigger zz_gov_round_status after insert or update of status on public.rounds
  for each row execute function private.gov_round_status();

-- =================================================================================================== the Rulebook
-- Each change to a rule is kept. A new version number when the wording changes; other events (adopted, retired…)
-- keep the version they apply to.
create or replace function private.gov_rule_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ver int; v_event text; v_case uuid := nullif(current_setting('app.gov_case', true), '')::uuid; v_wording boolean;
begin
  begin
    if tg_op = 'INSERT' then
      v_ver := 1;
      v_event := case new.status when 'proposed' then 'proposed' when 'active' then 'added' else new.status end;
      if v_event not in ('proposed','added','rejected','retired') then v_event := 'recorded'; end if;
    else
      v_wording := (new.title, new.detail, new.value, new.category, new.applies_to) is distinct from (old.title, old.detail, old.value, old.category, old.applies_to);
      if not v_wording and new.status is not distinct from old.status then return new; end if;
      select coalesce(max(version), 0) into v_ver from public.rule_versions where rule_id = new.id;
      if v_ver = 0 then v_ver := 1; elsif v_wording and old.status = 'active' then v_ver := v_ver + 1; end if;
      v_event := case
        when new.status is distinct from old.status and new.status = 'active' and old.status = 'proposed' then 'adopted'
        when new.status is distinct from old.status and new.status = 'active' then 'restored'
        when new.status is distinct from old.status and new.status = 'retired' then 'retired'
        when new.status is distinct from old.status and new.status = 'rejected' then 'rejected'
        when new.status = 'proposed' then 'proposed'
        else 'changed' end;
    end if;
    insert into public.rule_versions (group_id, rule_id, version, event, title, detail, value, category, applies_to, status, case_id, changed_by, note)
    values (new.group_id, new.id, v_ver, v_event, new.title, new.detail, new.value, new.category, new.applies_to, new.status,
      coalesce(v_case, (select id from public.cases where rule_id = new.id order by created_at desc limit 1)),
      private.my_player_id(new.group_id), new.decision_note);
  exception when others then
    raise warning 'rule history: %', sqlerrm;   -- never stop a Rulebook change from an old app
  end;
  return new;
end $$;
create or replace trigger zz_gov_rule_history after insert or update on public.rules
  for each row execute function private.gov_rule_history();

-- A proposed rule (from any app version) is a 'new_rule' case. An organiser adopting or rejecting it the old way
-- closes that case. Groups whose decision rule says the players (or a committee) decide can't skip the vote.
create or replace function private.gov_rules_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_server boolean := coalesce(current_setting('app.gov_apply', true), '') = 'on';
        s_new text; s_change text; s_scrap text; v_wording boolean;
begin
  if v_server then return new; end if;
  s_new := private.gov_settings(new.group_id, 'new_rule')->>'decides';
  if tg_op = 'INSERT' then
    if new.status = 'active' and s_new <> 'organiser' and private.feature_on_safe(new.group_id, 'rule_voting')
       and exists (select 1 from public.rules where group_id = new.group_id and status = 'active') then
      raise exception 'Your group votes on new rules — put it up for a vote';
    end if;
    return new;
  end if;
  if old.status = 'proposed' and new.status in ('active', 'rejected') and s_new <> 'organiser' then
    raise exception 'Your group votes on new rules — the Tribunal decides this one';
  end if;
  if old.status = 'active' then
    v_wording := (new.title, new.detail, new.value, new.category, new.applies_to) is distinct from (old.title, old.detail, old.value, old.category, old.applies_to);
    s_change := private.gov_settings(new.group_id, 'change_rule')->>'decides';
    s_scrap := private.gov_settings(new.group_id, 'scrap_rule')->>'decides';
    if v_wording and s_change <> 'organiser' then raise exception 'Your group changes rules by vote — challenge the rule instead'; end if;
    if new.status in ('retired', 'rejected') and s_scrap <> 'organiser' then raise exception 'Your group scraps rules by vote — challenge the rule instead'; end if;
  end if;
  return new;
end $$;
create or replace function private.feature_on_safe(p_group uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$ select public.feature_on(p_group, p_key) $$;
create or replace trigger ab_gov_rules_guard before insert or update on public.rules
  for each row execute function private.gov_rules_guard();

create or replace function private.gov_rules_cases() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s jsonb; v_case uuid; v_f int; v_a int; v_ab int; v_via text := coalesce(nullif(current_setting('app.gov_via', true), ''), 'rulebook');
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'proposed' and not exists (select 1 from public.cases where rule_id = new.id and status = 'open') then
        s := private.gov_settings(new.group_id, 'new_rule');
        insert into public.cases (group_id, kind, title, body, rule_id, proposal, raised_by, raised_via, settings, stage, closes_at)
        values (new.group_id, 'new_rule', left(new.title, 140), left(new.detail, 2000), new.id,
          jsonb_build_object('title', new.title, 'detail', new.detail, 'value', new.value),
          new.proposed_by, v_via, s, case when s->>'decides' = 'organiser' then 'organiser'
            when s->>'decides' = 'committee' and coalesce(cardinality(private.committee_members(new.group_id, nullif(s->>'committee_id', '')::uuid)), 0) = 0 then 'fallback'
            else 'voting' end,
          now() + make_interval(hours => coalesce((s->>'close_hours')::int, 48)));
      end if;
      return new;
    end if;
    -- The old way: an organiser adopted or rejected a proposed rule (allowed by the guard above).
    if coalesce(current_setting('app.gov_apply', true), '') <> 'on' and old.status = 'proposed' and new.status in ('active', 'rejected') then
      select id into v_case from public.cases where rule_id = new.id and status = 'open' and kind = 'new_rule';
      if v_case is not null then
        select count(*) filter (where vote = 'for'), count(*) filter (where vote = 'against'), count(*) filter (where vote = 'abstain')
          into v_f, v_a, v_ab from public.rule_votes where rule_id = new.id;
        update public.cases set status = case when new.status = 'active' then 'passed' else 'failed' end,
          reason = 'Decided by an organiser', decided_by = private.my_player_id(new.group_id), decided_at = now(),
          verdict = new.decision_note, votes_for = v_f, votes_against = v_a, votes_abstain = v_ab,
          apply_state = case when new.status = 'active' then 'applied' else 'none' end,
          applied_at = case when new.status = 'active' then now() end
        where id = v_case;
      end if;
    end if;
  exception when others then
    raise warning 'rule case: %', sqlerrm;   -- never stop a Rulebook change from an old app
  end;
  return new;
end $$;
create or replace trigger zz_gov_rules_cases after insert or update of status on public.rules
  for each row execute function private.gov_rules_cases();

-- A proposed rule deleted from an old app: its open case is withdrawn (the rule link is cleared by the foreign key).
create or replace function private.gov_case_rule_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.rule_id is not null and new.rule_id is null and new.status = 'open' then
    new.status := 'withdrawn'; new.apply_state := 'none'; new.reason := 'The rule was removed'; new.decided_at := now();
  end if;
  return new;
end $$;
create or replace trigger ac_gov_case_rule_gone before update of rule_id on public.cases
  for each row execute function private.gov_case_rule_gone();

-- =================================================================================================== the Handicap Tribunal
-- Same as before (022/027), with two checks that only apply when a group has chosen them:
--  * lodge_case: "organisers only" raising.
--  * cast_vote: a Handicap Committee votes (players who aren't on it can't); an organiser-decided group never
--    auto-closes (the chair closes). Default (L.G.C): exactly as before.
create or replace function public.lodge_case(p_accused uuid, p_change numeric, p_text text, p_exhibit_url text)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_g uuid := private.current_group(); v_me uuid; v_id uuid; v_name text;
begin
  perform private.require_feature(v_g, 'tribunal');
  if private.is_group_guest(v_g) then raise exception 'Guests can''t lodge Tribunal cases'; end if;
  v_me := private.my_player_id(v_g);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if private.gov_settings(v_g, 'handicap')->>'raise_by' = 'organisers' and not private.is_group_organiser(v_g) then
    raise exception 'Only organisers can lodge handicap cases in this group';
  end if;
  if not exists (select 1 from public.players where id = p_accused and group_id = v_g) then raise exception 'No such player'; end if;
  if p_change = 0 then raise exception 'Propose a change'; end if;
  if exists (select 1 from public.tribunal_cases where accused_id = p_accused and status = 'open') then
    raise exception 'There is already an open case against this player';
  end if;
  insert into public.tribunal_cases (group_id, accused_id, lodged_by, proposed_change, case_text, exhibit_url)
  values (v_g, p_accused, v_me, p_change, trim(p_text), p_exhibit_url) returning id into v_id;
  select coalesce(nickname, name) into v_name from public.players where id = p_accused;
  if public.feature_on(v_g, 'feed') then
    insert into public.posts (group_id, kind, body, player_id, link, photo_url)
    values (v_g, 'tribunal', 'Case lodged: The Lads v ' || v_name || ' (proposed ' ||
      case when p_change > 0 then '+' else '' end || trim(to_char(p_change, 'FM990.0')) || ')', v_me,
      '/tribunal/' || v_id, p_exhibit_url);
  end if;
  return v_id;
end $function$;

create or replace function public.cast_vote(p_case uuid, p_vote text, p_comment text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare c public.tribunal_cases%rowtype; v_me uuid; v_eligible int; v_votes int; s jsonb; v_seats uuid[];
begin
  select * into c from public.tribunal_cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  perform private.require_feature(c.group_id, 'tribunal');
  if c.status <> 'open' then raise exception 'This case is closed'; end if;
  if private.is_group_guest(c.group_id) then raise exception 'Guests don''t vote in the Tribunal'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if c.accused_id = v_me then raise exception 'The accused can''t vote on their own case'; end if;
  s := private.gov_settings(c.group_id, 'handicap');
  if s->>'decides' = 'committee' then
    v_seats := array_remove(private.committee_members(c.group_id, nullif(s->>'committee_id', '')::uuid), c.accused_id);
    if cardinality(v_seats) > 0 and not (v_me = any (v_seats)) then raise exception 'Only the Handicap Committee votes on handicap cases'; end if;
  end if;
  insert into public.tribunal_votes (group_id, case_id, voter_id, vote, comment)
  values (c.group_id, p_case, v_me, p_vote, nullif(trim(coalesce(p_comment,'')), ''))
  on conflict (case_id, voter_id) do update set vote = excluded.vote, comment = excluded.comment, created_at = now();
  if s->>'decides' = 'committee' then
    -- The committee decides once all its members (bar the accused) have voted; an empty committee: the chair closes.
    v_eligible := coalesce(cardinality(v_seats), 0);
    select count(*) into v_votes from public.tribunal_votes where case_id = p_case and voter_id = any (v_seats);
  elsif s->>'decides' = 'organiser' then
    v_eligible := 0;   -- the chair closes it
  else
    select count(distinct gm.player_id) into v_eligible from public.group_members gm
      where gm.group_id = c.group_id and gm.player_id is not null and gm.player_id <> c.accused_id and gm.role <> 'guest';
    select count(*) into v_votes from public.tribunal_votes where case_id = p_case;
  end if;
  if v_eligible > 0 and v_votes >= v_eligible then
    perform public.finalise_case(p_case, null, null);
  end if;
end $function$;

-- =================================================================================================== the clock
-- Close cases whose time is up, apply what's due, remind voters the day before close, and open elections for terms
-- that have ended. Hourly for every group, and whenever someone opens the Tribunal.
create or replace function private.governance_tick_group(p_group uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare c record; s record; n int := 0; v_voted uuid[]; v_name text; v_comm public.committees;
begin
  for c in select id from public.cases where group_id = p_group and status = 'open' and stage = 'voting' and closes_at <= now() loop
    perform private.case_evaluate(c.id, true); n := n + 1;
  end loop;
  n := n + private.gov_apply_due(p_group, null);
  -- "Voting closes tomorrow" for anyone who hasn't voted (once per case).
  for c in select * from public.cases where group_id = p_group and status = 'open' and stage = 'voting' and reminded_at is null
           and closes_at > now() and closes_at <= now() + interval '24 hours' loop
    select coalesce(array_agg(player_id), '{}') into v_voted from (
      select player_id from public.case_votes where case_id = c.id
      union select player_id from public.rule_votes where rule_id = c.rule_id and c.kind = 'new_rule') x;
    perform private.gov_queue(p_group, (select array_agg(v) from unnest(private.case_voters(c.id)) v where not (v = any (v_voted))),
      'case_closing', '⏳ Voting closes tomorrow: ' || c.title, 'Have your say in the Tribunal.', null);
    update public.cases set reminded_at = now() where id = c.id;
  end loop;
  -- Terms: a reminder before one ends; when it has ended, the election opens (the holder keeps the seat until replaced).
  if public.feature_on(p_group, 'committees') then
    for s in select cs.*, t.ended, t.soon from public.committee_seats cs cross join lateral private.seat_term_ended(cs.id) t
             where cs.group_id = p_group and cs.player_id is not null loop
      select * into v_comm from public.committees where id = s.committee_id;
      continue when s.seat_no > v_comm.seats;
      select coalesce(nickname, name) into v_name from public.players where id = s.player_id;
      if s.soon and s.reminded_at is null then
        perform private.gov_queue(p_group, array[s.player_id] || (select array_agg(player_id) from public.group_members where group_id = p_group and role = 'organiser'),
          'term_ending', '🪑 ' || v_comm.name || ': ' || coalesce(v_name, 'a') || '''s term is nearly up', 'An election opens when it ends.', null);
        update public.committee_seats set reminded_at = now() where id = s.id;
      elsif s.ended and s.election_opened_at is null and v_comm.fill = 'election' then
        begin
          perform private.gov_raise(p_group, null, true, 'app', 'election',
            v_comm.name || ', seat ' || s.seat_no || ': re-elect ' || coalesce(v_name, 'the holder') || '?',
            'The term is up. Vote to keep them, or raise an election for someone else.', null, null,
            jsonb_build_object('committee_id', v_comm.id, 'seat_no', s.seat_no, 'candidate', s.player_id), null, null, null);
        exception when others then raise warning 'term election: %', sqlerrm;
        end;
        update public.committee_seats set election_opened_at = now() where id = s.id;
      end if;
    end loop;
  end if;
  return n;
end $$;

create or replace function public.governance_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if v_g is null or not private.is_group_member(v_g) then return 0; end if;
  return private.governance_tick_group(v_g);
end $$;

create or replace function private.governance_tick_all() returns int
language plpgsql security definer set search_path = '' as $$
declare g uuid; n int := 0;
begin
  for g in select distinct group_id from public.cases where status = 'open' or apply_state in ('waiting_next_trip', 'next_round')
           union select distinct group_id from public.committee_seats where player_id is not null loop
    begin
      n := n + private.governance_tick_group(g);
    exception when others then raise warning 'governance tick %: %', g, sqlerrm;
    end;
  end loop;
  return n;
end $$;
select cron.schedule('lgc-governance-hourly', '9 * * * *', 'select private.governance_tick_all()');

-- =================================================================================================== start-up data
-- Every rule as it stands now is version 1 (adds history rows only — the rules themselves are untouched).
insert into public.rule_versions (group_id, rule_id, version, event, title, detail, value, category, applies_to, status, changed_by, note, created_at)
select r.group_id, r.id, 1, 'recorded', r.title, r.detail, r.value, r.category, r.applies_to, r.status, r.proposed_by, r.decision_note,
       coalesce(r.decided_at, r.created_at)
from public.rules r
where r.group_id is not null and not exists (select 1 from public.rule_versions v where v.rule_id = r.id);
-- Rules already up for a vote become new-rule cases (today's settings: an organiser decides).
insert into public.cases (group_id, kind, title, body, rule_id, proposal, raised_by, raised_via, settings, stage, closes_at, created_at)
select r.group_id, 'new_rule', left(r.title, 140), left(r.detail, 2000), r.id, jsonb_build_object('title', r.title, 'detail', r.detail, 'value', r.value),
       r.proposed_by, 'rulebook', private.gov_settings(r.group_id, 'new_rule'), 'organiser', now() + interval '48 hours', r.created_at
from public.rules r
where r.status = 'proposed' and r.group_id is not null and length(btrim(r.title)) >= 3
  and not exists (select 1 from public.cases c where c.rule_id = r.id);

-- =================================================================================================== grants
revoke all on function private.gov_preset(text, text), private.gov_settings(uuid, text), private.gov_settings_problem(uuid, text, jsonb),
  private.gov_write(uuid, text, jsonb), private.gov_apply_preset(uuid, text, uuid), private.gov_direct_ok(uuid), private.gov_new_group(),
  private.gov_trip_in_progress(uuid), private.gov_live_round(uuid, uuid), private.committee_members(uuid, uuid),
  private.gov_queue(uuid, uuid[], text, text, text, uuid), private.gov_post(uuid, text, uuid, uuid, text),
  private.case_feature_ok(uuid, text), private.require_case_feature(uuid, text), private.case_voters(uuid),
  private.case_tally(uuid, uuid[]), private.case_state(uuid, boolean), private.case_apply(uuid),
  private.case_finish(uuid, text, text, uuid, text), private.case_evaluate(uuid, boolean),
  private.gov_raise(uuid, uuid, boolean, text, text, text, text, uuid, uuid, jsonb, text, text, uuid),
  private.seat_term_ended(uuid), private.gov_apply_due(uuid, uuid), private.gov_round_status(), private.gov_rule_history(),
  private.gov_rules_guard(), private.feature_on_safe(uuid, text), private.gov_rules_cases(), private.gov_case_rule_gone(),
  private.governance_tick_group(uuid), private.governance_tick_all()
from public, anon, authenticated;

revoke all on function public.raise_case(text, text, text, uuid, uuid, jsonb, text, text, uuid), public.vote_case(uuid, text, text),
  public.decide_case(uuid, text, text), public.approve_mid_trip(uuid), public.add_case_post(uuid, text, text, uuid),
  public.withdraw_case(uuid), public.hide_case(uuid, boolean), public.report_case(uuid, text),
  public.save_committee(uuid, text, text[], int, text, int, numeric), public.appoint_seat(uuid, int, uuid),
  public.governance_tick(), public.apply_governance_preset(text), public.set_governance(text, jsonb), public.set_tribunal_share_cards(boolean)
from public, anon;
grant execute on function public.raise_case(text, text, text, uuid, uuid, jsonb, text, text, uuid), public.vote_case(uuid, text, text),
  public.decide_case(uuid, text, text), public.approve_mid_trip(uuid), public.add_case_post(uuid, text, text, uuid),
  public.withdraw_case(uuid), public.hide_case(uuid, boolean), public.report_case(uuid, text),
  public.save_committee(uuid, text, text[], int, text, int, numeric), public.appoint_seat(uuid, int, uuid),
  public.governance_tick(), public.apply_governance_preset(text), public.set_governance(text, jsonb), public.set_tribunal_share_cards(boolean)
to authenticated;
-- The connector's raise: the service role only (the lgc-mcp function). Nobody else.
revoke all on function public.connector_raise_case(uuid, uuid, text, text, text, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.connector_raise_case(uuid, uuid, text, text, text, uuid, uuid, jsonb, text) to service_role;
-- lodge_case / cast_vote: same grants as before (re-stated; create or replace keeps them).
grant execute on function public.lodge_case(uuid, numeric, text, text), public.cast_vote(uuid, text, text) to authenticated;

alter publication supabase_realtime add table public.cases, public.case_votes, public.case_posts, public.governance_settings,
  public.governance_group, public.committees, public.committee_seats, public.rule_versions;
select private.add_same_group_checks();
