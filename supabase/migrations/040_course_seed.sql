-- 040 — Stage 8b part 4: list every Australian course (from OpenStreetMap). Additive. STAGING first — STOP before live.
-- A seeded course is a "listing": a name and a place, usually with no scorecard yet. Hole data is only taken from
-- OpenStreetMap when it's complete (18 holes, each with a par and a stroke index). A listing with no scorecard can't be
-- copied or played until someone adds one: a group that shares the same course fills it, or the club claims it and
-- checks its hole data. Seeding never changes a course a club has claimed, a group has shared, or anyone uses.

alter table public.course_library add column if not exists osm_ref text;   -- e.g. 'w123456' or 'r789' (way / relation)
create unique index if not exists course_library_osm_ref on public.course_library (osm_ref) where osm_ref is not null;

-- The name without the usual words, for matching "Bowral Golf Club" with "Bowral GC".
create or replace function private.course_key(p_name text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(lower(coalesce(p_name, '')), '\m(golf|country|club|course|links|gc|cc|inc|ltd|the|and|of|resort|sporting|recreation|reserve)\M', '', 'g'),
           '[^a-z0-9]+', '', 'g');
$$;

create or replace function private.km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable set search_path = '' as $$
  select case when a_lat is null or b_lat is null then null else
    6371 * 2 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))) end;
$$;
revoke all on function private.course_key(text), private.km(double precision, double precision, double precision, double precision) from public, anon, authenticated;

-- A record of each seeding run, for Josh.
create table if not exists private.seed_runs (
  id bigint generated always as identity primary key,
  state text not null, added int not null, matched int not null, updated int not null, with_holes int not null, skipped int not null,
  ran_at timestamptz not null default now()
);
revoke all on private.seed_runs from public, anon, authenticated;

-- The seeding job is started from the database (pg_net) with a random token kept here; the job checks it before it
-- asks OpenStreetMap for anything, so nobody else can set it running.
create table if not exists private.seed_secret (token text not null);
insert into private.seed_secret (token) select encode(extensions.gen_random_bytes(24), 'hex') where not exists (select 1 from private.seed_secret);
revoke all on private.seed_secret from public, anon, authenticated;
create or replace function public.seed_token_ok(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.role(), '') = 'service_role' and exists (select 1 from private.seed_secret where token = p_token);
$$;
revoke all on function public.seed_token_ok(text) from public, anon, authenticated;
grant execute on function public.seed_token_ok(text) to service_role;

