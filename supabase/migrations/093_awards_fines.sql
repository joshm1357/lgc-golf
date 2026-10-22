-- 093 — Awards and fines: proposed before the trip, rewards and proof, fined from the Feed (Josh, 23 Oct 2026).
-- ADDITIVE ONLY: new nullable columns, three new tables, new functions and triggers, one cron job, and one function
-- replaced with a longer list (dispute_fields: everything allowed before is still allowed). Nothing is dropped or
-- renamed, so older app versions keep working: an award or fine proposed here is an ordinary Rulebook rule to them
-- ("Wrong-ball fine", Fines, "$5"), and a trip's award from the Rulebook is an ordinary dinner award.
--
-- In plain words:
--   * Anyone in the group (not guests) proposes an award or a fine. It's a Rulebook rule (category 'fines', marked
--     with award_kind = award | fine) and goes through the group's normal decision rule for new rules — the organiser
--     decides for L.G.C, or a vote where the group has set one. It can be for every trip or just one (for_trip).
--   * Each one says what it's worth (reward_type + reward_amount + reward_note): strokes (± in the next round),
--     points, money, a drink / round, a title, bragging rights, or anything else in words. The rule's "worth" line
--     (rules.value) is written by the server from these, so a dispute about the amount is a dispute about the value,
--     like any rule.
--   * Each one says what proof a claim needs (proof): none, a photo, a time, a number, photo + time, photo + number.
--     "best" says the best claim wins on its own value (latest / earliest time, highest / lowest number) — the app
--     ranks the claims and the vote confirms.
--   * Members give an opinion on a fine's size ("Too much / About right / Too little" + a comment): rule_opinions.
--   * On a trip, an award from the Rulebook gets its trip copy (a dinner_awards row with rule_id) the first time it's
--     needed (award_for_trip). Nominations ("claims") carry the proof: a photo or a feed post (post_id, already there
--     from 064), a time (claim_at), a number (claim_number). The database checks the proof is there.
--   * When the organiser closes the voting, settle_dinner_award picks the winner (most votes; with no votes, the best
--     claim; a tie waits for the organiser to pick), posts the result to the Feed ("🏆 Latest out — Hamish, 2:47am 📷
--     · −1 stroke next round") and, for strokes, queues them for the winner's next round (award_strokes). They're
--     added when that round goes live, labelled "Latest out (−1)". An organiser can waive them.
--   * A week before a trip, everyone (not guests) is asked "Any awards or fines to add before the trip?" and the
--     organisers are told how many proposals are waiting. Once per trip.
--   * The person fined can appeal: a dispute (raise_dispute, 082) about the nomination ("who's fined").
--   * Every group gets a standard Rulebook rule "Leftover kitty" (like 085's late job rule): what happens to money left
--     in the kitty at the end of a trip — on the bar the last night (to start), split back to everyone, rolls over to
--     the next trip, goes to the trophy winner, or something else in words (rules.leftover / leftover_note). Organisers
--     change it through the normal rule editing (the group's decision rule applies); anyone can give an opinion on it
--     or dispute it. Words only — no money moves in the app.
--
-- Why a separate award_strokes table and not score_adjustments (085): score_adjustments.kind only allows 'late_job'
-- and widening that check means dropping it, which needs Josh. The app adds both tables' rows the same way.
--
-- Feature switches: dinner_awards (all of it; reads stay allowed), rule_voting (proposing, as for any rule),
-- tribunal + rule_challenges (appeals and disputes, as 082), feed (the result post), notifications (the reminder).

-- ============================================================================================ rules: awards and fines
alter table public.rules add column if not exists award_kind text check (award_kind is null or award_kind in ('award', 'fine'));
alter table public.rules add column if not exists reward_type text
  check (reward_type is null or reward_type in ('strokes', 'points', 'money', 'drink', 'title', 'bragging', 'other'));
alter table public.rules add column if not exists reward_amount numeric check (reward_amount is null or (reward_amount between -1000 and 1000));
alter table public.rules add column if not exists reward_note text check (reward_note is null or length(reward_note) <= 80);
alter table public.rules add column if not exists proof text
  check (proof is null or proof in ('none', 'photo', 'time', 'number', 'photo_time', 'photo_number'));
alter table public.rules add column if not exists best text check (best is null or best in ('latest', 'earliest', 'highest', 'lowest'));
alter table public.rules add column if not exists number_unit text check (number_unit is null or length(number_unit) <= 12);
alter table public.rules add column if not exists for_trip uuid references public.trips(id) on delete cascade;
create index if not exists rules_for_trip_idx on public.rules (for_trip);
create index if not exists rules_award_kind_idx on public.rules (group_id) where award_kind is not null;

-- The same columns on a trip's own awards (added on the dinner awards screen, not from the Rulebook), plus the link
-- to the Rulebook rule and the result.
alter table public.dinner_awards add column if not exists rule_id uuid references public.rules(id) on delete set null;
alter table public.dinner_awards add column if not exists reward_type text
  check (reward_type is null or reward_type in ('strokes', 'points', 'money', 'drink', 'title', 'bragging', 'other'));
alter table public.dinner_awards add column if not exists reward_amount numeric check (reward_amount is null or (reward_amount between -1000 and 1000));
alter table public.dinner_awards add column if not exists reward_note text check (reward_note is null or length(reward_note) <= 80);
alter table public.dinner_awards add column if not exists proof text
  check (proof is null or proof in ('none', 'photo', 'time', 'number', 'photo_time', 'photo_number'));
alter table public.dinner_awards add column if not exists best text check (best is null or best in ('latest', 'earliest', 'highest', 'lowest'));
alter table public.dinner_awards add column if not exists number_unit text check (number_unit is null or length(number_unit) <= 12);
alter table public.dinner_awards add column if not exists winner_id uuid references public.players(id) on delete set null;
alter table public.dinner_awards add column if not exists settled_at timestamptz;
create unique index if not exists dinner_awards_rule_once on public.dinner_awards (trip_id, rule_id) where rule_id is not null;
create index if not exists dinner_awards_rule_idx on public.dinner_awards (rule_id);
create index if not exists dinner_awards_winner_idx on public.dinner_awards (winner_id);

-- A claim's proof.
alter table public.dinner_award_nominations add column if not exists claim_at timestamptz;
alter table public.dinner_award_nominations add column if not exists claim_number numeric
  check (claim_number is null or (claim_number between -100000 and 100000));

-- ============================================================================================ the words
-- What it's worth, in words. Same as rewardWords() in src/lib/awardsfines.js (a unit test checks the examples).
--   strokes −1 → "−1 stroke"   +2 → "+2 strokes"   points 3 → "+3 points"   money 5 → "$5"
--   drink → note or "Buys a round"   title → note or "The title"   bragging → "Bragging rights"   other → note
-- A note is added after a number: "$5 · into the kitty".
create or replace function private.award_value(p_type text, p_amount numeric, p_note text) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(case p_type
    when 'strokes' then case when coalesce(p_amount, 0) < 0 then '−' else '+' end || trim_scale(abs(coalesce(p_amount, 0)))::text
                        || ' stroke' || case when abs(coalesce(p_amount, 0)) = 1 then '' else 's' end
                        || coalesce(' · ' || nullif(btrim(p_note), ''), '')
    when 'points' then case when coalesce(p_amount, 0) < 0 then '−' else '+' end || trim_scale(abs(coalesce(p_amount, 0)))::text
                        || ' point' || case when abs(coalesce(p_amount, 0)) = 1 then '' else 's' end
                        || coalesce(' · ' || nullif(btrim(p_note), ''), '')
    when 'money' then '$' || trim_scale(abs(coalesce(p_amount, 0)))::text || coalesce(' · ' || nullif(btrim(p_note), ''), '')
    when 'drink' then coalesce(nullif(btrim(p_note), ''), 'Buys a round')
    when 'title' then coalesce(nullif(btrim(p_note), ''), 'The title')
    when 'bragging' then 'Bragging rights'
    else coalesce(nullif(btrim(p_note), ''), '') end, 120), '')
$$;
revoke all on function private.award_value(text, numeric, text) from public, anon, authenticated;

-- Tidy and check an award's terms (shared by rules and dinner_awards). Raises on a problem.
create or replace function private.award_terms_check(p_type text, p_amount numeric, p_note text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_type is null then return; end if;
  if p_type = 'strokes' and (p_amount is null or p_amount <> trunc(p_amount) or p_amount = 0 or p_amount < -10 or p_amount > 10) then
    raise exception 'Strokes: a whole number from −10 to 10 (not 0)';
  end if;
  if p_type = 'points' and (p_amount is null or p_amount = 0 or p_amount < -50 or p_amount > 50) then
    raise exception 'Points: a number from −50 to 50 (not 0)';
  end if;
  if p_type = 'money' and (p_amount is null or p_amount <= 0 or p_amount > 1000 or p_amount * 100 <> trunc(p_amount * 100)) then
    raise exception 'Money: dollars and cents, up to $1000';
  end if;
  if p_type = 'other' and length(btrim(coalesce(p_note, ''))) < 2 then raise exception 'Say what it''s worth'; end if;
  if private.dinner_award_blocked(p_note) then
    raise exception 'Keep it friendly — roast the golf and the mates, never who someone is or anything tragic';
  end if;
end $$;
revoke all on function private.award_terms_check(text, numeric, text) from public, anon, authenticated;

-- Rules: an award or fine is in the 'fines' part of the Rulebook, its worth line follows its terms, and a "just this
-- trip" one is for one of the group's own trips. Runs before the governance guard (ab_), so a change to the terms is a
-- change to the rule's value: the group's decision rule applies and a new version is recorded.
create or replace function private.rules_award() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.award_kind is null then
    new.reward_type := null; new.reward_amount := null; new.reward_note := null; new.proof := null; new.best := null;
    new.number_unit := null; new.for_trip := null;
    return new;
  end if;
  new.category := 'fines';
  new.reward_note := nullif(btrim(coalesce(new.reward_note, '')), '');
  new.number_unit := nullif(btrim(coalesce(new.number_unit, '')), '');
  if new.reward_type not in ('strokes', 'points', 'money') then new.reward_amount := null; end if;
  if tg_op = 'INSERT' or (new.reward_type, new.reward_amount, new.reward_note) is distinct from (old.reward_type, old.reward_amount, old.reward_note) then
    perform private.award_terms_check(new.reward_type, new.reward_amount, new.reward_note);
  end if;
  if new.best in ('latest', 'earliest') and coalesce(new.proof, 'none') not in ('time', 'photo_time') then new.best := null; end if;
  if new.best in ('highest', 'lowest') and coalesce(new.proof, 'none') not in ('number', 'photo_number') then new.best := null; end if;
  if new.for_trip is not null and (tg_op = 'INSERT' or new.for_trip is distinct from old.for_trip)
     and not exists (select 1 from public.trips where id = new.for_trip and group_id = new.group_id) then
    raise exception 'That trip isn''t one of this group''s';
  end if;
  if new.reward_type is not null then new.value := private.award_value(new.reward_type, new.reward_amount, new.reward_note); end if;
  return new;
end $$;
revoke all on function private.rules_award() from public, anon, authenticated;
create or replace trigger aa_rules_award before insert or update on public.rules
  for each row execute function private.rules_award();

-- Proposing an award or fine needs fines and dinner awards switched on (proposing at all needs rule_voting, as before).
create policy "feature on: dinner_awards (award rules)" on public.rules as restrictive for insert
  with check (award_kind is null or public.feature_on(group_id, 'dinner_awards'));

-- ============================================================================================ a trip's awards
-- What an award on a trip is worth and needs: its Rulebook rule's terms when it came from one, else its own.
create or replace function private.award_terms(p_award uuid)
returns table (award_id uuid, group_id uuid, trip_id uuid, kind text, title text, reward_type text, reward_amount numeric,
               reward_note text, proof text, best text, number_unit text, rule_id uuid)
language sql stable security definer set search_path = '' as $$
  select a.id, a.group_id, a.trip_id, a.kind, a.title,
         case when r.id is null then a.reward_type else r.reward_type end,
         case when r.id is null then a.reward_amount else r.reward_amount end,
         case when r.id is null then a.reward_note else r.reward_note end,
         case when r.id is null then a.proof else r.proof end,
         case when r.id is null then a.best else r.best end,
         case when r.id is null then a.number_unit else r.number_unit end,
         r.id
  from public.dinner_awards a
  left join public.rules r on r.id = a.rule_id and r.group_id = a.group_id
  where a.id = p_award
$$;
revoke all on function private.award_terms(uuid) from public, anon, authenticated;

-- dinner_awards: the Rulebook link is checked and never moves; the result is the server's; a trip's own award's terms
-- are checked like a rule's. (Runs after 064's ac_ check, so title and penalty are already tidied.)
create or replace function private.dinner_awards_terms() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_server boolean := coalesce(current_setting('app.award_settle', true), '') = 'on'; r public.rules;
begin
  if tg_op = 'UPDATE' then
    new.rule_id := old.rule_id;
    if not v_server then new.winner_id := old.winner_id; new.settled_at := old.settled_at; end if;
  else
    if not v_server then new.winner_id := null; new.settled_at := null; end if;
    if new.rule_id is not null then
      select * into r from public.rules where id = new.rule_id;
      if r.id is null or r.group_id <> new.group_id or r.award_kind is null or r.status <> 'active'
         or (r.for_trip is not null and r.for_trip <> new.trip_id) then
        raise exception 'That award isn''t in the Rulebook for this trip';
      end if;
    end if;
  end if;
  new.reward_note := nullif(btrim(coalesce(new.reward_note, '')), '');
  new.number_unit := nullif(btrim(coalesce(new.number_unit, '')), '');
  if new.reward_type not in ('strokes', 'points', 'money') then new.reward_amount := null; end if;
  if tg_op = 'INSERT' or (new.reward_type, new.reward_amount, new.reward_note) is distinct from (old.reward_type, old.reward_amount, old.reward_note) then
    perform private.award_terms_check(new.reward_type, new.reward_amount, new.reward_note);
  end if;
  -- An older app shows a fine's "penalty" words: keep them in step with the terms.
  if new.kind = 'fine' and new.reward_type is not null and new.penalty is null then
    new.penalty := left(private.award_value(new.reward_type, new.reward_amount, new.reward_note), 80);
  end if;
  return new;
end $$;
revoke all on function private.dinner_awards_terms() from public, anon, authenticated;
create or replace trigger ad_dinner_awards_terms before insert or update on public.dinner_awards
  for each row execute function private.dinner_awards_terms();

-- A Rulebook award's copy on a trip, made the first time it's needed. Returns its id.
create or replace function public.award_for_trip(p_trip uuid, p_rule uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_g uuid; r public.rules; v_id uuid;
begin
  select group_id into v_g from public.trips where id = p_trip;
  if v_g is null or not (v_g = any (private.my_group_ids())) then raise exception 'Trip not found'; end if;
  if private.is_group_guest(v_g) then raise exception 'Guests can''t fine or nominate'; end if;
  perform private.require_feature(v_g, 'dinner_awards');
  select * into r from public.rules where id = p_rule and group_id = v_g;
  if r.id is null or r.award_kind is null or r.status <> 'active' or (r.for_trip is not null and r.for_trip <> p_trip) then
    raise exception 'That award isn''t in the Rulebook for this trip';
  end if;
  select id into v_id from public.dinner_awards where trip_id = p_trip and rule_id = p_rule;
  if v_id is not null then return v_id; end if;
  insert into public.dinner_awards (group_id, trip_id, title, kind, penalty, rule_id, created_by, sort)
  values (v_g, p_trip, left(r.title, 60), r.award_kind, case when r.award_kind = 'fine' then left(r.value, 80) end, r.id,
          private.my_player_id(v_g), coalesce(r.sort, 0))
  on conflict (trip_id, rule_id) where rule_id is not null do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.dinner_awards where trip_id = p_trip and rule_id = p_rule; end if;
  return v_id;
end $$;
revoke all on function public.award_for_trip(uuid, uuid) from public, anon;
grant execute on function public.award_for_trip(uuid, uuid) to authenticated;
revoke execute on function public.award_for_trip(uuid, uuid) from service_role;

-- ============================================================================================ claims and their proof
-- A nomination's feed post must be this group's; the proof the award asks for must be there. A post's photo counts as
-- the photo (and is copied onto the nomination, so older apps show it too).
create or replace function private.dinner_award_nominations_proof() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t record; v_photo text;
begin
  if new.post_id is not null and (tg_op = 'INSERT' or new.post_id is distinct from old.post_id) then
    select p.photo_url into v_photo from public.posts p where p.id = new.post_id and p.group_id = new.group_id;
    if not found then raise exception 'That post isn''t one of this group''s'; end if;
    if new.photo_url is null and v_photo ~ '^https://' and length(v_photo) <= 400 then new.photo_url := v_photo; end if;
  end if;
  if new.claim_at is not null and new.claim_at > now() + interval '1 day' then raise exception 'That time is in the future'; end if;
  if tg_op = 'UPDATE' and (new.photo_url, new.post_id, new.claim_at, new.claim_number)
       is not distinct from (old.photo_url, old.post_id, old.claim_at, old.claim_number) then
    return new;
  end if;
  select * into t from private.award_terms(new.award_id);
  if t.proof in ('photo', 'photo_time', 'photo_number') and new.photo_url is null then
    raise exception 'This one needs a photo';
  end if;
  if t.proof in ('time', 'photo_time') and new.claim_at is null then raise exception 'This one needs a time'; end if;
  if t.proof in ('number', 'photo_number') and new.claim_number is null then
    raise exception 'This one needs a number%', coalesce(' (' || t.number_unit || ')', '');
  end if;
  return new;
end $$;
revoke all on function private.dinner_award_nominations_proof() from public, anon, authenticated;
create or replace trigger ad_dinner_award_nominations_proof before insert or update on public.dinner_award_nominations
  for each row execute function private.dinner_award_nominations_proof();

-- ============================================================================================ opinions on a fine's size
create table if not exists public.rule_opinions (
  rule_id uuid not null references public.rules(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  opinion text not null check (opinion in ('too_much', 'about_right', 'too_little')),
  comment text check (comment is null or length(comment) <= 140),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (rule_id, player_id)
);
create index if not exists rule_opinions_group_idx on public.rule_opinions (group_id);
create index if not exists rule_opinions_player_idx on public.rule_opinions (player_id);

-- Awards, fines and the standard "Leftover kitty" rule (below).
create or replace function private.rule_opinions_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.rules;
begin
  if tg_op = 'UPDATE' then
    new.rule_id := old.rule_id; new.player_id := old.player_id; new.created_at := old.created_at;
  end if;
  select * into r from public.rules where id = new.rule_id;
  if r.id is null or (r.award_kind is null and r.system_key is distinct from 'leftover_kitty') or r.status not in ('proposed', 'active') then
    raise exception 'Opinions are for awards, fines and the leftover kitty';
  end if;
  new.comment := nullif(btrim(coalesce(new.comment, '')), '');
  if private.dinner_award_blocked(new.comment) then
    raise exception 'Keep it friendly — roast the golf and the mates, never who someone is or anything tragic';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.rule_opinions_check() from public, anon, authenticated;

alter table public.rule_opinions enable row level security;
create policy "members read" on public.rule_opinions for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "your own opinion" on public.rule_opinions for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[]) and player_id = private.my_player_id(group_id));
create policy "change your opinion" on public.rule_opinions for update
  using (player_id = private.my_player_id(group_id)) with check (player_id = private.my_player_id(group_id));
create policy "take back your opinion" on public.rule_opinions for delete
  using (player_id = private.my_player_id(group_id));
create policy "same group only" on public.rule_opinions as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "no guests (add)" on public.rule_opinions as restrictive for insert with check (not private.is_group_guest(group_id));
create policy "no guests (change)" on public.rule_opinions as restrictive for update
  using (not private.is_group_guest(group_id)) with check (not private.is_group_guest(group_id));
-- Awards and fines need dinner awards switched on; the leftover kitty rule doesn't.
create or replace function private.rule_opinion_feature_ok(p_group uuid, p_rule uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.feature_on(p_group, 'dinner_awards')
      or exists (select 1 from public.rules r where r.id = p_rule and r.system_key = 'leftover_kitty')
$$;
revoke all on function private.rule_opinion_feature_ok(uuid, uuid) from public, anon;
grant execute on function private.rule_opinion_feature_ok(uuid, uuid) to authenticated;
create policy "feature on (add)" on public.rule_opinions as restrictive for insert
  with check (private.rule_opinion_feature_ok(group_id, rule_id));
create policy "feature on (change)" on public.rule_opinions as restrictive for update
  using (private.rule_opinion_feature_ok(group_id, rule_id)) with check (private.rule_opinion_feature_ok(group_id, rule_id));
create policy "feature on (remove)" on public.rule_opinions as restrictive for delete
  using (private.rule_opinion_feature_ok(group_id, rule_id));
revoke all on public.rule_opinions from anon;
grant select, insert, update, delete on public.rule_opinions to authenticated;
create or replace trigger aa_fill_group_id before insert or update on public.rule_opinions
  for each row execute function private.fill_group_id('rules:rule_id');
create or replace trigger ac_rule_opinions_check before insert or update on public.rule_opinions
  for each row execute function private.rule_opinions_check();

-- ============================================================================================ strokes won or copped
-- One row per decided award worth strokes: waiting (round_id null) until the winner's next round goes live, then on
-- that round. Server writes only; members read. The leaderboard adds them like score_adjustments.
create table if not exists public.award_strokes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  award_id uuid not null references public.dinner_awards(id) on delete cascade,
  rule_id uuid references public.rules(id) on delete set null,
  player_id uuid not null references public.players(id) on delete cascade,
  strokes int not null check (strokes between -10 and 10 and strokes <> 0),
  label text not null check (length(label) between 2 and 160),
  round_id uuid references public.rounds(id) on delete set null,
  applied_at timestamptz,
  waived_at timestamptz,
  waived_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (award_id)
);
create index if not exists award_strokes_group_idx on public.award_strokes (group_id);
create index if not exists award_strokes_round_idx on public.award_strokes (round_id);
create index if not exists award_strokes_player_idx on public.award_strokes (player_id);
create index if not exists award_strokes_rule_idx on public.award_strokes (rule_id);
create index if not exists award_strokes_waived_by_idx on public.award_strokes (waived_by);
create index if not exists award_strokes_waiting_idx on public.award_strokes (group_id) where round_id is null and waived_at is null;
alter table public.award_strokes enable row level security;
create policy "members read" on public.award_strokes for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "same group only" on public.award_strokes as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.award_strokes from anon, authenticated;
grant select on public.award_strokes to authenticated;
create or replace trigger aa_fill_group_id before insert or update on public.award_strokes
  for each row execute function private.fill_group_id('dinner_awards:award_id');

-- When a round goes live: each waiting award's strokes go on it for a winner who plays in it.
create or replace function private.apply_award_strokes(p_round uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare rd public.rounds; n int;
begin
  select * into rd from public.rounds where id = p_round;
  if rd.id is null then return 0; end if;
  update public.award_strokes s set round_id = rd.id, applied_at = now()
  where s.group_id = rd.group_id and s.round_id is null and s.waived_at is null
    and private.plays_in_round(rd.id, s.player_id)
    and public.feature_on(rd.group_id, 'dinner_awards');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.apply_award_strokes(uuid) from public, anon, authenticated;

create or replace function private.rounds_award_strokes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    begin
      perform private.apply_award_strokes(new.id);
    exception when others then
      raise warning 'award strokes: %', sqlerrm;   -- never stop a round starting
    end;
  end if;
  return null;
end $$;
revoke all on function private.rounds_award_strokes() from public, anon, authenticated;
create or replace trigger zz_award_strokes after insert or update of status on public.rounds
  for each row execute function private.rounds_award_strokes();

-- An organiser waives an award's strokes (before or after they're on a round).
create or replace function public.waive_award_strokes(p_award uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_g uuid;
begin
  select group_id into v_g from public.award_strokes where award_id = p_award;
  if v_g is null or not (v_g = any (private.my_group_ids())) then raise exception 'Nothing to waive'; end if;
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can waive strokes'; end if;
  update public.award_strokes set waived_at = now(), waived_by = private.my_player_id(v_g)
  where award_id = p_award and waived_at is null;
end $$;
revoke all on function public.waive_award_strokes(uuid) from public, anon;
grant execute on function public.waive_award_strokes(uuid) to authenticated;
revoke execute on function public.waive_award_strokes(uuid) from service_role;

-- ============================================================================================ deciding one
-- "2:47am" in Sydney.
create or replace function private.award_time_words(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select lower(to_char(p_at at time zone 'Australia/Sydney', 'FMHH12:MIam'))
$$;
revoke all on function private.award_time_words(timestamptz) from public, anon, authenticated;

-- After the organiser closes the voting: who won, the Feed post and any strokes. Most votes wins; with no votes, the
-- best claim (an award decided on its value); a tie (or nothing to go on) waits for the organiser to pick (p_player,
-- who must be nominated). Once only. Returns { status: settled | tie | none | already, player, strokes, post }.
create or replace function public.settle_dinner_award(p_award uuid, p_player uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.dinner_awards; t record; v_win uuid; v_top int; v_tied uuid[]; n public.dinner_award_nominations;
        v_name text; v_body text; v_worth text; v_strokes int; v_me uuid;
begin
  select * into a from public.dinner_awards where id = p_award for update;
  if a.id is null or not (a.group_id = any (private.my_group_ids())) then raise exception 'Award not found'; end if;
  if not private.is_group_organiser(a.group_id) then raise exception 'Only an organiser can decide it'; end if;
  perform private.require_feature(a.group_id, 'dinner_awards');
  if a.status <> 'closed' then raise exception 'Close the voting first'; end if;
  if a.settled_at is not null then return jsonb_build_object('status', 'already', 'player', a.winner_id); end if;
  select * into t from private.award_terms(a.id);
  v_me := private.my_player_id(a.group_id);

  if p_player is not null then
    if not exists (select 1 from public.dinner_award_nominations where award_id = a.id and player_id = p_player) then
      raise exception 'Pick someone who was nominated';
    end if;
    v_win := p_player;
  else
    -- Most votes.
    select max(c) into v_top from (select count(*) c from public.dinner_award_votes where award_id = a.id group by nomination_id) x;
    if coalesce(v_top, 0) > 0 then
      select array_agg(nm.player_id) into v_tied from public.dinner_award_nominations nm
      where nm.award_id = a.id and (select count(*) from public.dinner_award_votes v where v.nomination_id = nm.id) = v_top;
    elsif t.best is not null then
      -- No votes: the best claim.
      select array_agg(player_id) into v_tied from public.dinner_award_nominations nm
      where nm.award_id = a.id and case t.best
        when 'latest' then nm.claim_at = (select max(claim_at) from public.dinner_award_nominations where award_id = a.id)
        when 'earliest' then nm.claim_at = (select min(claim_at) from public.dinner_award_nominations where award_id = a.id)
        when 'highest' then nm.claim_number = (select max(claim_number) from public.dinner_award_nominations where award_id = a.id)
        else nm.claim_number = (select min(claim_number) from public.dinner_award_nominations where award_id = a.id) end;
    end if;
    if coalesce(cardinality(v_tied), 0) = 0 then
      if not exists (select 1 from public.dinner_award_nominations where award_id = a.id) then
        return jsonb_build_object('status', 'none');
      end if;
      return jsonb_build_object('status', 'tie', 'players', (select jsonb_agg(player_id) from public.dinner_award_nominations where award_id = a.id));
    end if;
    if cardinality(v_tied) > 1 then return jsonb_build_object('status', 'tie', 'players', to_jsonb(v_tied)); end if;
    v_win := v_tied[1];
  end if;

  select * into n from public.dinner_award_nominations where award_id = a.id and player_id = v_win;
  select coalesce(nullif(btrim(nickname), ''), name) into v_name from public.players where id = v_win;
  v_worth := private.award_value(t.reward_type, t.reward_amount, t.reward_note);
  if v_worth is null and a.kind = 'fine' then v_worth := a.penalty; end if;
  v_strokes := case when t.reward_type = 'strokes' then t.reward_amount::int end;
  v_body := case when a.kind = 'fine' then '🍺 ' else '🏆 ' end || a.title || ' — ' || coalesce(v_name, 'Someone')
    || case when n.claim_at is not null then ', ' || private.award_time_words(n.claim_at) else '' end
    || case when n.claim_number is not null then ', ' || trim_scale(n.claim_number)::text || coalesce(' ' || t.number_unit, '') else '' end
    || case when n.photo_url is not null or n.post_id is not null then ' 📷' else '' end
    || case when v_worth is not null then ' · ' || v_worth || case when v_strokes is not null then ' next round' else '' end else '' end;

  perform set_config('app.award_settle', 'on', true);
  update public.dinner_awards set winner_id = v_win, settled_at = now() where id = a.id;
  perform set_config('app.award_settle', '', true);

  if v_strokes is not null and v_strokes <> 0 then
    insert into public.award_strokes (group_id, award_id, rule_id, player_id, strokes, label)
    values (a.group_id, a.id, t.rule_id, v_win, v_strokes,
            left(a.title, 140) || ' (' || case when v_strokes < 0 then '−' else '+' end || abs(v_strokes) || ')')
    on conflict (award_id) do nothing;
  end if;
  if public.feature_on(a.group_id, 'feed') then
    insert into public.posts (group_id, trip_id, kind, body, player_id, link, photo_url)
    values (a.group_id, a.trip_id, 'auto', left(v_body, 500), v_win, '/dinner/' || a.trip_id, n.photo_url);
  end if;
  return jsonb_build_object('status', 'settled', 'player', v_win, 'strokes', v_strokes, 'post', v_body);
end $$;
revoke all on function public.settle_dinner_award(uuid, uuid) from public, anon;
grant execute on function public.settle_dinner_award(uuid, uuid) to authenticated;
revoke execute on function public.settle_dinner_award(uuid, uuid) from service_role;

-- ============================================================================================ the run-up reminder
create table if not exists public.award_reminders (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  sent_at timestamptz not null default now(),
  waiting int not null default 0
);
create index if not exists award_reminders_group_idx on public.award_reminders (group_id);
alter table public.award_reminders enable row level security;
create policy "members read" on public.award_reminders for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "same group only" on public.award_reminders as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.award_reminders from anon, authenticated;
grant select on public.award_reminders to authenticated;

-- Proposed awards and fines waiting for a decision that would be on this trip.
create or replace function private.award_proposals_waiting(p_group uuid, p_trip uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.rules
  where group_id = p_group and award_kind is not null and status = 'proposed' and (for_trip is null or for_trip = p_trip)
$$;
revoke all on function private.award_proposals_waiting(uuid, uuid) from public, anon, authenticated;

-- Once a day: a trip starting in the next 7 days (and not yet reminded) — everyone but guests gets "Any awards or
-- fines to add before the trip?", and the organisers "N proposals waiting" when there are some. Once per trip.
create or replace function private.awards_runup_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; v_wait int; v_players uuid[]; v_orgs uuid[]; n int := 0;
        v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  for r in
    select t.id, t.group_id, t.name, coalesce(t.start_date, (select min(p.start_date) from public.plans p where p.trip_id = t.id)) as starts
    from public.trips t
    where not exists (select 1 from public.award_reminders ar where ar.trip_id = t.id)
      and public.feature_on(t.group_id, 'dinner_awards')
      and not exists (select 1 from public.plans p where p.trip_id = t.id and p.status = 'cancelled')
  loop
    if r.starts is null or r.starts - v_today not between 1 and 7 then continue; end if;
    v_wait := private.award_proposals_waiting(r.group_id, r.id);
    insert into public.award_reminders (trip_id, group_id, waiting) values (r.id, r.group_id, v_wait) on conflict (trip_id) do nothing;
    if not found then continue; end if;
    select array_agg(player_id) filter (where role <> 'guest'), array_agg(player_id) filter (where role = 'organiser')
      into v_players, v_orgs from public.group_members where group_id = r.group_id and player_id is not null;
    if coalesce(cardinality(v_players), 0) > 0 then
      perform private.gov_queue(r.group_id, v_players, 'awards_runup',
        '🏷 Any awards or fines to add before ' || left(r.name, 80) || '?',
        'Propose one now so it can be decided before the trip.');
    end if;
    if v_wait > 0 and coalesce(cardinality(v_orgs), 0) > 0 then
      perform private.gov_queue(r.group_id, v_orgs, 'awards_waiting',
        '🏷 ' || v_wait || ' award/fine proposal' || case when v_wait = 1 then '' else 's' end || ' waiting',
        'Decide ' || case when v_wait = 1 then 'it' else 'them' end || ' before ' || left(r.name, 80) || ' starts.');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.awards_runup_tick() from public, anon, authenticated;

-- 8:20 am Sydney (summer time).
select cron.schedule('lgc-awards-runup', '20 21 * * *', 'select private.awards_runup_tick()');

-- ============================================================================================ leftover kitty
alter table public.rules add column if not exists leftover text
  check (leftover is null or leftover in ('bar', 'split', 'rollover', 'winner', 'other'));
alter table public.rules add column if not exists leftover_note text check (leftover_note is null or length(leftover_note) <= 80);

-- Same words as leftoverWords() in src/lib/awardsfines.js.
create or replace function private.leftover_value(p_choice text, p_note text) returns text
language sql immutable set search_path = '' as $$
  select case coalesce(p_choice, 'bar')
    when 'bar' then 'On the bar the last night'
    when 'split' then 'Split back to everyone'
    when 'rollover' then 'Rolls over to the next trip'
    when 'winner' then 'Goes to the trophy winner'
    else left(coalesce(nullif(btrim(p_note), ''), 'Something else'), 80) end
$$;
create or replace function private.leftover_detail(p_choice text, p_note text) returns text
language sql immutable set search_path = '' as $$
  select 'Whatever’s left in the kitty at the end of a trip: ' || lower(left(private.leftover_value(p_choice, p_note), 1))
    || substr(private.leftover_value(p_choice, p_note), 2) || '. Words only — no money moves in the app.'
$$;
revoke all on function private.leftover_value(text, text) from public, anon, authenticated;
revoke all on function private.leftover_detail(text, text) from public, anon, authenticated;

-- The standard rule's worth line (and its wording, unless an organiser has rewritten it) follows the choice. Before
-- the governance guard (ab_), so changing the choice is a change to the rule.
create or replace function private.rules_leftover() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_key text := case when tg_op = 'UPDATE' then old.system_key else new.system_key end;
        v_server boolean := coalesce(current_setting('app.gov_apply', true), '') = 'on';
begin
  if tg_op = 'INSERT' and not v_server then v_key := null; end if;
  if v_key is distinct from 'leftover_kitty' then
    new.leftover := null; new.leftover_note := null;
    return new;
  end if;
  new.leftover := coalesce(new.leftover, 'bar');
  new.leftover_note := case when new.leftover = 'other' then nullif(btrim(coalesce(new.leftover_note, '')), '') end;
  if new.leftover = 'other' and new.leftover_note is null then raise exception 'Say what happens to the leftover kitty'; end if;
  if private.dinner_award_blocked(new.leftover_note) then
    raise exception 'Keep it friendly — roast the golf and the mates, never who someone is or anything tragic';
  end if;
  new.value := private.leftover_value(new.leftover, new.leftover_note);
  if tg_op = 'INSERT' or new.detail is null
     or (new.detail is not distinct from old.detail and old.detail is not distinct from private.leftover_detail(old.leftover, old.leftover_note)) then
    new.detail := private.leftover_detail(new.leftover, new.leftover_note);
  end if;
  return new;
end $$;
revoke all on function private.rules_leftover() from public, anon, authenticated;
create or replace trigger aa_rules_leftover before insert or update on public.rules
  for each row execute function private.rules_leftover();

-- Put it in a group's Rulebook (once), in force from the start (it's the usual thing; the group changes it).
create or replace function private.seed_leftover_rule(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_group is null or exists (select 1 from public.rules where group_id = p_group and system_key = 'leftover_kitty') then return; end if;
  perform set_config('app.gov_apply', 'on', true);
  insert into public.rules (group_id, title, detail, category, applies_to, value, status, proposed_by, decided_at, decision_note, sort,
    system_key, leftover)
  values (p_group, 'Leftover kitty', null, 'other', '{trip}', null, 'active', null, now(),
    'Standard rule — starts as “on the bar the last night”; the group can change it.', 910, 'leftover_kitty', 'bar')
  on conflict (group_id, system_key) where system_key is not null do nothing;
  perform set_config('app.gov_apply', '', true);
end $$;
revoke all on function private.seed_leftover_rule(uuid) from public, anon, authenticated;

create or replace function private.leftover_new_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.seed_leftover_rule(new.id);
  exception when others then
    raise warning 'leftover kitty rule for a new group: %', sqlerrm;   -- never stop a group being made
  end;
  return new;
end $$;
revoke all on function private.leftover_new_group() from public, anon, authenticated;
create or replace trigger zz_leftover_new_group after insert on public.groups
  for each row execute function private.leftover_new_group();


select private.seed_leftover_rule(id) from public.groups;

-- ============================================================================================ appeals
-- As 087, plus: the person nominated / fined (an appeal is a dispute about "who's fined"), and 085's late job
-- numbers and penalty strokes (087 replaced the list without them).
create or replace function private.dispute_fields(p_table text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_table
    when 'rounds' then array['comp_bonus', 'min_drives', 'rules', 'format', 'ctp_holes', 'ld_holes', 'own_comps']
    when 'teams' then array['handicap']
    when 'players' then array['handicap']
    when 'round_games' then array['stake', 'options', 'settings']
    when 'cup_matches' then array['points', 'a_hcp', 'b_hcp']
    when 'trips' then array['cup_points']
    when 'comps' then array['settings']
    when 'side_comp_defs' then array['how', 'unit', 'scoring', 'settings', 'conditions']
    when 'trophies' then array['description']
    when 'custom_games' then array['rules_text', 'settings']
    when 'rules' then array['value', 'title', 'detail', 'late_strokes', 'late_days']
    when 'score_adjustments' then array['strokes']
    when 'dinner_award_nominations' then array['player_id']
    when 'standard' then array['rule']
    else array[]::text[] end
$$;
revoke all on function private.dispute_fields(text) from public, anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.rule_opinions, public.award_strokes;
exception when others then null; end $$;

select private.add_same_group_checks();
