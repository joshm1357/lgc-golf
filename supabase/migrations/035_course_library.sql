-- 035 — Stage 8: the shared course library. Additive: one new table, one column on courses, four functions.
--
-- How it fits together (nothing about rounds changes, so old phones are unaffected):
--  * Each group still plays its own copy of a course (`courses`, per group, as today). Rounds point at that copy.
--  * `course_library` is shared by every group: name, area, where it is, pars, stroke indexes, tees and greens.
--    No pins, no rounds, no scores and nothing about who played it.
--  * A group's organiser can share a course they've set up (`share_course`): it goes into the library, or updates the
--    library entry that came from it. A group that picks a library course gets its own copy (`copy_library_course`)
--    to adjust (tees, greens) without changing the shared one.
--  * Search by name and nearest to me (`search_courses`), readable by anyone signed in.

create table if not exists public.course_library (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  name text not null check (length(name) between 2 and 80),
  area text check (area is null or length(area) <= 80),          -- e.g. "Bowral NSW"
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  holes jsonb not null,                                           -- [{ n, par, si, tee?, green?, front?, back?, osm? }]
  osm boolean not null default false,                             -- any points from OpenStreetMap (credit needed)
  source_group_id uuid references public.groups(id) on delete set null,   -- never shown to other groups
  source_course_id uuid references public.courses(id) on delete set null,
  copies int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists course_library_name_idx on public.course_library (lower(name));
create index if not exists course_library_source_idx on public.course_library (source_course_id);
alter table public.course_library enable row level security;
revoke all on public.course_library from anon, authenticated;
-- Reads go through search_courses / library_course, which leave out who shared it.

alter table public.courses add column if not exists library_id uuid references public.course_library(id) on delete set null;

-- Where a course is: the middle of its mapped greens (null if none mapped).
create or replace function private.course_centre(p_holes jsonb, out lat double precision, out lng double precision)
language sql immutable as $$
  select avg((h -> 'green' ->> 'lat')::double precision), avg((h -> 'green' ->> 'lng')::double precision)
  from jsonb_array_elements(p_holes) h where h -> 'green' ? 'lat';
$$;

-- Only the fields the library keeps, checked: 9 or 18 holes, pars 3–6, each stroke index once.
create or replace function private.clean_holes(p_holes jsonb)
returns jsonb language plpgsql immutable as $$
declare v_n int := jsonb_array_length(p_holes); v jsonb;
begin
  if jsonb_typeof(p_holes) <> 'array' or v_n not in (9, 18) then raise exception 'A course needs 9 or 18 holes'; end if;
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'n', (h ->> 'n')::int, 'par', (h ->> 'par')::int, 'si', (h ->> 'si')::int,
           'tee', case when h -> 'tee' ? 'lat' then jsonb_build_object('lat', (h -> 'tee' ->> 'lat')::float8, 'lng', (h -> 'tee' ->> 'lng')::float8) end,
           'green', case when h -> 'green' ? 'lat' then jsonb_build_object('lat', (h -> 'green' ->> 'lat')::float8, 'lng', (h -> 'green' ->> 'lng')::float8) end,
           'front', case when h -> 'front' ? 'lat' then jsonb_build_object('lat', (h -> 'front' ->> 'lat')::float8, 'lng', (h -> 'front' ->> 'lng')::float8) end,
           'back', case when h -> 'back' ? 'lat' then jsonb_build_object('lat', (h -> 'back' ->> 'lat')::float8, 'lng', (h -> 'back' ->> 'lng')::float8) end,
           'osm', case when (h ->> 'osm')::boolean then true end)) order by (h ->> 'n')::int)
    into v from jsonb_array_elements(p_holes) h;
  if (select count(distinct (x ->> 'n')::int) from jsonb_array_elements(v) x where (x ->> 'n')::int between 1 and v_n) <> v_n then
    raise exception 'Holes must be numbered 1 to %', v_n;
  end if;
  if exists (select 1 from jsonb_array_elements(v) x where (x ->> 'par')::int not between 3 and 6) then raise exception 'Pars must be 3 to 6'; end if;
  if (select count(distinct (x ->> 'si')::int) from jsonb_array_elements(v) x where (x ->> 'si')::int between 1 and v_n) <> v_n then
    raise exception 'Stroke index must use each of 1 to % once', v_n;
  end if;
  return v;
end $$;

