-- 077 — Trip builder (22 Oct 2026). Additive only: new tables, one new column on plan_polls, no drops.
-- Build a trip day by day on one map (Josh: "you say location general, then you can select a course … on the way,
-- then … how far from the accommodation is OK … then on the way home"). Behind the 'trip_finder' switch (a child of
-- the planner). Votes stay in the planner's own tables (plan_polls / plan_options / plan_votes, 'planner_tasks').
--
-- What's kept, and who sees it:
--   * stay_areas — a short list of golf-trip towns (Nowra, Jervis Bay, Mudgee…) with the region they're in. The same
--     for every group, read-only, anyone signed in. Pins an organiser adds for one trip live in trip_builds.state.
--   * trip_builds — one per trip: the builder's choices (area, weekends, stay areas, course options per day, the
--     configurations put to the group, the one picked). Everyone in the group reads it; organisers change it.
--   * trip_tee_options — the tee times a course has on a DATE for this trip, entered after someone rings the course.
--     Everyone in the group reads them; organisers, or whoever owns that "Call the course" job, add and change them.
--   * course_booking_info — how to book a course (visitor / member times, phone / online / email, the booking link,
--     largest group, features). SHARED by every group like the course library. Anyone signed in reads it (never who
--     changed it); any organiser of a group with the trip finder on can add or correct it.
--   * vote_batches — "one card, one notification": several polls (one per section) shown together as one vote
--     ("Where and when?", "Which trip?"), with an optional "Are you keen?" (the trip's RSVPs). Older app versions
--     simply see the separate polls.

-- ------------------------------------------------------------------ 1. Golf-trip towns (shared, read-only)
create table if not exists public.stay_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 2 and 60),
  state text not null check (state in ('NSW', 'VIC', 'QLD', 'SA', 'ACT', 'TAS', 'WA', 'NT')),
  region text not null check (length(btrim(region)) between 2 and 60),
  lat double precision not null check (lat between -45 and -9),
  lng double precision not null check (lng between 110 and 155),
  sort int not null default 0
);
create index if not exists stay_areas_region_idx on public.stay_areas (region);
alter table public.stay_areas enable row level security;
create policy "signed in read" on public.stay_areas for select to authenticated using (auth.uid() is not null);
revoke all on public.stay_areas from anon;
revoke insert, update, delete on public.stay_areas from authenticated;
grant select on public.stay_areas to authenticated;

