-- 035b — Stage 8 review fixes. Additive: one column, two indexes, one trigger, replaced functions.
--  1. Every hole needs a par (3–6) and a stroke index; points must be real places; 18 holes only for now (the app's
--     handicap maths is 18-hole).
--  2. The library can't be wrecked: phone-only (not signed-in) organisers can't share; 10 shares a day per group; once
--     another group has copied an entry, sharing again can only fill in missing tees and greens — never change the
--     name, pars or stroke index. Josh can hide a junk entry (`hidden`).
--  3. A group that mapped greens on its copy of a library course gives them back: they fill holes the library is
--     missing, never overwriting anything.
--  4. Two shares or two copies at the same moment can't make duplicates. The library link on a group's course can't be
--     changed from the app (only by these functions).
--  5. Search: % and _ are searched for literally; the query is capped; library_course says whether the entry is yours.

alter table public.course_library add column if not exists hidden boolean not null default false;
create unique index if not exists course_library_one_per_course on public.course_library (source_course_id) where source_course_id is not null;
create unique index if not exists courses_one_copy_per_group on public.courses (group_id, library_id) where library_id is not null;

create or replace function private.course_centre(p_holes jsonb, out lat double precision, out lng double precision)
language sql immutable set search_path = '' as $$
  select avg((h -> 'green' ->> 'lat')::double precision), avg((h -> 'green' ->> 'lng')::double precision)
  from jsonb_array_elements(p_holes) h where h -> 'green' ? 'lat';
$$;

