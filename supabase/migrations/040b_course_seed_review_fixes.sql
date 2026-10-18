-- 040b — Stage 8b part 4 review fixes. Additive (replaced function bodies).

-- 1. A listing's course page sends an empty list of holes (not nothing), so every phone — old ones too — shows it.
create or replace function public.course_page(p_slug text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('id', l.id, 'slug', l.slug, 'name', l.name, 'area', l.area, 'lat', l.lat, 'lng', l.lng, 'osm', l.osm,
           'verified', l.verified,
           'club', (select json_build_object('name', c.name, 'logo_url', c.logo_url, 'booking_email', c.booking_email,
                                             'booking_phone', c.booking_phone, 'booking_note', c.booking_note, 'offers', c.offers)
                    from public.clubs c where c.id = l.club_id),
           'holes', coalesce((select json_agg(json_strip_nulls(json_build_object('n', h -> 'n', 'par', h -> 'par', 'si', h -> 'si', 'green', h -> 'green', 'tee', h -> 'tee', 'osm', h -> 'osm')) order by (h ->> 'n')::int)
                     from jsonb_array_elements(l.holes) h), '[]'::json))
  from public.course_library l where l.slug = lower(btrim(p_slug)) and not l.hidden;
$$;

-- 2 & 3. Matching: only ever with a known map position, close by, and never a hidden entry. A listing's name stays
--        OpenStreetMap's (a group that fills it can't rename it); junk names like "Golf Club" are skipped.
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
    begin v_lat := (x ->> 'lat')::double precision; v_lng := (x ->> 'lng')::double precision;
    exception when others then v_lat := null; v_lng := null; end;
    v_key := private.course_key(v_name);
    if v_ref is null or v_ref !~ '^[wr][0-9]{1,15}$' or length(v_name) < 2 or length(v_key) < 3
       or v_lat is null or v_lng is null or v_lat not between -45 and -9 or v_lng not between 112 and 155 then
      sk := sk + 1; continue;
    end if;
    v_holes := null;
    if jsonb_typeof(x -> 'holes') = 'array' then
      begin v_holes := private.clean_holes(x -> 'holes'); exception when others then v_holes := null; end;
    end if;

    select * into e from public.course_library where osm_ref = v_ref;
    if e.id is null then
      select * into e from public.course_library l
       where l.osm_ref is null and not l.hidden and l.lat is not null
         and private.course_key(l.name) = v_key and private.km(l.lat, l.lng, v_lat, v_lng) < 5
       order by private.km(l.lat, l.lng, v_lat, v_lng) limit 1;
      if e.id is not null then
        update public.course_library set osm_ref = v_ref, area = coalesce(area, v_area) where id = e.id;
        m := m + 1; continue;
      end if;
    end if;

    if e.id is not null then
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

-- The message when a listing can't be added doesn't promise something that can't happen (a claimed listing is filled
-- by its club).
create or replace function private.courses_need_scorecard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.library_id is not null and jsonb_array_length(coalesce(new.holes, '[]'::jsonb)) = 0 then
    raise exception 'This course has no scorecard yet — add it as a new course with its pars from the scorecard';
  end if;
  return new;
end $$;

-- 2. Sharing fills a listing only when the group's course is mapped and close by, or (not mapped) the town given when
--    sharing is the listing's own area. Filling a listing never renames it.
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
    v_key := private.course_key(c.name);
    if length(v_key) >= 3 then
      select * into e from public.course_library l
       where jsonb_array_length(l.holes) = 0 and l.source_group_id is null and l.club_id is null and not l.hidden
         and private.course_key(l.name) = v_key
         and ((v_lat is not null and private.km(l.lat, l.lng, v_lat, v_lng) < 5)
              or (v_lat is null and v_area is not null and lower(btrim(l.area)) = lower(v_area)))
       order by private.km(l.lat, l.lng, v_lat, v_lng) nulls last limit 1 for update;
      if e.id is not null then
        update public.course_library set holes = v_holes,
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
      update public.course_library set holes = private.fill_points(holes, v_holes), area = coalesce(area, v_area),
        osm = osm or exists (select 1 from jsonb_array_elements(private.fill_points(holes, v_holes)) h where (h ->> 'osm')::boolean),
        lat = coalesce(lat, v_lat), lng = coalesce(lng, v_lng), updated_at = now()
      where id = e.id;
    else
      update public.course_library set name = case when osm_ref is not null then name else left(btrim(c.name), 80) end,
        area = case when osm_ref is not null then coalesce(area, v_area) else coalesce(v_area, area) end,
        holes = v_holes, osm = (osm_ref is not null) or exists (select 1 from jsonb_array_elements(v_holes) h where (h ->> 'osm')::boolean),
        lat = case when osm_ref is not null then coalesce(lat, v_lat) else coalesce(v_lat, lat) end,
        lng = case when osm_ref is not null then coalesce(lng, v_lng) else coalesce(v_lng, lng) end, updated_at = now()
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

-- 7. The junk listing seeded before this fix ("Golf Club") is hidden, not removed.
update public.course_library set hidden = true
where osm_ref is not null and length(private.course_key(name)) < 3 and club_id is null and source_group_id is null and copies = 0;