insert into public.stay_areas (name, state, region, lat, lng, sort) values
  ('Kiama', 'NSW', 'South Coast NSW', -34.67, 150.85, 1), ('Gerringong', 'NSW', 'South Coast NSW', -34.75, 150.82, 2),
  ('Shoalhaven Heads', 'NSW', 'South Coast NSW', -34.85, 150.74, 3), ('Nowra', 'NSW', 'South Coast NSW', -34.88, 150.60, 4),
  ('Jervis Bay (Huskisson)', 'NSW', 'South Coast NSW', -35.04, 150.67, 5), ('Vincentia', 'NSW', 'South Coast NSW', -35.07, 150.67, 6),
  ('Sussex Inlet', 'NSW', 'South Coast NSW', -35.16, 150.59, 7), ('Mollymook', 'NSW', 'South Coast NSW', -35.34, 150.47, 8),
  ('Ulladulla', 'NSW', 'South Coast NSW', -35.36, 150.47, 9), ('Batemans Bay', 'NSW', 'South Coast NSW', -35.71, 150.18, 10),
  ('Moruya', 'NSW', 'South Coast NSW', -35.91, 150.08, 11), ('Narooma', 'NSW', 'South Coast NSW', -36.22, 150.13, 12),
  ('Merimbula', 'NSW', 'South Coast NSW', -36.89, 149.91, 13), ('Eden', 'NSW', 'South Coast NSW', -37.07, 149.90, 14),
  ('Bowral', 'NSW', 'Southern Highlands', -34.48, 150.42, 20), ('Mittagong', 'NSW', 'Southern Highlands', -34.45, 150.45, 21),
  ('Moss Vale', 'NSW', 'Southern Highlands', -34.55, 150.37, 22),
  ('Cessnock', 'NSW', 'Hunter Valley', -32.83, 151.36, 30), ('Pokolbin', 'NSW', 'Hunter Valley', -32.78, 151.29, 31),
  ('Newcastle', 'NSW', 'Hunter Valley', -32.93, 151.78, 32),
  ('Nelson Bay', 'NSW', 'Port Stephens & Great Lakes', -32.72, 152.14, 40), ('Anna Bay', 'NSW', 'Port Stephens & Great Lakes', -32.78, 152.08, 41),
  ('Forster', 'NSW', 'Port Stephens & Great Lakes', -32.18, 152.51, 42), ('Tuncurry', 'NSW', 'Port Stephens & Great Lakes', -32.17, 152.50, 43),
  ('Port Macquarie', 'NSW', 'Mid North Coast', -31.43, 152.91, 50), ('Kempsey', 'NSW', 'Mid North Coast', -31.08, 152.84, 51),
  ('Coffs Harbour', 'NSW', 'Mid North Coast', -30.30, 153.11, 52),
  ('Terrigal', 'NSW', 'Central Coast', -33.45, 151.44, 60), ('The Entrance', 'NSW', 'Central Coast', -33.34, 151.50, 61),
  ('Mudgee', 'NSW', 'Central West NSW', -32.59, 149.59, 70), ('Orange', 'NSW', 'Central West NSW', -33.28, 149.10, 71),
  ('Bathurst', 'NSW', 'Central West NSW', -33.42, 149.58, 72), ('Dubbo', 'NSW', 'Central West NSW', -32.25, 148.60, 73),
  ('Leura', 'NSW', 'Blue Mountains', -33.71, 150.33, 80),
  ('Albury', 'NSW', 'Murray & Riverina', -36.08, 146.92, 90), ('Corowa', 'NSW', 'Murray & Riverina', -36.00, 146.39, 91),
  ('Yarrawonga', 'VIC', 'Murray & Riverina', -36.02, 146.00, 92), ('Wagga Wagga', 'NSW', 'Murray & Riverina', -35.12, 147.37, 93),
  ('Jindabyne', 'NSW', 'Snowy Mountains', -36.42, 148.62, 100),
  ('Canberra', 'ACT', 'Canberra', -35.28, 149.13, 110),
  ('Ballina', 'NSW', 'Northern Rivers', -28.87, 153.56, 120), ('Byron Bay', 'NSW', 'Northern Rivers', -28.64, 153.61, 121),
  ('Kingscliff', 'NSW', 'Northern Rivers', -28.26, 153.58, 122),
  ('Coolangatta', 'QLD', 'Gold Coast', -28.17, 153.54, 130), ('Surfers Paradise', 'QLD', 'Gold Coast', -28.00, 153.43, 131),
  ('Hope Island', 'QLD', 'Gold Coast', -27.87, 153.36, 132),
  ('Noosa', 'QLD', 'Sunshine Coast', -26.39, 153.09, 140), ('Coolum', 'QLD', 'Sunshine Coast', -26.53, 153.09, 141),
  ('Caloundra', 'QLD', 'Sunshine Coast', -26.80, 153.13, 142),
  ('Brisbane', 'QLD', 'Brisbane', -27.47, 153.03, 150),
  ('Rosebud', 'VIC', 'Mornington Peninsula', -38.36, 144.91, 160), ('Sorrento', 'VIC', 'Mornington Peninsula', -38.34, 144.74, 161),
  ('Portsea', 'VIC', 'Mornington Peninsula', -38.32, 144.71, 162), ('Flinders', 'VIC', 'Mornington Peninsula', -38.47, 145.02, 163),
  ('Torquay', 'VIC', 'Bellarine & Surf Coast', -38.33, 144.33, 170), ('Barwon Heads', 'VIC', 'Bellarine & Surf Coast', -38.27, 144.49, 171),
  ('Anglesea', 'VIC', 'Bellarine & Surf Coast', -38.41, 144.19, 172), ('Lorne', 'VIC', 'Bellarine & Surf Coast', -38.54, 143.98, 173),
  ('Bright', 'VIC', 'Victorian High Country', -36.73, 146.96, 180),
  ('Lakes Entrance', 'VIC', 'Gippsland & Phillip Island', -37.88, 147.98, 190), ('Cowes (Phillip Island)', 'VIC', 'Gippsland & Phillip Island', -38.45, 145.24, 191),
  ('Ballarat', 'VIC', 'Goldfields VIC', -37.56, 143.85, 200), ('Bendigo', 'VIC', 'Goldfields VIC', -36.76, 144.28, 201),
  ('Bridport (Barnbougle)', 'TAS', 'Tasmania', -41.00, 147.39, 210), ('Launceston', 'TAS', 'Tasmania', -41.44, 147.14, 211),
  ('Hobart', 'TAS', 'Tasmania', -42.88, 147.33, 212),
  ('Victor Harbor', 'SA', 'Fleurieu & Barossa SA', -35.55, 138.62, 220), ('McLaren Vale', 'SA', 'Fleurieu & Barossa SA', -35.22, 138.54, 221),
  ('Tanunda (Barossa)', 'SA', 'Fleurieu & Barossa SA', -34.52, 138.96, 222), ('Adelaide', 'SA', 'Fleurieu & Barossa SA', -34.93, 138.60, 223)
