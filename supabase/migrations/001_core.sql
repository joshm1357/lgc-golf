-- 001_core.sql — L.G.C golf trip app: full data model (all stages), security, functions.
-- Rule: later migrations only ADD; never drop or rename anything here.

-- ---------- Settings (PINs) — no direct access, only via functions ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  group_name text not null default 'L.G.C',
  group_pin text not null,
  admin_pin text not null
);
alter table public.settings enable row level security;

-- ---------- People ----------
create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nickname text,
  avatar_url text,
  handicap numeric(4,1) not null default 18,
  created_at timestamptz not null default now()
);

create table public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.handicap_history (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  old_handicap numeric(4,1),
  new_handicap numeric(4,1) not null,
  reason text not null,
  case_id uuid,
  created_at timestamptz not null default now()
);

-- ---------- Courses, trips, rounds ----------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- [{ "n":1, "par":4, "si":7, "tee":{"lat":..,"lng":..}, "green":{"lat":..,"lng":..} }, ...] x18
  holes jsonb not null,
  created_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active','locked')),
  created_at timestamptz not null default now()
);

create table public.trophies (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  type text not null check (type in ('stableford_total','ambrose')),
  created_at timestamptz not null default now()
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  name text not null,
  play_date date,
  format text not null check (format in ('ambrose','stableford')),
  status text not null default 'setup' check (status in ('setup','live','locked')),
  ld_holes int[] not null default '{}',
  ctp_holes int[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  name text not null,
  handicap numeric(4,1) not null default 0,
  created_at timestamptz not null default now()
);

create table public.team_players (
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (team_id, player_id)
);

create table public.round_players (
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  playing_handicap int not null,
  primary key (round_id, player_id)
);

-- One row per team (Ambrose) or player (Stableford) per hole.
create table public.scores (
  round_id uuid not null references public.rounds(id) on delete cascade,
  subject_id uuid not null,
  subject_type text not null check (subject_type in ('team','player')),
  hole int not null check (hole between 1 and 18),
  strokes int check (strokes between 1 and 20),
  picked_up boolean not null default false,
  entered_by uuid references public.players(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (round_id, subject_id, hole)
);

-- Rounds played on paper: just total Stableford points.
create table public.quick_results (
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  points int not null,
  primary key (round_id, player_id)
);

-- ---------- Social ----------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete set null,
  round_id uuid references public.rounds(id) on delete set null,
  kind text not null default 'user' check (kind in ('auto','user','tribunal')),
  body text,
  photo_url text,
  hole int,
  player_id uuid references public.players(id) on delete set null,
  link text,
  created_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, player_id, emoji)
);

create table public.side_entries (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  hole int not null check (hole between 1 and 18),
  kind text not null check (kind in ('ctp','ld')),
  player_id uuid not null references public.players(id) on delete cascade,
  distance_m numeric(6,1),
  lat double precision,
  lng double precision,
  accuracy_m numeric,
  photo_url text,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.location_pings (
  player_id uuid primary key references public.players(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m numeric,
  updated_at timestamptz not null default now()
);

-- ---------- Tribunal ----------
create table public.tribunal_cases (
  id uuid primary key default gen_random_uuid(),
  accused_id uuid not null references public.players(id) on delete cascade,
  lodged_by uuid references public.players(id) on delete set null,
  proposed_change numeric(4,1) not null,
  case_text text not null,
  exhibit_url text,
  defence text,
  status text not null default 'open' check (status in ('open','closed')),
  verdict text check (verdict in ('upheld','dismissed')),
  guilty_votes int,
  not_guilty_votes int,
  chair_ruling text,
  overruled boolean not null default false,
  old_handicap numeric(4,1),
  new_handicap numeric(4,1),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index one_open_case_per_player on public.tribunal_cases (accused_id) where status = 'open';

create table public.tribunal_votes (
  case_id uuid not null references public.tribunal_cases(id) on delete cascade,
  voter_id uuid not null references public.players(id) on delete cascade,
  vote text not null check (vote in ('guilty','not_guilty','abstain')),
  comment text,
  created_at timestamptz not null default now(),
  primary key (case_id, voter_id)
);

-- ---------- Honour board (history, incl. pre-app winners) ----------
create table public.honour_board (
  id uuid primary key default gen_random_uuid(),
  trophy_name text not null,
  label text not null,          -- e.g. '2024', 'Nov 2024'
  winner_names text not null,
  player_ids uuid[] not null default '{}',
  sort_key int not null default 0,  -- higher = more recent
  created_at timestamptz not null default now()
);

-- ---------- Helper functions ----------
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.members where user_id = auth.uid()), false);
$$;

create or replace function public.my_player_id() returns uuid
language sql stable security definer set search_path = public as $$
  select player_id from public.members where user_id = auth.uid();
$$;

create or replace function public.my_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'is_member', exists (select 1 from public.members where user_id = auth.uid()),
    'is_admin', coalesce((select is_admin from public.members where user_id = auth.uid()), false),
    'player_id', (select player_id from public.members where user_id = auth.uid()),
    'group_name', (select group_name from public.settings where id = 1)
  );
