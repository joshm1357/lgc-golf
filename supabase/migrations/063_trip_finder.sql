-- 063 — Trip finder (Stage 16, 21 Oct 2026). Additive only: new tables and functions. Behind the feature switch
-- 'trip_finder' (060: a child of the planner, off by default). Version 1: one-day rounds and weekends with one base.
--
-- What's kept, and who sees it:
--   * player_home_areas — a player's home SUBURB (or town) and postcode, with a place rounded to about 1 km. Optional,
--     set once on their profile. The player sees their own; the group's organisers see it only if the player shares
--     it. Never a street address (labels can't hold numbers).
--   * trip_start_points — a trip's 1–3 starting areas with headcounts ("Inner West ×8"), leave-after and finish-by
--     times. Organisers only. Removed 30 days after the trip (063b, a daily job).
--   * trip_finds — the finder's settings for a trip (day, 9/18 holes, longest drive, ranking preset, filters), the
--     options put to the group, and the course decided on. Everyone in the group reads it; organisers change it.
--   * course_facts — facts about a course (visitor times, largest group, price…), SHARED by every group, kept apart
--     from the OpenStreetMap course rows. Read and written through functions only: who suggested a fact is never
--     shown. Organisers suggest (pending); platform admins confirm; a club that has claimed its course confirms or
--     corrects its own facts, and the club's word wins. Facts older than 12 months show "check again" (in the app).
--   * course_notes — a group's private notes on a course ("good bar, slow greens"). That group only.
--   * course_ratings — after the trip, a one-tap 1–5 rating per player, kept per group. Other groups only ever see an
--     average and a count of groups — never names.

-- ------------------------------------------------------------------ 1. Home areas (on a player's profile)
create table if not exists public.player_home_areas (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null unique references public.players(id) on delete cascade,
  label text not null check (length(btrim(label)) between 2 and 60 and label !~ '[0-9]'),   -- a suburb, never a street address
  postcode text check (postcode is null or postcode ~ '^[0-9]{4}$'),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  share boolean not null default false,          -- the player chooses: organisers see it only when true
  updated_at timestamptz not null default now()
);
create index if not exists player_home_areas_group_idx on public.player_home_areas (group_id);
alter table public.player_home_areas enable row level security;
create policy "me, or organisers when shared" on public.player_home_areas for select
  using (player_id = private.my_player_id(group_id)
         or (share and group_id = any ((select private.my_organiser_group_ids())::uuid[])));
create policy "me only (add)" on public.player_home_areas for insert
  with check (player_id = private.my_player_id(group_id));
create policy "me only (change)" on public.player_home_areas for update
  using (player_id = private.my_player_id(group_id)) with check (player_id = private.my_player_id(group_id));
create policy "me only (remove)" on public.player_home_areas for delete
  using (player_id = private.my_player_id(group_id));
create policy "same group only" on public.player_home_areas as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
-- Switched off: nothing new is saved. Removing your own is always allowed.
create policy "feature on: trip_finder (add)" on public.player_home_areas as restrictive for insert with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (change)" on public.player_home_areas as restrictive for update using (public.feature_on(group_id, 'trip_finder')) with check (public.feature_on(group_id, 'trip_finder'));
revoke all on public.player_home_areas from anon;
grant select, insert, update, delete on public.player_home_areas to authenticated;
create trigger aa_fill_group_id before insert or update on public.player_home_areas
  for each row execute function private.fill_group_id('players:player_id');

-- Places are kept to 2 decimal places (about 1 km), whatever the phone sends.
create or replace function private.round_area_place() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.lat := round(new.lat::numeric, 2)::double precision;
  new.lng := round(new.lng::numeric, 2)::double precision;
  new.label := btrim(regexp_replace(new.label, '[[:cntrl:]]+', ' ', 'g'));
  if tg_table_name = 'player_home_areas' then new.updated_at := now(); end if;
  return new;
end $$;
revoke all on function private.round_area_place() from public, anon, authenticated;
create trigger ab_round_place before insert or update on public.player_home_areas
  for each row execute function private.round_area_place();

-- ------------------------------------------------------------------ 2. The finder's settings for a trip
create table if not exists public.trip_finds (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null unique references public.plans(id) on delete cascade,
  day date,                                                   -- the day of the round (one-day / one base)
  holes int not null default 18 check (holes in (9, 18)),
  players int check (players is null or players between 1 and 200),   -- null = the starting points' headcounts
  max_drive_min int not null default 180 check (max_drive_min between 15 and 720),
  preset text not null default 'fair' check (preset in ('fair', 'cheap', 'best')),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object' and length(filters::text) <= 2000),
  picks jsonb not null default '[]'::jsonb check (jsonb_typeof(picks) = 'array' and jsonb_array_length(picks) <= 9),  -- [{ course_id, option_id, name }]
  decided_course_id uuid references public.course_library(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trip_finds_group_idx on public.trip_finds (group_id);
create index if not exists trip_finds_decided_idx on public.trip_finds (decided_course_id);
alter table public.trip_finds enable row level security;
create policy "members read" on public.trip_finds for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.trip_finds for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.trip_finds as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: trip_finder (add)" on public.trip_finds as restrictive for insert with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (change)" on public.trip_finds as restrictive for update using (public.feature_on(group_id, 'trip_finder')) with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (remove)" on public.trip_finds as restrictive for delete using (public.feature_on(group_id, 'trip_finder'));
revoke all on public.trip_finds from anon;
grant select, insert, update, delete on public.trip_finds to authenticated;
create trigger aa_fill_group_id before insert or update on public.trip_finds
  for each row execute function private.fill_group_id('plans:plan_id');

-- ------------------------------------------------------------------ 3. A trip's starting points (organisers only)
create table if not exists public.trip_start_points (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  label text not null check (length(btrim(label)) between 2 and 60 and label !~ '[0-9]'),   -- an area, never an address
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  headcount int not null default 1 check (headcount between 1 and 60),
  leave_after text not null default '06:00' check (leave_after ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  finish_by text not null default '17:00' check (finish_by ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists trip_start_points_plan_idx on public.trip_start_points (plan_id, sort);
create index if not exists trip_start_points_group_idx on public.trip_start_points (group_id);
alter table public.trip_start_points enable row level security;
create policy "organisers only" on public.trip_start_points for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.trip_start_points as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: trip_finder (add)" on public.trip_start_points as restrictive for insert with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (change)" on public.trip_start_points as restrictive for update using (public.feature_on(group_id, 'trip_finder')) with check (public.feature_on(group_id, 'trip_finder'));
revoke all on public.trip_start_points from anon;
grant select, insert, update, delete on public.trip_start_points to authenticated;
create trigger aa_fill_group_id before insert or update on public.trip_start_points
  for each row execute function private.fill_group_id('plans:plan_id');
create trigger ab_round_place before insert or update on public.trip_start_points
  for each row execute function private.round_area_place();

-- At most 3 starting points a trip. (Only counted for the trip's own organisers: anyone else is refused by the
-- rules anyway, and mustn't learn how many there are.)
create or replace function private.trip_start_points_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_group_organiser(new.group_id) then return new; end if;
  if (select count(*) from public.trip_start_points where plan_id = new.plan_id) >= 3 then
    raise exception 'Up to 3 starting points a trip — put nearby people together';
  end if;
  return new;
end $$;
revoke all on function private.trip_start_points_cap() from public, anon, authenticated;
create trigger ac_start_points_cap before insert on public.trip_start_points
  for each row execute function private.trip_start_points_cap();

-- ------------------------------------------------------------------ 4. Course facts (shared by every group)
create table if not exists public.course_facts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.course_library(id) on delete cascade,
  fact text not null check (fact in ('visitor_times', 'member_times', 'max_group', 'price_18', 'price_9', 'book_ahead',
                                     'start_interval', 'round_length', 'carts', 'stay_play')),
  value text not null check (length(btrim(value)) between 1 and 200),
  source text not null default 'organiser' check (source in ('organiser', 'club', 'research', 'email')),
  source_link text check (source_link is null or (length(source_link) <= 400 and source_link ~* '^https?://')),
  checked_at date not null default current_date,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  club boolean not null default false,                        -- given or confirmed by the course's own club: wins
  proposed_by uuid references auth.users(id) on delete set null,   -- never shown to anyone
  proposed_group uuid references public.groups(id) on delete set null,  -- never shown; for the daily limit
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists course_facts_course_idx on public.course_facts (course_id, fact, checked_at desc);
create index if not exists course_facts_status_idx on public.course_facts (status, created_at);
create index if not exists course_facts_proposed_by_idx on public.course_facts (proposed_by);
create index if not exists course_facts_proposed_group_idx on public.course_facts (proposed_group);
create index if not exists course_facts_decided_by_idx on public.course_facts (decided_by);
alter table public.course_facts enable row level security;
revoke all on public.course_facts from anon, authenticated;   -- functions only (they leave out who suggested it)

-- ------------------------------------------------------------------ 5. A group's private notes on a course
create table if not exists public.course_notes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  course_id uuid not null references public.course_library(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 400),
  created_by uuid references public.players(id) on delete set null default public.my_player_id(),
  created_at timestamptz not null default now()
);
create index if not exists course_notes_group_course_idx on public.course_notes (group_id, course_id);
create index if not exists course_notes_course_idx on public.course_notes (course_id);
create index if not exists course_notes_created_by_idx on public.course_notes (created_by);
alter table public.course_notes enable row level security;
create policy "members read" on public.course_notes for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "members add as themselves" on public.course_notes for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[]) and created_by = private.my_player_id(group_id));
create policy "own or organiser (change)" on public.course_notes for update
  using (created_by = private.my_player_id(group_id) or group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (created_by = private.my_player_id(group_id) or group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "own or organiser (remove)" on public.course_notes for delete
  using (created_by = private.my_player_id(group_id) or group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.course_notes as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: trip_finder (add)" on public.course_notes as restrictive for insert with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (change)" on public.course_notes as restrictive for update using (public.feature_on(group_id, 'trip_finder')) with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (remove)" on public.course_notes as restrictive for delete using (public.feature_on(group_id, 'trip_finder'));
revoke all on public.course_notes from anon;
grant select, insert, update, delete on public.course_notes to authenticated;
create trigger aa_fill_group_id before insert or update on public.course_notes
  for each row execute function private.fill_group_id();

-- ------------------------------------------------------------------ 6. Course ratings after the trip (per group)
create table if not exists public.course_ratings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  course_id uuid not null references public.course_library(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade default public.my_player_id(),
  rating int not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  unique (plan_id, course_id, player_id)
);
create index if not exists course_ratings_course_idx on public.course_ratings (course_id, group_id);
create index if not exists course_ratings_group_idx on public.course_ratings (group_id);
create index if not exists course_ratings_player_idx on public.course_ratings (player_id);
alter table public.course_ratings enable row level security;
create policy "members read" on public.course_ratings for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "rate as me (add)" on public.course_ratings for insert
  with check (player_id = private.my_player_id(group_id));
create policy "rate as me (change)" on public.course_ratings for update
  using (player_id = private.my_player_id(group_id)) with check (player_id = private.my_player_id(group_id));
create policy "rate as me (remove)" on public.course_ratings for delete
  using (player_id = private.my_player_id(group_id));
create policy "same group only" on public.course_ratings as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: trip_finder (add)" on public.course_ratings as restrictive for insert with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (change)" on public.course_ratings as restrictive for update using (public.feature_on(group_id, 'trip_finder')) with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (remove)" on public.course_ratings as restrictive for delete using (public.feature_on(group_id, 'trip_finder'));
revoke all on public.course_ratings from anon;
grant select, insert, update, delete on public.course_ratings to authenticated;
create trigger aa_fill_group_id before insert or update on public.course_ratings
  for each row execute function private.fill_group_id('plans:plan_id');

-- ------------------------------------------------------------------ Who's using the finder
-- The app's organisers (group header), or the connector (server key) naming its group.
create or replace function private.finder_group(p_group uuid default null) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_g uuid;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    v_g := p_group;
  else
    v_g := private.current_group();
    if auth.uid() is null or v_g is null or not private.is_group_organiser(v_g) then
      raise exception 'Only an organiser can use the trip finder';
    end if;
  end if;
  if v_g is not null and not public.feature_on(v_g, 'trip_finder') then
    raise exception 'The trip finder is switched off for this group (Group & invites → Features)';
  end if;
  return v_g;
end $$;
revoke all on function private.finder_group(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ Finding a starting area by name
-- Towns and areas from the course library ("Bowral NSW", "Port Stephens NSW"), with the middle of their courses.
create or replace function public.trip_finder_places(p_query text)
returns table (area text, lat double precision, lng double precision, courses int)
language sql stable security definer set search_path = '' as $$
  with q as (select replace(replace(replace(left(btrim(coalesce(p_query, '')), 60), '\', '\\'), '%', '\%'), '_', '\_') as t)
  select l.area, avg(l.lat), avg(l.lng), count(*)::int
  from public.course_library l, q
  where auth.uid() is not null and length(q.t) >= 2 and not l.hidden and l.area is not null and l.lat is not null
    and l.area ilike '%' || q.t || '%'
  group by l.area
  order by bool_or(l.area ilike q.t || '%') desc, count(*) desc, l.area
  limit 8;
$$;
revoke all on function public.trip_finder_places(text) from public, anon;
grant execute on function public.trip_finder_places(text) to authenticated, service_role;

-- ------------------------------------------------------------------ Courses in an area, with facts and ratings
-- Library courses in a box (nearest the middle first, at most 400), each with its facts (no names), this group's
-- average rating, other groups' average and how many groups, whether this group has played it, and how many private
-- notes this group has on it.
create or replace function public.trip_finder_courses(p_south double precision, p_west double precision, p_north double precision,
  p_east double precision, p_lat double precision default null, p_lng double precision default null, p_limit int default 300,
  p_group uuid default null)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_g uuid := private.finder_group(p_group); v json;
begin
  if p_south is null or p_north is null or p_west is null or p_east is null or p_north < p_south or p_east < p_west
     or p_north - p_south > 20 or p_east - p_west > 25 then
    raise exception 'That area is too big — move the starting points closer, or lower the longest drive';
  end if;
  select coalesce(json_agg(x order by x_ord), '[]'::json) into v from (
    select json_build_object(
      'id', l.id, 'slug', l.slug, 'name', l.name, 'area', l.area, 'lat', l.lat, 'lng', l.lng,
      'holes', jsonb_array_length(l.holes), 'partner', l.club_id is not null, 'osm', l.osm,
      'facts', (select coalesce(json_agg(json_build_object('id', f.id, 'fact', f.fact, 'value', f.value, 'source', f.source,
                  'source_link', f.source_link, 'checked_at', f.checked_at, 'status', f.status, 'club', f.club)), '[]'::json)
                from (select * from public.course_facts f0 where f0.course_id = l.id and f0.status <> 'rejected'
                      order by f0.checked_at desc, f0.created_at desc limit 40) f),
      'mine_avg', (select round(avg(r.rating), 2) from public.course_ratings r where r.course_id = l.id and r.group_id = v_g),
      'mine_n', (select count(*) from public.course_ratings r where r.course_id = l.id and r.group_id = v_g),
      'others_avg', (select round(avg(a), 2) from (select avg(r.rating) a from public.course_ratings r
                     where r.course_id = l.id and r.group_id is distinct from v_g group by r.group_id) g),
      'others_n', (select count(distinct r.group_id) from public.course_ratings r where r.course_id = l.id and r.group_id is distinct from v_g),
      'played', exists (select 1 from public.courses c join public.rounds rd on rd.course_id = c.id
                        where c.group_id = v_g and c.library_id = l.id),
      'notes', (select count(*) from public.course_notes n where n.group_id = v_g and n.course_id = l.id)
    ) as x,
    row_number() over (order by case when p_lat is not null and p_lng is not null then
                         (l.lat - p_lat) ^ 2 + ((l.lng - p_lng) * cos(radians(p_lat))) ^ 2 end nulls last, l.name) as x_ord
    from public.course_library l
    where not l.hidden and l.lat between p_south and p_north and l.lng between p_west and p_east
    order by x_ord
    limit least(greatest(coalesce(p_limit, 300), 1), 400)
  ) s;
  return v;
end $$;
revoke all on function public.trip_finder_courses(double precision, double precision, double precision, double precision, double precision, double precision, int, uuid) from public, anon;
grant execute on function public.trip_finder_courses(double precision, double precision, double precision, double precision, double precision, double precision, int, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ Facts for one course (anyone signed in)
create or replace function public.course_facts_for(p_course uuid)
returns table (id uuid, fact text, value text, source text, source_link text, checked_at date, status text, club boolean)
language sql stable security definer set search_path = '' as $$
  select f.id, f.fact, f.value, f.source, f.source_link, f.checked_at, f.status, f.club
  from public.course_facts f
  where (auth.uid() is not null or coalesce(auth.role(), '') = 'service_role')
    and f.course_id = p_course and f.status <> 'rejected'
  order by f.fact, f.club desc, (f.status = 'confirmed') desc, f.checked_at desc
  limit 100;
$$;
revoke all on function public.course_facts_for(uuid) from public, anon;
grant execute on function public.course_facts_for(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ Suggesting a fact
-- An organiser (trip finder on), the connector (always pending), a platform admin, or the course's own club (its
-- facts are confirmed straight away and marked as the club's). Up to 60 suggestions a day per person and per group.
-- The same value already waiting is just re-dated, not added twice.
create or replace function public.propose_course_fact(p_course uuid, p_fact text, p_value text, p_source text default 'organiser',
  p_link text default null, p_checked date default null, p_group uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_service boolean := coalesce(auth.role(), '') = 'service_role'; v_uid uuid := auth.uid(); v_g uuid;
        v_club boolean := false; v_admin boolean := false; v_value text; v_link text; v_source text; v_checked date; v_id uuid;
begin
  if not v_service then
    v_club := v_uid is not null and exists (select 1 from public.club_members m join public.course_library l on l.club_id = m.club_id
                                            where m.user_id = v_uid and l.id = p_course);
    v_admin := v_uid is not null and private.is_platform_admin();
  end if;
  if v_service then v_g := private.finder_group(p_group);
  elsif not (v_club or v_admin) then v_g := private.finder_group(null);
  end if;
  if not exists (select 1 from public.course_library where id = p_course and not hidden) then raise exception 'That course isn''t in the library'; end if;
  if p_fact not in ('visitor_times', 'member_times', 'max_group', 'price_18', 'price_9', 'book_ahead', 'start_interval', 'round_length', 'carts', 'stay_play') then
    raise exception 'Unknown fact';
  end if;
  v_value := left(btrim(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]+', ' ', 'g')), 200);
  if v_value = '' then raise exception 'Say what the fact is'; end if;
  if p_fact in ('max_group', 'price_18', 'price_9', 'start_interval', 'round_length') then
    v_value := regexp_replace(v_value, '^\$\s*', '');
    if v_value !~ '^[0-9]{1,4}(\.[0-9]{1,2})?$' then raise exception 'That one needs a number'; end if;
    if p_fact = 'max_group' and v_value::numeric not between 1 and 400 then raise exception 'Largest group: 1 to 400'; end if;
    if p_fact = 'start_interval' and v_value::numeric not between 5 and 20 then raise exception 'Start interval: 5 to 20 minutes'; end if;
    if p_fact = 'round_length' and v_value::numeric not between 150 and 360 then raise exception 'Round length: 150 to 360 minutes'; end if;
  end if;
  v_link := nullif(left(btrim(coalesce(p_link, '')), 400), '');
  if v_link is not null and v_link !~* '^https?://' then raise exception 'The link needs to start with https://'; end if;
  v_checked := coalesce(p_checked, current_date);
  if v_checked > current_date or v_checked < date '2000-01-01' then raise exception 'Checked on: today or earlier'; end if;
  v_source := case when v_club then 'club' when v_service then 'research'
                   when p_source in ('organiser', 'research', 'email') then p_source else 'organiser' end;
  if (v_uid is not null and (select count(*) from public.course_facts where proposed_by = v_uid and created_at > now() - interval '1 day') >= 60)
     or (v_g is not null and (select count(*) from public.course_facts where proposed_group = v_g and created_at > now() - interval '1 day') >= 60) then
    raise exception 'That''s 60 course facts today — thanks! Try again tomorrow';
  end if;

  select id into v_id from public.course_facts
   where course_id = p_course and fact = p_fact and value = v_value and status = 'pending' and not v_club limit 1;
  if v_id is not null then
    update public.course_facts set checked_at = greatest(checked_at, v_checked), source_link = coalesce(v_link, source_link) where id = v_id;
    return v_id;
  end if;
  insert into public.course_facts (course_id, fact, value, source, source_link, checked_at, status, club, proposed_by, proposed_group,
                                   decided_by, decided_at)
  values (p_course, p_fact, v_value, v_source, v_link, v_checked, case when v_club then 'confirmed' else 'pending' end, v_club,
          v_uid, v_g, case when v_club then v_uid end, case when v_club then now() end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.propose_course_fact(uuid, text, text, text, text, date, uuid) from public, anon;
grant execute on function public.propose_course_fact(uuid, text, text, text, text, date, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ Confirming (platform admins, or the course's club)
create or replace function public.decide_course_fact(p_id uuid, p_ok boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.course_facts; v_club boolean;
begin
  select * into f from public.course_facts where id = p_id for update;
  if f.id is null then raise exception 'That fact has gone'; end if;
  v_club := auth.uid() is not null and exists (select 1 from public.club_members m join public.course_library l on l.club_id = m.club_id
                                               where m.user_id = auth.uid() and l.id = f.course_id);
  if not (v_club or private.is_platform_admin()) then raise exception 'Only the course''s club or the app''s team can confirm course facts'; end if;
  update public.course_facts
     set status = case when p_ok then 'confirmed' else 'rejected' end,
         club = case when p_ok then (f.club or v_club) else false end,
         checked_at = case when p_ok and v_club then current_date else checked_at end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end $$;
revoke all on function public.decide_course_fact(uuid, boolean) from public, anon;
grant execute on function public.decide_course_fact(uuid, boolean) to authenticated;

-- Facts waiting for a decision: all of them for platform admins, a club's own courses for the club.
create or replace function public.course_facts_to_check(p_limit int default 50)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', f.id, 'course_id', f.course_id, 'course', l.name, 'area', l.area, 'fact', f.fact,
                                             'value', f.value, 'source', f.source, 'source_link', f.source_link, 'checked_at', f.checked_at)
                           order by f.created_at), '[]'::json)
  from (select * from public.course_facts f0 where f0.status = 'pending'
          and (private.is_platform_admin()
               or exists (select 1 from public.club_members m join public.course_library l0 on l0.club_id = m.club_id
                          where m.user_id = auth.uid() and l0.id = f0.course_id))
        order by f0.created_at limit least(greatest(coalesce(p_limit, 50), 1), 200)) f
  join public.course_library l on l.id = f.course_id;
$$;
revoke all on function public.course_facts_to_check(int) from public, anon;
grant execute on function public.course_facts_to_check(int) to authenticated;

-- ------------------------------------------------------------------ Options to the group: "Put to the group"
-- Up to 3 courses go into the trip's place vote (a new one, or the open one), each with its facts in the notes.
-- If they're on two or more different days, a dates vote goes up too. Options carry the course for later.
--   p_options: [{ "course_id": uuid, "label": "…", "address": "…", "notes": "…", "cost_pp": 95, "start_date": "2026-11-14" }]
create or replace function public.trip_finder_to_group(p_plan uuid, p_options jsonb, p_closes_on date default null)
returns json language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; v_poll uuid; v_new boolean := false; v_dpoll uuid; o jsonb; l record; v_opt uuid;
        v_picks jsonb := '[]'::jsonb; v_dates date[] := '{}'; v_d date; n int := 0; v_all jsonb;
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  if not private.is_group_organiser(v.group_id) then raise exception 'Only an organiser can put options to the group'; end if;
  if not public.feature_on(v.group_id, 'trip_finder') then raise exception 'The trip finder is switched off for this group'; end if;
  if not public.feature_on(v.group_id, 'planner_tasks') then raise exception 'Votes are switched off for this group — use Just decide'; end if;
  if v.status <> 'planning' then raise exception 'This one is past voting — use Just decide'; end if;
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 1 and 3 then raise exception 'Tick 1 to 3 options'; end if;
  if p_closes_on is not null and p_closes_on < (now() at time zone 'Australia/Sydney')::date then raise exception 'The closing date has passed'; end if;
  me := private.my_player_id(v.group_id);

  select id into v_poll from public.plan_polls where plan_id = p_plan and kind = 'location' and status = 'open' order by created_at limit 1;
  if v_poll is null then
    insert into public.plan_polls (plan_id, group_id, kind, question, closes_on, created_by)
    values (p_plan, v.group_id, 'location', 'Where should we play?', p_closes_on, me) returning id into v_poll;
    v_new := true;
  end if;
  for o in select value from jsonb_array_elements(p_options) loop
    select * into l from public.course_library where id = nullif(o ->> 'course_id', '')::uuid and not hidden;
    if l.id is null then raise exception 'A course in that list isn''t in the library'; end if;
    insert into public.plan_options (poll_id, group_id, label, address, notes, cost_pp, created_by)
    values (v_poll, v.group_id, left(coalesce(nullif(btrim(o ->> 'label'), ''), l.name), 120),
            left(coalesce(nullif(btrim(o ->> 'address'), ''), l.area), 200),
            left(nullif(btrim(o ->> 'notes'), ''), 500),
            case when (o ->> 'cost_pp') ~ '^[0-9]{1,5}(\.[0-9]+)?$' then round((o ->> 'cost_pp')::numeric, 2) end, me)
    returning id into v_opt;
    v_picks := v_picks || jsonb_build_array(jsonb_build_object('course_id', l.id, 'option_id', v_opt, 'name', l.name));
    v_d := nullif(o ->> 'start_date', '')::date;
    if v_d is not null and not (v_d = any (v_dates)) then v_dates := v_dates || v_d; end if;
    n := n + 1;
  end loop;

  -- Two or more different days: they go in the dates vote too (the open one, or a new one), once each.
  if cardinality(v_dates) >= 2 then
    select id into v_dpoll from public.plan_polls where plan_id = p_plan and kind = 'dates' and status = 'open' order by created_at limit 1;
    if v_dpoll is null then
      insert into public.plan_polls (plan_id, group_id, kind, question, closes_on, created_by)
      values (p_plan, v.group_id, 'dates', 'Which day works?', p_closes_on, me) returning id into v_dpoll;
    end if;
    foreach v_d in array v_dates loop
      continue when exists (select 1 from public.plan_options where poll_id = v_dpoll and start_date = v_d);
      insert into public.plan_options (poll_id, group_id, label, start_date, end_date, created_by)
      values (v_dpoll, v.group_id, to_char(v_d, 'Dy DD Mon YYYY'), v_d, v_d + coalesce(v.end_date - v.start_date, 0), me);
    end loop;
  end if;

  select coalesce(picks, '[]'::jsonb) || v_picks into v_all from public.trip_finds where plan_id = p_plan;
  v_all := coalesce(v_all, v_picks);
  while jsonb_array_length(v_all) > 9 loop v_all := v_all - 0; end loop;
  insert into public.trip_finds (plan_id, group_id, picks) values (p_plan, v.group_id, v_all)
  on conflict (plan_id) do update set picks = excluded.picks, updated_at = now();
  return json_build_object('poll_id', v_poll, 'new_poll', v_new, 'dates_poll_id', v_dpoll, 'options', n);
end $$;
revoke all on function public.trip_finder_to_group(uuid, jsonb, date) from public, anon;
grant execute on function public.trip_finder_to_group(uuid, jsonb, date) to authenticated;

-- ------------------------------------------------------------------ "Just decide"
-- The course becomes the trip's place (and the day its date, if one is given). The trip isn't locked in here —
-- that stays the organiser's own button, which also makes it a trip in the app.
create or replace function public.trip_finder_decide(p_plan uuid, p_course uuid, p_day date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.plans; l record;
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  if not private.is_group_organiser(v.group_id) then raise exception 'Only an organiser can decide'; end if;
  if not public.feature_on(v.group_id, 'trip_finder') then raise exception 'The trip finder is switched off for this group'; end if;
  if v.status in ('done', 'cancelled') then raise exception 'This trip is finished'; end if;
  select * into l from public.course_library where id = p_course and not hidden;
  if l.id is null then raise exception 'That course isn''t in the library'; end if;
  update public.plans
     set location_name = l.name, address = coalesce(l.area, address),
         start_date = case when p_day is not null then p_day else start_date end,
         end_date = case when p_day is not null then p_day + coalesce(end_date - start_date, 0) else end_date end
   where id = p_plan;
  insert into public.trip_finds as t (plan_id, group_id, decided_course_id, day) values (p_plan, v.group_id, l.id, p_day)
  on conflict (plan_id) do update set decided_course_id = excluded.decided_course_id, day = coalesce(excluded.day, t.day), updated_at = now();
end $$;
revoke all on function public.trip_finder_decide(uuid, uuid, date) from public, anon;
grant execute on function public.trip_finder_decide(uuid, uuid, date) to authenticated;

select private.add_same_group_checks();