on conflict (name) do nothing;

-- ------------------------------------------------------------------ 2. The builder's choices for a trip
create table if not exists public.trip_builds (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null unique references public.plans(id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and length(state::text) <= 60000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trip_builds_group_idx on public.trip_builds (group_id);
alter table public.trip_builds enable row level security;
create policy "members read" on public.trip_builds for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.trip_builds for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.trip_builds as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: trip_finder (add)" on public.trip_builds as restrictive for insert with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (change)" on public.trip_builds as restrictive for update using (public.feature_on(group_id, 'trip_finder')) with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (remove)" on public.trip_builds as restrictive for delete using (public.feature_on(group_id, 'trip_finder'));
revoke all on public.trip_builds from anon;
grant select, insert, update, delete on public.trip_builds to authenticated;
create trigger aa_fill_group_id before insert or update on public.trip_builds
  for each row execute function private.fill_group_id('plans:plan_id');
create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;
create trigger ab_touch before update on public.trip_builds for each row execute function private.touch_updated_at();

-- ------------------------------------------------------------------ 3. Tee times a course has, per date
create table if not exists public.trip_tee_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  play_date date not null,
  course_id uuid not null references public.course_library(id) on delete cascade,
  times text[] not null default '{}' check (cardinality(times) <= 40 and array_to_string(times, ',') ~ '^(([01][0-9]|2[0-3]):[0-5][0-9](,|$))*$'),
  job_id uuid references public.plan_items(id) on delete set null,
  entered_by uuid references public.players(id) on delete set null default public.my_player_id(),
  notes text check (notes is null or length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, play_date, course_id)
);
create index if not exists trip_tee_options_group_idx on public.trip_tee_options (group_id);
create index if not exists trip_tee_options_course_idx on public.trip_tee_options (course_id);
create index if not exists trip_tee_options_job_idx on public.trip_tee_options (job_id);
create index if not exists trip_tee_options_entered_by_idx on public.trip_tee_options (entered_by);
alter table public.trip_tee_options enable row level security;

-- Am I the owner of an open "call the course" job on this trip? (Then I can put in what the course said.)
create or replace function private.owns_call_job(p_plan uuid, p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plan_items i
                 where i.id = p_job and i.plan_id = p_plan and i.kind = 'job'
                   and i.owner_id is not null and i.owner_id = private.my_player_id(i.group_id));
$$;
revoke all on function private.owns_call_job(uuid, uuid) from public, anon;
grant execute on function private.owns_call_job(uuid, uuid) to authenticated;

create policy "members read" on public.trip_tee_options for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers or the caller (add)" on public.trip_tee_options for insert
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[])
              or (job_id is not null and private.owns_call_job(plan_id, job_id) and entered_by = private.my_player_id(group_id)));