$$;

create or replace function public.join_group(p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.settings where id = 1 and group_pin = trim(p_pin)) then
    return false;
  end if;
  insert into public.members (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  return true;
end $$;

create or replace function public.claim_admin(p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Join the group first'; end if;
  if not exists (select 1 from public.settings where id = 1 and admin_pin = trim(p_pin)) then
    return false;
  end if;
  update public.members set is_admin = true where user_id = auth.uid();
  return true;
end $$;

create or replace function public.set_pins(p_group_pin text, p_admin_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if length(trim(p_group_pin)) < 4 or length(trim(p_admin_pin)) < 4 then
    raise exception 'PINs need at least 4 characters';
  end if;
  update public.settings set group_pin = trim(p_group_pin), admin_pin = trim(p_admin_pin) where id = 1;
end $$;

-- Create my own player profile and link it to this device.
create or replace function public.create_my_player(p_name text, p_nickname text, p_handicap numeric, p_avatar_url text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_member() then raise exception 'Join the group first'; end if;
  insert into public.players (name, nickname, handicap, avatar_url)
  values (trim(p_name), nullif(trim(coalesce(p_nickname,'')), ''), coalesce(p_handicap, 18), p_avatar_url)
  returning id into v_id;
  insert into public.handicap_history (player_id, old_handicap, new_handicap, reason)
  values (v_id, null, coalesce(p_handicap, 18), 'Starting handicap');
  update public.members set player_id = v_id where user_id = auth.uid();
  return v_id;
end $$;

-- Link this device to an existing player (e.g. one the admin created, or a new phone).
create or replace function public.claim_player(p_player_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Join the group first'; end if;
  if not exists (select 1 from public.players where id = p_player_id) then raise exception 'No such player'; end if;
  update public.members set player_id = p_player_id where user_id = auth.uid();
end $$;

-- Admin creates a player on someone's behalf (sets starting handicap with history).
create or replace function public.admin_create_player(p_name text, p_nickname text, p_handicap numeric, p_avatar_url text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  insert into public.players (name, nickname, handicap, avatar_url)
  values (trim(p_name), nullif(trim(coalesce(p_nickname,'')), ''), coalesce(p_handicap, 18), p_avatar_url)
  returning id into v_id;
  insert into public.handicap_history (player_id, old_handicap, new_handicap, reason)
  values (v_id, null, coalesce(p_handicap, 18), 'Starting handicap');
  return v_id;
end $$;

-- ---------- Handicap guard: only admin or a Tribunal verdict can change it ----------
create or replace function public.players_handicap_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.handicap is distinct from old.handicap then
    if not public.is_admin() and coalesce(current_setting('app.allow_handicap', true), '') <> 'on' then
      raise exception 'Handicap changes go through the admin or the Tribunal';
    end if;
    insert into public.handicap_history (player_id, old_handicap, new_handicap, reason, case_id)
    values (new.id, old.handicap, new.handicap,
      coalesce(nullif(current_setting('app.handicap_reason', true), ''), 'Admin change'),
      nullif(current_setting('app.case_id', true), '')::uuid);
  end if;
  return new;
end $$;
create trigger players_handicap_guard before update on public.players
for each row execute function public.players_handicap_guard();

-- ---------- Scores: timestamp + birdie auto-posts ----------
create or replace function public.scores_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
create trigger scores_touch before insert or update on public.scores
for each row execute function public.scores_touch();

create or replace function public.scores_autopost() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_par int; v_trip uuid; v_name text; v_word text; v_diff int;
begin
  if new.strokes is null or new.picked_up then return new; end if;
  if tg_op = 'UPDATE' and old.strokes is not distinct from new.strokes then return new; end if;
  select (h->>'par')::int, r.trip_id into v_par, v_trip
  from public.rounds r join public.courses c on c.id = r.course_id,
       jsonb_array_elements(c.holes) h
  where r.id = new.round_id and (h->>'n')::int = new.hole;
  if v_par is null then return new; end if;
  v_diff := new.strokes - v_par;
  if new.strokes = 1 then v_word := 'a HOLE IN ONE';
  elsif v_diff <= -3 then v_word := 'an albatross';
  elsif v_diff = -2 then v_word := 'an eagle';
  elsif v_diff = -1 then v_word := 'birdie';
  else return new; end if;
  if new.subject_type = 'team' then
    select name into v_name from public.teams where id = new.subject_id;
  else
    select coalesce(nickname, name) into v_name from public.players where id = new.subject_id;
  end if;
  insert into public.posts (trip_id, round_id, kind, body, hole)
  values (v_trip, new.round_id, 'auto', coalesce(v_name, 'Someone') || ' made ' || v_word || ' on ' || new.hole || '.', new.hole);
  return new;
end $$;
create trigger scores_autopost after insert or update on public.scores
for each row execute function public.scores_autopost();

-- ---------- Tribunal functions ----------
create or replace function public.lodge_case(p_accused uuid, p_change numeric, p_text text, p_exhibit_url text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.my_player_id(); v_id uuid; v_name text;
begin
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if p_change = 0 then raise exception 'Propose a change'; end if;
  if exists (select 1 from public.tribunal_cases where accused_id = p_accused and status = 'open') then
    raise exception 'There is already an open case against this player';
  end if;
  insert into public.tribunal_cases (accused_id, lodged_by, proposed_change, case_text, exhibit_url)
  values (p_accused, v_me, p_change, trim(p_text), p_exhibit_url) returning id into v_id;
  select coalesce(nickname, name) into v_name from public.players where id = p_accused;
  insert into public.posts (kind, body, player_id, link, photo_url)
  values ('tribunal', 'Case lodged: The Lads v ' || v_name || ' (proposed ' ||
    case when p_change > 0 then '+' else '' end || trim(to_char(p_change, 'FM990.0')) || ')', v_me,
    '/tribunal/' || v_id, p_exhibit_url);
  return v_id;
end $$;

create or replace function public.set_defence(p_case uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tribunal_cases where id = p_case and accused_id = public.my_player_id() and status = 'open') then
    raise exception 'Only the accused can write the defence, while the case is open';
  end if;
  update public.tribunal_cases set defence = trim(p_text) where id = p_case;
end $$;

create or replace function public.finalise_case(p_case uuid, p_override text, p_ruling text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.tribunal_cases%rowtype;
  g int; ng int; v_verdict text; v_old numeric; v_new numeric; v_name text;
begin
  select * into c from public.tribunal_cases where id = p_case for update;
  if c.id is null or c.status <> 'open' then return; end if;
  select count(*) filter (where vote = 'guilty'), count(*) filter (where vote = 'not_guilty')
    into g, ng from public.tribunal_votes where case_id = p_case;
  v_verdict := case when g > ng then 'upheld' else 'dismissed' end;
  if p_override in ('upheld','dismissed') then v_verdict := p_override; end if;
  select handicap, coalesce(nickname, name) into v_old, v_name from public.players where id = c.accused_id;
  v_new := v_old;
  if v_verdict = 'upheld' then
    v_new := greatest(-10, least(54, v_old + c.proposed_change));
    perform set_config('app.allow_handicap', 'on', true);
    perform set_config('app.handicap_reason', 'Tribunal verdict', true);
    perform set_config('app.case_id', p_case::text, true);
    update public.players set handicap = v_new where id = c.accused_id;
    perform set_config('app.allow_handicap', '', true);
  end if;
  update public.tribunal_cases set status = 'closed', verdict = v_verdict, guilty_votes = g, not_guilty_votes = ng,
    chair_ruling = nullif(trim(coalesce(p_ruling,'')), ''),
    overruled = coalesce(p_override in ('upheld','dismissed') and p_override <> case when g > ng then 'upheld' else 'dismissed' end, false),
    old_handicap = v_old, new_handicap = v_new, closed_at = now()
  where id = p_case;
  insert into public.posts (kind, body, link)
  values ('tribunal',
    'Verdict: ' || case when v_verdict = 'upheld' then 'GUILTY' else 'NOT GUILTY' end || ' ' || g || '–' || ng || '. ' ||
    case when v_verdict = 'upheld'
      then v_name || ' goes from ' || trim(to_char(v_old, 'FM990.0')) || ' to ' || trim(to_char(v_new, 'FM990.0')) || '.'
      else v_name || ' stays on ' || trim(to_char(v_old, 'FM990.0')) || '.' end ||
    case when p_override in ('upheld','dismissed') then ' (Chair''s ruling)' else '' end,
    '/tribunal/' || p_case);
end $$;
revoke execute on function public.finalise_case(uuid, text, text) from public, anon, authenticated;

create or replace function public.cast_vote(p_case uuid, p_vote text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.my_player_id(); c public.tribunal_cases%rowtype; v_eligible int; v_votes int;
begin
  if v_me is null then raise exception 'Set up your profile first'; end if;
  select * into c from public.tribunal_cases where id = p_case;
  if c.id is null or c.status <> 'open' then raise exception 'This case is closed'; end if;
  if c.accused_id = v_me then raise exception 'The accused can''t vote on their own case'; end if;
  insert into public.tribunal_votes (case_id, voter_id, vote, comment)
  values (p_case, v_me, p_vote, nullif(trim(coalesce(p_comment,'')), ''))
  on conflict (case_id, voter_id) do update set vote = excluded.vote, comment = excluded.comment, created_at = now();
  -- Close automatically once every other player who has the app has voted.
  select count(distinct m.player_id) into v_eligible from public.members m
    where m.player_id is not null and m.player_id <> c.accused_id;
  select count(*) into v_votes from public.tribunal_votes where case_id = p_case;
  if v_eligible > 0 and v_votes >= v_eligible then
    perform public.finalise_case(p_case, null, null);
  end if;
end $$;

create or replace function public.chair_close_case(p_case uuid, p_override text, p_ruling text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the chair (admin) can close a case'; end if;
  perform public.finalise_case(p_case, p_override, p_ruling);
end $$;

-- ---------- Row Level Security ----------
alter table public.players enable row level security;
alter table public.members enable row level security;
alter table public.handicap_history enable row level security;
alter table public.courses enable row level security;
alter table public.trips enable row level security;
alter table public.trophies enable row level security;
alter table public.rounds enable row level security;
alter table public.teams enable row level security;
alter table public.team_players enable row level security;
alter table public.round_players enable row level security;
alter table public.scores enable row level security;
alter table public.quick_results enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;
alter table public.side_entries enable row level security;
alter table public.location_pings enable row level security;
alter table public.tribunal_cases enable row level security;
alter table public.tribunal_votes enable row level security;
alter table public.honour_board enable row level security;

-- Members can read everything (except settings and other members' rows).
do $$
declare t text;
begin
  foreach t in array array['players','handicap_history','courses','trips','trophies','rounds','teams','team_players',
    'round_players','scores','quick_results','posts','comments','reactions','side_entries','location_pings',
    'tribunal_cases','tribunal_votes','honour_board']
  loop
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

create policy "read own membership" on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "admin manages members" on public.members for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Admin-only writes.
do $$
declare t text;
begin
  foreach t in array array['courses','trips','trophies','rounds','teams','team_players','round_players',
    'quick_results','honour_board','handicap_history']
  loop
    execute format('create policy "admin insert" on public.%I for insert to authenticated with check (public.is_admin())', t);
    execute format('create policy "admin update" on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('create policy "admin delete" on public.%I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Players: edit your own profile (handicap is guarded by trigger); admin edits anyone.
create policy "edit own or admin" on public.players for update to authenticated
  using (id = public.my_player_id() or public.is_admin())
  with check (id = public.my_player_id() or public.is_admin());
create policy "admin delete" on public.players for delete to authenticated using (public.is_admin());

-- Scores: any member can enter or fix while the round is live; admin any time.
create policy "members write scores" on public.scores for insert to authenticated
  with check (public.is_member() and (public.is_admin() or exists (select 1 from public.rounds r where r.id = round_id and r.status = 'live')));
create policy "members update scores" on public.scores for update to authenticated
  using (public.is_member() and (public.is_admin() or exists (select 1 from public.rounds r where r.id = round_id and r.status = 'live')))
  with check (public.is_member());
create policy "admin delete scores" on public.scores for delete to authenticated using (public.is_admin());

-- Posts / comments / reactions: as yourself; delete your own (admin any).
create policy "post as me" on public.posts for insert to authenticated
  with check (public.is_member() and kind = 'user' and player_id = public.my_player_id());
create policy "delete own post" on public.posts for delete to authenticated
  using (player_id = public.my_player_id() or public.is_admin());
create policy "comment as me" on public.comments for insert to authenticated
  with check (public.is_member() and player_id = public.my_player_id());
create policy "delete own comment" on public.comments for delete to authenticated
  using (player_id = public.my_player_id() or public.is_admin());
create policy "react as me" on public.reactions for insert to authenticated
  with check (public.is_member() and player_id = public.my_player_id());
create policy "unreact" on public.reactions for delete to authenticated
  using (player_id = public.my_player_id());

-- Side comps: any member can enter (for anyone — someone else may hold the phone); fix own, admin any.
create policy "enter side comp" on public.side_entries for insert to authenticated
  with check (public.is_member() and created_by = public.my_player_id());
create policy "fix own side comp" on public.side_entries for update to authenticated
  using (created_by = public.my_player_id() or public.is_admin()) with check (public.is_member());
create policy "delete own side comp" on public.side_entries for delete to authenticated
  using (created_by = public.my_player_id() or public.is_admin());

-- Location: only your own.
create policy "share my location" on public.location_pings for insert to authenticated
  with check (player_id = public.my_player_id());
create policy "update my location" on public.location_pings for update to authenticated
  using (player_id = public.my_player_id()) with check (player_id = public.my_player_id());
create policy "stop sharing" on public.location_pings for delete to authenticated
  using (player_id = public.my_player_id());

-- Tribunal tables are written only through the functions above (no direct write policies).

-- ---------- Realtime ----------
alter publication supabase_realtime add table
  public.scores, public.posts, public.comments, public.reactions, public.side_entries,
  public.location_pings, public.tribunal_cases, public.tribunal_votes, public.rounds,
  public.teams, public.team_players, public.players, public.quick_results;

-- ---------- Photos bucket ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict (id) do nothing;
create policy "members upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member());
create policy "admin removes photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- ---------- Grants for functions ----------
grant execute on function public.is_member(), public.is_admin(), public.my_player_id(), public.my_status(),
  public.join_group(text), public.claim_admin(text), public.set_pins(text, text),
  public.create_my_player(text, text, numeric, text), public.claim_player(uuid),
  public.admin_create_player(text, text, numeric, text), public.lodge_case(uuid, numeric, text, text),
  public.set_defence(uuid, text), public.cast_vote(uuid, text, text), public.chair_close_case(uuid, text, text)
  to authenticated;