-- Share one of this group's courses with every group (or update the library entry that came from it).
create or replace function public.share_course(p_course_id uuid, p_area text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); c record; v_holes jsonb; v_id uuid; v_base text; v_slug text; v_n int := 1;
        v_lat double precision; v_lng double precision;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can share a course'; end if;
  select * into c from public.courses where id = p_course_id and group_id = v_g;
  if c.id is null then raise exception 'That course isn''t in your group'; end if;
  v_holes := private.clean_holes(c.holes);
  select lat, lng into v_lat, v_lng from private.course_centre(v_holes);
  -- This course was copied from the library, or shared before: update that entry if this group shared it.
  select id into v_id from public.course_library
   where (id = c.library_id and source_group_id = v_g) or source_course_id = c.id
   order by (source_course_id = c.id) desc limit 1;
  -- A copy of another group's library course is already in the library: don't make a second entry.
  if v_id is null and c.library_id is not null and exists (select 1 from public.course_library where id = c.library_id) then
    raise exception 'This course came from the shared library — it''s already there for everyone';
  end if;
  if v_id is not null then
    update public.course_library set name = left(btrim(c.name), 80), area = coalesce(nullif(btrim(p_area), ''), area),
      holes = v_holes, osm = exists (select 1 from jsonb_array_elements(v_holes) h where (h ->> 'osm')::boolean),
      lat = coalesce(v_lat, lat), lng = coalesce(v_lng, lng), updated_at = now()
    where id = v_id;
  else
    v_base := left(btrim(regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g'), '-'), 50);
    if length(v_base) < 2 then v_base := 'course'; end if;
    v_slug := v_base;
    while exists (select 1 from public.course_library where slug = v_slug) loop v_n := v_n + 1; v_slug := v_base || '-' || v_n; end loop;
    insert into public.course_library (slug, name, area, lat, lng, holes, osm, source_group_id, source_course_id)
    values (v_slug, left(btrim(c.name), 80), nullif(left(btrim(coalesce(p_area, '')), 80), ''), v_lat, v_lng, v_holes,
            exists (select 1 from jsonb_array_elements(v_holes) h where (h ->> 'osm')::boolean), v_g, c.id)
    returning id into v_id;
  end if;
  update public.courses set library_id = v_id where id = c.id;
  return v_id;
end $$;

-- Find courses: by name (any part), nearest first when a location is given.
create or replace function public.search_courses(p_query text default '', p_lat double precision default null, p_lng double precision default null, p_limit int default 20)
returns table (id uuid, slug text, name text, area text, holes int, greens int, osm boolean, copies int, km numeric)
language sql stable security definer set search_path = '' as $$
  select l.id, l.slug, l.name, l.area, jsonb_array_length(l.holes),
         (select count(*)::int from jsonb_array_elements(l.holes) h where h -> 'green' ? 'lat'), l.osm, l.copies,
         case when p_lat is not null and p_lng is not null and l.lat is not null then
           round((6371 * 2 * asin(sqrt(power(sin(radians(l.lat - p_lat) / 2), 2)
             + cos(radians(p_lat)) * cos(radians(l.lat)) * power(sin(radians(l.lng - p_lng) / 2), 2))))::numeric, 1) end
  from public.course_library l
  where auth.uid() is not null
    and (coalesce(btrim(p_query), '') = '' or l.name ilike '%' || replace(replace(btrim(p_query), '%', ''), '_', '') || '%'
         or l.area ilike '%' || replace(replace(btrim(p_query), '%', ''), '_', '') || '%')
  order by case when p_lat is not null and l.lat is not null then
             (l.lat - p_lat) ^ 2 + ((l.lng - p_lng) * cos(radians(p_lat))) ^ 2 end nulls last,
           l.copies desc, l.name
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- One library course in full (to preview before copying).
create or replace function public.library_course(p_id uuid)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('id', id, 'slug', slug, 'name', name, 'area', area, 'lat', lat, 'lng', lng, 'holes', holes, 'osm', osm, 'copies', copies)
  from public.course_library where id = p_id and auth.uid() is not null;
$$;

-- Give this group its own copy of a library course (to adjust tees and greens without changing the shared one).
create or replace function public.copy_library_course(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); l record; v_id uuid;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can add a course'; end if;
  select * into l from public.course_library where id = p_id;
  if l.id is null then raise exception 'That course isn''t in the library'; end if;
  select id into v_id from public.courses where group_id = v_g and library_id = l.id limit 1;
  if v_id is not null then return v_id; end if;  -- already have it
  insert into public.courses (group_id, name, holes, library_id) values (v_g, l.name, l.holes, l.id) returning id into v_id;
  update public.course_library set copies = copies + 1 where id = l.id;
  return v_id;
end $$;

revoke all on function public.share_course(uuid, text), public.search_courses(text, double precision, double precision, int),
  public.library_course(uuid), public.copy_library_course(uuid) from public, anon;
grant execute on function public.share_course(uuid, text), public.search_courses(text, double precision, double precision, int),
  public.library_course(uuid), public.copy_library_course(uuid) to authenticated;
revoke all on function private.course_centre(jsonb), private.clean_holes(jsonb) from public, anon, authenticated;