create policy "organisers or the caller (change)" on public.trip_tee_options for update
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[])
         or (job_id is not null and private.owns_call_job(plan_id, job_id)))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[])
              or (job_id is not null and private.owns_call_job(plan_id, job_id) and entered_by = private.my_player_id(group_id)));
create policy "organisers or the caller (remove)" on public.trip_tee_options for delete
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[])
         or (job_id is not null and private.owns_call_job(plan_id, job_id)));
create policy "same group only" on public.trip_tee_options as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: trip_finder (add)" on public.trip_tee_options as restrictive for insert with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (change)" on public.trip_tee_options as restrictive for update using (public.feature_on(group_id, 'trip_finder')) with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (remove)" on public.trip_tee_options as restrictive for delete using (public.feature_on(group_id, 'trip_finder'));
revoke all on public.trip_tee_options from anon;
grant select, insert, update, delete on public.trip_tee_options to authenticated;
create trigger aa_fill_group_id before insert or update on public.trip_tee_options
  for each row execute function private.fill_group_id('plans:plan_id');
create trigger ab_touch before update on public.trip_tee_options for each row execute function private.touch_updated_at();

-- The job (if any) must be on the same trip, and the course must be in the library.
create or replace function private.trip_tee_options_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.job_id is not null and not exists (select 1 from public.plan_items where id = new.job_id and plan_id = new.plan_id) then
    raise exception 'That job isn''t on this trip';
  end if;
  if not exists (select 1 from public.course_library where id = new.course_id and not hidden) then
    raise exception 'That course isn''t in the library';
  end if;
  new.notes := nullif(btrim(regexp_replace(coalesce(new.notes, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  select coalesce(array_agg(distinct t order by t), '{}') into new.times from unnest(new.times) t;
  return new;
end $$;
revoke all on function private.trip_tee_options_check() from public, anon, authenticated;
create trigger ac_check before insert or update on public.trip_tee_options
  for each row execute function private.trip_tee_options_check();

-- ------------------------------------------------------------------ 4. How to book a course (shared by every group)
create table if not exists public.course_booking_info (
  course_id uuid primary key references public.course_library(id) on delete cascade,
  visitor_times text check (visitor_times is null or length(visitor_times) <= 200),
  member_times text check (member_times is null or length(member_times) <= 200),
  booking_method text check (booking_method is null or booking_method in ('phone', 'online', 'email')),
  phone text check (phone is null or phone ~ '^[0-9 +()-]{6,20}$'),
  booking_url text check (booking_url is null or (length(booking_url) <= 400 and booking_url ~* '^https://')),
  email text check (email is null or (length(email) <= 120 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  max_group int check (max_group is null or max_group between 1 and 400),
  max_tee_times int check (max_tee_times is null or max_tee_times between 1 and 100),
  features text[] not null default '{}' check (features <@ array['links', 'parkland', 'water views', 'resort', 'stay & play', 'carts',
    'driving range', 'restaurant', 'bar', 'good value', 'tough', 'easy walk']::text[]),
  notes text check (notes is null or length(notes) <= 400),
  source text not null default 'organiser' check (source in ('organiser', 'ai', 'club')),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),   -- never shown to anyone
  updated_at timestamptz not null default now()
);
create index if not exists course_booking_info_updated_by_idx on public.course_booking_info (updated_by);
alter table public.course_booking_info enable row level security;

-- An organiser of any group that has the trip finder on.
create or replace function private.can_edit_booking_info() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.group_members m
    where m.user_id = auth.uid() and m.role = 'organiser' and public.feature_on(m.group_id, 'trip_finder'));
$$;
revoke all on function private.can_edit_booking_info() from public, anon;
grant execute on function private.can_edit_booking_info() to authenticated;

create policy "signed in read" on public.course_booking_info for select to authenticated using (auth.uid() is not null);
create policy "organisers add" on public.course_booking_info for insert to authenticated with check (private.can_edit_booking_info());
create policy "organisers change" on public.course_booking_info for update to authenticated
  using (private.can_edit_booking_info()) with check (private.can_edit_booking_info());
revoke all on public.course_booking_info from anon, authenticated;
-- Who changed it is never readable (column grants leave updated_by out).
grant select (course_id, visitor_times, member_times, booking_method, phone, booking_url, email, max_group, max_tee_times,
              features, notes, source, updated_at) on public.course_booking_info to authenticated;
grant insert (course_id, visitor_times, member_times, booking_method, phone, booking_url, email, max_group, max_tee_times,
              features, notes, source) on public.course_booking_info to authenticated;
grant update (visitor_times, member_times, booking_method, phone, booking_url, email, max_group, max_tee_times,
              features, notes, source) on public.course_booking_info to authenticated;

create or replace function private.course_booking_info_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.course_library where id = new.course_id and not hidden) then
    raise exception 'That course isn''t in the library';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if new.source = 'club' and not exists (select 1 from public.club_members m join public.course_library l on l.club_id = m.club_id
                                         where m.user_id = auth.uid() and l.id = new.course_id) then
    new.source := 'organiser';
  end if;
  new.visitor_times := nullif(btrim(regexp_replace(coalesce(new.visitor_times, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  new.member_times := nullif(btrim(regexp_replace(coalesce(new.member_times, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  new.notes := nullif(btrim(regexp_replace(coalesce(new.notes, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  select coalesce(array_agg(distinct f order by f), '{}') into new.features from unnest(new.features) f;
  return new;
end $$;
revoke all on function private.course_booking_info_stamp() from public, anon, authenticated;
create trigger aa_stamp before insert or update on public.course_booking_info
  for each row execute function private.course_booking_info_stamp();

-- ------------------------------------------------------------------ 5. One vote card, many sections
create table if not exists public.vote_batches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 80),
  keen boolean not null default false,          -- also asks "Are you keen? In / Maybe / Out" (the trip's RSVPs)
  closes_on date,
  created_by uuid references public.players(id) on delete set null default public.my_player_id(),
  created_at timestamptz not null default now()
);
create index if not exists vote_batches_plan_idx on public.vote_batches (plan_id);
create index if not exists vote_batches_group_idx on public.vote_batches (group_id);
create index if not exists vote_batches_created_by_idx on public.vote_batches (created_by);
alter table public.vote_batches enable row level security;
create policy "members read" on public.vote_batches for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.vote_batches for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.vote_batches as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: planner_tasks (add)" on public.vote_batches as restrictive for insert with check (public.feature_on(group_id, 'planner_tasks'));
create policy "feature on: planner_tasks (change)" on public.vote_batches as restrictive for update using (public.feature_on(group_id, 'planner_tasks')) with check (public.feature_on(group_id, 'planner_tasks'));
create policy "feature on: planner_tasks (remove)" on public.vote_batches as restrictive for delete using (public.feature_on(group_id, 'planner_tasks'));
revoke all on public.vote_batches from anon;
grant select, insert, update, delete on public.vote_batches to authenticated;
create trigger aa_fill_group_id before insert or update on public.vote_batches
  for each row execute function private.fill_group_id('plans:plan_id');

alter table public.plan_polls add column if not exists vote_batch uuid references public.vote_batches(id) on delete set null;
create index if not exists plan_polls_vote_batch_idx on public.plan_polls (vote_batch);
-- A poll can only join a batch on its own trip.
create or replace function private.plan_polls_batch_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.vote_batch is not null and not exists (select 1 from public.vote_batches b where b.id = new.vote_batch and b.plan_id = new.plan_id) then
    raise exception 'That vote card is for another trip';
  end if;
  return new;
end $$;
revoke all on function private.plan_polls_batch_check() from public, anon, authenticated;
create trigger ad_batch_check before insert or update of vote_batch on public.plan_polls
  for each row execute function private.plan_polls_batch_check();

-- Live updates for the builder (tee times coming in, the vote card).
do $$ begin
  alter publication supabase_realtime add table public.trip_builds, public.trip_tee_options, public.vote_batches;
exception when others then null; end $$;

select private.add_same_group_checks();