-- Called by the seeding job (service role only). p_rows: [{ ref, name, lat, lng, area, holes? }].
create or replace function public.seed_courses(p_state text, p_rows jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_ref text; v_name text; v_area text; v_lat double precision; v_lng double precision; v_holes jsonb; v_key text;
        e record; v_base text; v_slug text; v_n int; a int := 0; m int := 0; u int := 0; wh int := 0; sk int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not allowed'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then raise exception 'Bad rows'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    v_ref := x ->> 'ref';
    v_name := left(btrim(regexp_replace(coalesce(x ->> 'name', ''), '[[:cntrl:]]+', ' ', 'g')), 80);
    v_area := nullif(left(btrim(coalesce(x ->> 'area', '')), 80), '');
    v_lat := (x ->> 'lat')::double precision; v_lng := (x ->> 'lng')::double precision;
    v_key := private.course_key(v_name);
    if v_ref !~ '^[wr][0-9]{1,15}$' or length(v_name) < 2 or v_lat not between -45 and -9 or v_lng not between 112 and 155 then
      sk := sk + 1; continue;
    end if;
    -- Complete hole data only (18 holes, par and stroke index each); anything less is left out.
    v_holes := null;
    if jsonb_typeof(x -> 'holes') = 'array' then
      begin v_holes := private.clean_holes(x -> 'holes'); exception when others then v_holes := null; end;
    end if;

    select * into e from public.course_library where osm_ref = v_ref;
    if e.id is null and length(v_key) >= 3 then
      -- Already in the library under another name (a group shared it, or an earlier listing)? Use that one.
      select * into e from public.course_library l
       where l.osm_ref is null and private.course_key(l.name) = v_key
         and coalesce(private.km(l.lat, l.lng, v_lat, v_lng), 0) < 5
       order by private.km(l.lat, l.lng, v_lat, v_lng) nulls last limit 1;
      if e.id is not null then
        update public.course_library set osm_ref = v_ref, area = coalesce(area, v_area), lat = coalesce(lat, v_lat), lng = coalesce(lng, v_lng)
        where id = e.id;
        m := m + 1; continue;
      end if;
    end if;

    if e.id is not null then
      -- Seen before. Only an untouched listing (no club, nobody's shared or copied it) follows OpenStreetMap's name;
      -- anything else just has gaps filled.
      if e.club_id is null and e.source_group_id is null and e.copies = 0 and not e.verified and not e.hidden then
        update public.course_library set name = v_name, area = coalesce(v_area, area), lat = v_lat, lng = v_lng,
          holes = case when jsonb_array_length(holes) = 0 and v_holes is not null then v_holes else holes end,
          osm = true, updated_at = now()
        where id = e.id;
      else
        update public.course_library set area = coalesce(area, v_area), lat = coalesce(lat, v_lat), lng = coalesce(lng, v_lng)
        where id = e.id;
      end if;
      u := u + 1; continue;
    end if;

    v_base := btrim(left(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), 50), '-');
    if length(v_base) < 2 then v_base := 'course'; end if;
    v_n := 1;
    loop
      v_slug := case when v_n = 1 then v_base
                     when v_n = 2 and lower(p_state) ~ '^[a-z]{2,3}$' then v_base || '-' || lower(p_state)
                     else v_base || '-' || v_n end;
      if not exists (select 1 from public.course_library where slug = v_slug) then
        begin
          insert into public.course_library (slug, name, area, lat, lng, holes, osm, osm_ref)
          values (v_slug, v_name, v_area, v_lat, v_lng, coalesce(v_holes, '[]'::jsonb), true, v_ref);
          exit;
        exception when unique_violation then
          if exists (select 1 from public.course_library where osm_ref = v_ref) then exit; end if;
        end;
      end if;
      v_n := v_n + 1;
    end loop;
    a := a + 1;
    if v_holes is not null then wh := wh + 1; end if;
  end loop;
  insert into private.seed_runs (state, added, matched, updated, with_holes, skipped) values (left(coalesce(p_state, '?'), 8), a, m, u, wh, sk);
  return json_build_object('added', a, 'matched', m, 'updated', u, 'with_holes', wh, 'skipped', sk);
end $$;
revoke all on function public.seed_courses(text, jsonb) from public, anon, authenticated;
grant execute on function public.seed_courses(text, jsonb) to service_role;

-- A library course with no scorecard can't be added to a group (or played from a QR code) until it has one.
create or replace function private.courses_need_scorecard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.library_id is not null and jsonb_array_length(coalesce(new.holes, '[]'::jsonb)) = 0 then
    raise exception 'This course has no scorecard yet — add it as a new course with its pars, then share it to fill the listing';
  end if;
  return new;
end $$;
create or replace trigger ac_courses_need_scorecard before insert on public.courses
  for each row execute function private.courses_need_scorecard();

-- Sharing a course that's only a listing so far fills that listing (instead of making a second entry).
create or replace function public.share_course(p_course_id uuid, p_area text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); c record; v_holes jsonb; v_id uuid; v_base text; v_slug text; v_n int := 1;
        v_lat double precision; v_lng double precision; e record; v_area text := nullif(left(btrim(coalesce(p_area, '')), 80), '');
        v_key text;
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

  if e.id is null then
    -- A listing with no scorecard yet, same course name, close by (or the only one with that name): fill it.
    v_key := private.course_key(c.name);
    if length(v_key) >= 3 then
      select * into e from public.course_library l
       where jsonb_array_length(l.holes) = 0 and l.source_group_id is null and l.club_id is null and not l.hidden
         and private.course_key(l.name) = v_key
         and (private.km(l.lat, l.lng, v_lat, v_lng) < 5
              or (v_lat is null and (select count(*) from public.course_library z where jsonb_array_length(z.holes) = 0 and not z.hidden
                                     and private.course_key(z.name) = v_key) = 1))
       order by private.km(l.lat, l.lng, v_lat, v_lng) nulls last limit 1 for update;
      if e.id is not null then
        update public.course_library set holes = v_holes, area = coalesce(area, v_area),
          osm = osm or exists (select 1 from jsonb_array_elements(v_holes) h where (h ->> 'osm')::boolean),
          lat = coalesce(lat, v_lat), lng = coalesce(lng, v_lng), source_group_id = v_g, source_course_id = c.id, updated_at = now()
        where id = e.id;
        perform set_config('lgc.library_link', 'on', true);
        update public.courses set library_id = e.id where id = c.id;
        perform set_config('lgc.library_link', 'off', true);
        return e.id;
      end if;
    end if;
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
        holes = v_holes, osm = (osm_ref is not null) or exists (select 1 from jsonb_array_elements(v_holes) h where (h ->> 'osm')::boolean),
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