create or replace function private.clean_holes(p_holes jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_n int; v jsonb;
begin
  if jsonb_typeof(p_holes) <> 'array' then raise exception 'A course needs 18 holes'; end if;
  v_n := jsonb_array_length(p_holes);
  if v_n <> 18 then raise exception 'A course needs 18 holes'; end if;
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
  if exists (select 1 from jsonb_array_elements(v) x where x ->> 'par' is null or (x ->> 'par')::int not between 3 and 6) then
    raise exception 'Every hole needs a par of 3 to 6';
  end if;
  if (select count(distinct (x ->> 'si')::int) from jsonb_array_elements(v) x where (x ->> 'si')::int between 1 and v_n) <> v_n then
    raise exception 'Stroke index must use each of 1 to % once', v_n;
  end if;
  if exists (select 1 from jsonb_array_elements(v) x, unnest(array['tee', 'green', 'front', 'back']) k
             where x ? k and (abs((x -> k ->> 'lat')::float8) > 90 or abs((x -> k ->> 'lng')::float8) > 180)) then
    raise exception 'A point on the map isn''t a real place — check the greens';
  end if;
  return v;
end $$;

-- Fill holes' missing points from another set of holes (never overwrites anything already there).
create or replace function private.fill_points(p_into jsonb, p_from jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_agg(
           a || coalesce((select jsonb_object_agg(k, b -> k) from unnest(array['tee', 'green', 'front', 'back']) k
                          where not (a ? k) and b ? k), '{}'::jsonb)
             || case when not (a ? 'green') and b ? 'green' and (b ->> 'osm')::boolean then '{"osm": true}'::jsonb else '{}'::jsonb end
           order by (a ->> 'n')::int)
  from jsonb_array_elements(p_into) a
  left join lateral (select x as b from jsonb_array_elements(p_from) x where (x ->> 'n') = (a ->> 'n') limit 1) bb on true;
$$;

create or replace function public.share_course(p_course_id uuid, p_area text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); c record; v_holes jsonb; v_id uuid; v_base text; v_slug text; v_n int := 1;
        v_lat double precision; v_lng double precision; e record; v_area text := nullif(left(btrim(coalesce(p_area, '')), 80), '');
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can share a course'; end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), true) then
    raise exception 'Add a sign-in first (Group & invites) — then you can share courses with other groups';
  end if;
  select * into c from public.courses where id = p_course_id and group_id = v_g for update;
  if c.id is null then raise exception 'That course isn''t in your group'; end if;
  v_holes := private.clean_holes(c.holes);
  select lat, lng into v_lat, v_lng from private.course_centre(v_holes);
  select * into e from public.course_library
   where (id = c.library_id and source_group_id = v_g) or source_course_id = c.id
   order by (source_course_id = c.id) desc limit 1 for update;

  if e.id is null and c.library_id is not null then
    -- A copy of someone else's entry: give back any tees and greens the library is missing. Nothing else changes.
    select * into e from public.course_library where id = c.library_id for update;
    if e.id is null then raise exception 'That library course has gone'; end if;
    update public.course_library set holes = private.fill_points(holes, v_holes),
      osm = osm or exists (select 1 from jsonb_array_elements(private.fill_points(holes, v_holes)) h where (h ->> 'osm')::boolean),
      lat = coalesce(lat, v_lat), lng = coalesce(lng, v_lng), updated_at = now()
    where id = e.id;
    return e.id;
  end if;

  if (select count(*) from public.course_library where source_group_id = v_g and updated_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s 10 courses shared today — try again tomorrow';
  end if;

  if e.id is not null then
    if e.copies > 0 then
      -- Other groups use it: only fill in what's missing, so nobody's copy source is changed under them.
      update public.course_library set holes = private.fill_points(holes, v_holes), area = coalesce(area, v_area),
        osm = osm or exists (select 1 from jsonb_array_elements(private.fill_points(holes, v_holes)) h where (h ->> 'osm')::boolean),
        lat = coalesce(lat, v_lat), lng = coalesce(lng, v_lng), updated_at = now()
      where id = e.id;
    else
      update public.course_library set name = left(btrim(c.name), 80), area = coalesce(v_area, area),
        holes = v_holes, osm = exists (select 1 from jsonb_array_elements(v_holes) h where (h ->> 'osm')::boolean),
        lat = coalesce(v_lat, lat), lng = coalesce(v_lng, lng), updated_at = now()
      where id = e.id;
    end if;
    v_id := e.id;
  else
    if length(btrim(c.name)) < 2 then raise exception 'Give the course a name first'; end if;
    v_base := btrim(left(btrim(regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g'), '-'), 50), '-');
    if length(v_base) < 2 then v_base := 'course'; end if;
    loop
      v_slug := case when v_n = 1 then v_base else v_base || '-' || v_n end;
      if not exists (select 1 from public.course_library where slug = v_slug) then
        begin
          insert into public.course_library (slug, name, area, lat, lng, holes, osm, source_group_id, source_course_id)
          values (v_slug, left(btrim(c.name), 80), v_area, v_lat, v_lng, v_holes,
                  exists (select 1 from jsonb_array_elements(v_holes) h where (h ->> 'osm')::boolean), v_g, c.id)
          returning id into v_id;
          exit;
        exception when unique_violation then
          if exists (select 1 from public.course_library where source_course_id = c.id) then
            raise exception 'This course was just shared — try again';
          end if;
        end;
      end if;
      v_n := v_n + 1;
    end loop;
  end if;
  perform set_config('lgc.library_link', 'on', true);
  update public.courses set library_id = v_id where id = c.id;
  perform set_config('lgc.library_link', 'off', true);
  return v_id;
end $$;

create or replace function public.search_courses(p_query text default '', p_lat double precision default null, p_lng double precision default null, p_limit int default 20)
returns table (id uuid, slug text, name text, area text, holes int, greens int, osm boolean, copies int, km numeric)
language sql stable security definer set search_path = '' as $$
  with q as (select replace(replace(replace(left(btrim(coalesce(p_query, '')), 80), '\', '\\'), '%', '\%'), '_', '\_') as t)
  select l.id, l.slug, l.name, l.area, jsonb_array_length(l.holes),
         (select count(*)::int from jsonb_array_elements(l.holes) h where h -> 'green' ? 'lat'), l.osm, l.copies,
         case when p_lat is not null and p_lng is not null and l.lat is not null then
           round((6371 * 2 * asin(sqrt(power(sin(radians(l.lat - p_lat) / 2), 2)
             + cos(radians(p_lat)) * cos(radians(l.lat)) * power(sin(radians(l.lng - p_lng) / 2), 2))))::numeric, 1) end
  from public.course_library l, q
  where auth.uid() is not null and not l.hidden
    and (q.t = '' or l.name ilike '%' || q.t || '%' or l.area ilike '%' || q.t || '%')
  order by case when p_lat is not null and l.lat is not null then
             (l.lat - p_lat) ^ 2 + ((l.lng - p_lng) * cos(radians(p_lat))) ^ 2 end nulls last,
           l.copies desc, l.name
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create or replace function public.library_course(p_id uuid)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('id', id, 'slug', slug, 'name', name, 'area', area, 'lat', lat, 'lng', lng, 'holes', holes, 'osm', osm,
                           'copies', copies, 'mine', source_group_id is not distinct from private.current_group())
  from public.course_library where id = p_id and auth.uid() is not null and not hidden;
$$;

create or replace function public.copy_library_course(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); l record; v_id uuid;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can add a course'; end if;
  select * into l from public.course_library where id = p_id and not hidden;
  if l.id is null then raise exception 'That course isn''t in the library'; end if;
  perform set_config('lgc.library_link', 'on', true);
  insert into public.courses (group_id, name, holes, library_id) values (v_g, l.name, l.holes, l.id)
  on conflict (group_id, library_id) where library_id is not null do nothing
  returning id into v_id;
  perform set_config('lgc.library_link', 'off', true);
  if v_id is null then  -- already have it
    select id into v_id from public.courses where group_id = v_g and library_id = l.id;
    return v_id;
  end if;
  update public.course_library set copies = copies + 1 where id = l.id;
  return v_id;
end $$;

-- The library link on a course is set only by the functions above, not by an app edit.
create or replace function private.keep_library_link() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.library_id is distinct from old.library_id and coalesce(current_setting('lgc.library_link', true), '') <> 'on'
     and current_setting('role', true) in ('authenticated', 'anon') then
    new.library_id := old.library_id;
  end if;
  return new;
end $$;
create or replace trigger ad_courses_keep_library_link before update on public.courses for each row execute function private.keep_library_link();

revoke all on function private.course_centre(jsonb), private.clean_holes(jsonb), private.fill_points(jsonb, jsonb) from public, anon, authenticated;
