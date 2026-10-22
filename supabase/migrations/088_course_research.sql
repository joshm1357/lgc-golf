-- 088 — Course research (ov17, 22 Oct 2026). Additive only: two new tables, one index, a run log, helper functions and
-- the import function. Nothing existing changes, so old phones are unaffected. STAGING first — live after Josh's OK.
--
-- Josh's research (455 Australian courses and a region guide) so the AI planner, the course pages and the trip
-- builder give real, practical advice: how a group actually gets a game (access type and route), member times to
-- avoid, fees, how to book, stay-and-play, how good it is for groups.
--
--   * course_research — one row a researched course. Typed columns where the text was clear (fees, holes, par, drive
--     hours from Sydney, access type, good for groups 1–5 …); everything else as written in `details`. Linked to the
--     course library where it matches (library_id). Re-importing a newer file updates rows by import_key (the name
--     without "Golf Club" etc. | state), never adds a second one.
--   * region_guides — the guide's general sections (access types, member times, booking platforms and deal sites) and
--     one row a region section, keyed so a re-import replaces them.
-- Both are shared reference data (not any group's data): anyone signed in reads them; only the import function writes
-- (the platform admin, or the service role). Club phone numbers, emails and links are the clubs' published business
-- details. (The existing course_facts table — 063, facts suggested by organisers — is a different thing and untouched.)

-- ------------------------------------------------------------------ Tables
create table if not exists public.course_research (
  id uuid primary key default gen_random_uuid(),
  import_key text not null unique check (import_key ~ '^[a-z0-9]{1,100}\|(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)(\|[a-z0-9]{1,60})?$'),
  library_id uuid references public.course_library(id) on delete set null,
  match text not null default 'unmatched' check (match in ('exact', 'near', 'new', 'unmatched')),
  name text not null check (length(name) between 2 and 120),
  town text check (town is null or length(town) <= 80),
  state text not null check (state in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT')),
  region text check (region is null or length(region) <= 80),
  holes int check (holes is null or holes between 1 and 72),
  par int check (par is null or par between 27 and 80),
  fee_weekday numeric(7,2) check (fee_weekday is null or fee_weekday between 0 and 2000),
  fee_weekend numeric(7,2) check (fee_weekend is null or fee_weekend between 0 and 2000),
  cart_required boolean,
  access_type text check (access_type is null or access_type in ('public', 'semi_private', 'handicap_visitor', 'stay_and_play_only',
                                                                   'corporate_or_event', 'member_intro_only', 'closed')),
  good_for_groups int check (good_for_groups is null or good_for_groups between 1 and 5),
  drive_from_sydney_hours numeric(4,2) check (drive_from_sydney_hours is null or drive_from_sydney_hours between 0 and 30),
  booking_url text check (booking_url is null or (length(booking_url) <= 400 and booking_url ~* '^https?://')),
  group_enquiry_url text check (group_enquiry_url is null or (length(group_enquiry_url) <= 400 and group_enquiry_url ~* '^https?://')),
  website text check (website is null or (length(website) <= 400 and website ~* '^https?://')),
  phone text check (phone is null or length(phone) <= 200),
  email text check (email is null or length(email) <= 200),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  sources text[] not null default '{}' check (cardinality(sources) <= 30),
  last_checked date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists course_research_library_idx on public.course_research (library_id);
create index if not exists course_research_region_idx on public.course_research (state, region);
alter table public.course_research enable row level security;
revoke all on public.course_research from anon, authenticated;
grant select on public.course_research to authenticated;
create policy "signed in read" on public.course_research for select to authenticated using ((select auth.uid()) is not null);

create table if not exists public.region_guides (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  kind text not null check (kind in ('general', 'region')),
  title text not null check (length(title) between 2 and 120),
  state text check (state is null or state ~ '^(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)(/(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)){0,7}$'),
  regions text[] not null default '{}' check (cardinality(regions) <= 60),   -- the dataset's regions this section covers
  body text not null check (length(body) between 1 and 40000),              -- markdown, as written
  sort int not null default 0,
  active boolean not null default true,                                      -- false: no longer in the latest guide (kept, not deleted)
  updated_at timestamptz not null default now()
);
alter table public.region_guides enable row level security;
revoke all on public.region_guides from anon, authenticated;
grant select on public.region_guides to authenticated;
create policy "signed in read" on public.region_guides for select to authenticated using ((select auth.uid()) is not null);

-- A record of each import call, for Josh (counts only).
create table if not exists private.course_research_runs (
  id bigint generated always as identity primary key,
  rows_in int not null, inserted int not null, updated int not null, unchanged int not null,
  exact int not null, near int not null, added int not null, unmatched int not null, guides int not null,
  ran_at timestamptz not null default now()
);
revoke all on private.course_research_runs from public, anon, authenticated;

-- Matching by name is quick: the library's names without "Golf Club" etc. (private.course_key, 040), indexed.
create index if not exists course_library_course_key_idx on public.course_library (private.course_key(name));

-- "Bowral NSW" → 'NSW' and 'bowral'.
create or replace function private.area_state(p_area text) returns text language sql immutable set search_path = '' as $$
  select upper((regexp_match(coalesce(p_area, ''), '(?:^|[\s,])(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s*$', 'i'))[1]);
$$;
create or replace function private.town_key(p_town text) returns text language sql immutable set search_path = '' as $$
  select regexp_replace(replace(lower(coalesce(p_town, '')), '&', 'and'), '[^a-z0-9]+', '', 'g');
$$;
create or replace function private.area_town(p_area text) returns text language sql immutable set search_path = '' as $$
  select private.town_key(regexp_replace(coalesce(p_area, ''), '[\s,]*\m(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s*$', '', 'i'));
$$;
create or replace function private.research_url(p jsonb) returns text language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'string' and length(p #>> '{}') <= 400 and (p #>> '{}') ~* '^https?://[^\s]+$' then p #>> '{}' end;
$$;
create or replace function private.research_num(p jsonb, lo numeric, hi numeric) returns numeric language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric between lo and hi then (p #>> '{}')::numeric end;
$$;
create or replace function private.research_text(p jsonb, n int) returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(case when jsonb_typeof(p) in ('string', 'number') then p #>> '{}' else '' end, '[[:cntrl:]]+', ' ', 'g')), n), '');
$$;
revoke all on function private.area_state(text), private.town_key(text), private.area_town(text), private.research_url(jsonb),
  private.research_num(jsonb, numeric, numeric), private.research_text(jsonb, int) from public, anon, authenticated;

-- ------------------------------------------------------------------ Matching one researched course to the library
-- p_keys: the names to try, already without "Golf Club" etc. (the importer's matchKeys: the name, and a single name in
-- brackets). p_towns: the towns to try (townKeys: "Marrangaroo (Lithgow)" → marrangaroo, lithgow).
-- exact: same name, same state, same town. near: same name and state in another town (the nearest to the row's town
-- when there are several), or one name contains the other in the same town. → (library id, 'exact' | 'near') or nothing.
-- The same rules as matchCourse() in scripts/research/parse.js.
create or replace function private.town_hit(p_area_town text, p_towns text[]) returns boolean language sql immutable set search_path = '' as $$
  select p_area_town <> '' and exists (select 1 from unnest(p_towns) t
    where t <> '' and (p_area_town = t or p_area_town like t || '%' or t like p_area_town || '%'));
$$;
revoke all on function private.town_hit(text, text[]) from public, anon, authenticated;

create or replace function private.match_course_research(p_keys text[], p_state text, p_towns text[], out o_id uuid, out o_match text)
language plpgsql stable security definer set search_path = '' as $$
declare v_lat double precision; v_lng double precision;
begin
  if coalesce(cardinality(p_keys), 0) = 0 then return; end if;
  select l.id into o_id from public.course_library l
   where private.course_key(l.name) = any (p_keys) and not l.hidden and private.area_state(l.area) = p_state
     and private.town_hit(private.area_town(l.area), p_towns) and l.name !~* 'driving range'
   order by array_position(p_keys, private.course_key(l.name)), (private.area_town(l.area) = any (p_towns)) desc, l.name, l.id limit 1;
  if o_id is not null then o_match := 'exact'; return; end if;
  -- Same name in another town: OpenStreetMap often names the suburb next door. When the library knows where the row's
  -- town is (other courses there), only within 40 km of it — "Wentworth GC, Orange" isn't the one at Wentworth.
  select avg(l.lat), avg(l.lng) into v_lat, v_lng from public.course_library l
   where l.lat is not null and private.area_state(l.area) = p_state and private.area_town(l.area) = any (p_towns);
  select l.id into o_id from public.course_library l
   where private.course_key(l.name) = any (p_keys) and not l.hidden and private.area_state(l.area) = p_state
     and l.name !~* 'driving range' and coalesce(private.km(l.lat, l.lng, v_lat, v_lng), 0) < 40
   order by array_position(p_keys, private.course_key(l.name)), private.km(l.lat, l.lng, v_lat, v_lng) nulls last, l.name, l.id limit 1;
  if o_id is not null then o_match := 'near'; return; end if;
  select l.id into o_id from public.course_library l
   where not l.hidden and private.area_state(l.area) = p_state and length(private.course_key(l.name)) >= 5 and l.name !~* 'driving range'
     and exists (select 1 from unnest(p_keys) k where length(k) >= 5
                 and (strpos(private.course_key(l.name), k) > 0 or strpos(k, private.course_key(l.name)) > 0))
     and private.town_hit(private.area_town(l.area), p_towns)
   order by length(private.course_key(l.name)), l.name, l.id limit 1;
  if o_id is not null then o_match := 'near'; end if;
end $$;
revoke all on function private.match_course_research(text[], text, text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ The import (platform admin or service role)
-- p_rows: the rows from scripts/import-course-research.mjs — a list of objects, or the compact form
--   { "c": [column names], "r": [[values] …] } where a column "d.<name>" goes into details.
-- p_guides: the guide's sections [{ key, kind, title, state, regions, body, sort }], or null to leave the guides alone.
--   When given, every key in it is replaced, and any section no longer in the guide is switched off (active = false;
--   nothing is deleted, so an import can never lose text).
-- Rows are upserted by import_key: a re-run with a newer file updates what changed and never duplicates. A row is only
-- (re)matched while it has no library course; a course that isn't in the library and isn't closed is added as a
-- LISTING (name and area, no holes, no map position — like 040's listings) and marked 'new'.
create or replace function public.import_course_research(p_rows jsonb, p_guides jsonb default null)
returns json language plpgsql security definer set search_path = '' as $$
declare v_rows jsonb := p_rows; x jsonb; e public.course_research; v_details jsonb; v_sources text[];
        v_key text; v_name text; v_state text; v_town text; v_access text; v_lib uuid; v_match text;
        v_base text; v_slug text; v_n int; v_changed boolean; v_mkeys text[]; v_mtowns text[]; v_listing text; v_area text;
        n_in int := 0; n_ins int := 0; n_upd int := 0; n_same int := 0; n_exact int := 0; n_near int := 0; n_new int := 0; n_un int := 0;
        v_unmatched text[] := '{}'; g jsonb; n_g int := 0; n_g_removed int := 0; v_keys text[] := '{}';
begin
  if not (coalesce(auth.role(), '') = 'service_role' or (auth.uid() is not null and private.is_platform_admin())) then
    raise exception 'Only the app''s team can import course research';
  end if;

  -- The compact form → a list of objects.
  if jsonb_typeof(v_rows) = 'object' then
    if jsonb_typeof(v_rows -> 'c') <> 'array' or jsonb_typeof(v_rows -> 'r') <> 'array' then raise exception 'Bad rows'; end if;
    select coalesce(jsonb_agg(o), '[]'::jsonb) into v_rows from (
      select (select coalesce(jsonb_object_agg(c.v #>> '{}', r.v -> (c.i::int - 1)), '{}'::jsonb)
                from jsonb_array_elements(v_rows -> 'c') with ordinality c(v, i)
               where coalesce(r.v -> (c.i::int - 1), 'null'::jsonb) <> 'null'::jsonb) o
      from jsonb_array_elements(v_rows -> 'r') r(v)) s;
  end if;
  if v_rows is null then v_rows := '[]'::jsonb; end if;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) > 1000 then raise exception 'Bad rows'; end if;

  for x in select * from jsonb_array_elements(v_rows) loop
    n_in := n_in + 1;
    v_key := x ->> 'import_key';
    v_name := private.research_text(x -> 'name', 120);
    v_state := upper(coalesce(x ->> 'state', ''));
    if v_key is null or v_key !~ '^[a-z0-9]{1,100}\|(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)(\|[a-z0-9]{1,60})?$'
       or v_name is null or length(v_name) < 2 or split_part(v_key, '|', 2) <> v_state then
      raise exception 'Bad row %: %', n_in, left(coalesce(x ->> 'name', '?'), 60);
    end if;
    v_town := private.research_text(x -> 'town', 80);
    v_access := case when x ->> 'access_type' in ('public', 'semi_private', 'handicap_visitor', 'stay_and_play_only', 'corporate_or_event',
                                                  'member_intro_only', 'closed') then x ->> 'access_type' end;
    -- details: an object of short texts (from "details", or the compact form's "d.<name>" columns).
    select coalesce(jsonb_object_agg(left(k, 60), to_jsonb(left(btrim(regexp_replace(v #>> '{}', '[[:cntrl:]]+', ' ', 'g')), 2000))), '{}'::jsonb)
      into v_details
      from (select j.key, j.value from jsonb_each(case when jsonb_typeof(x -> 'details') = 'object' then x -> 'details' else '{}'::jsonb end) j
            union all
            select substr(j.key, 3), j.value from jsonb_each(x) j where j.key like 'd.%') d(k, v)
     where jsonb_typeof(v) in ('string', 'number') and btrim(v #>> '{}') <> '';
    select coalesce(array_agg(u order by i), '{}') into v_sources from (
      select private.research_url(s) u, i from jsonb_array_elements(case when jsonb_typeof(x -> 'sources') = 'array' then x -> 'sources' else '[]'::jsonb end)
        with ordinality t(s, i) limit 30) q where u is not null;

    select * into e from public.course_research where import_key = v_key for update;
    v_lib := e.library_id; v_match := e.match;
    if v_lib is null then
      -- The names and towns to try (from the importer), else the name and town as they are.
      select coalesce(array_agg(k #>> '{}') filter (where (k #>> '{}') ~ '^[a-z0-9]{3,100}$'), '{}') into v_mkeys
        from (select k from jsonb_array_elements(case when jsonb_typeof(x -> 'match_keys') = 'array' then x -> 'match_keys' else '[]'::jsonb end) k limit 4) q;
      if cardinality(v_mkeys) = 0 and length(private.course_key(v_name)) >= 3 then v_mkeys := array[private.course_key(v_name)]; end if;
      select coalesce(array_agg(t #>> '{}') filter (where (t #>> '{}') ~ '^[a-z0-9]{3,80}$'), '{}') into v_mtowns
        from (select t from jsonb_array_elements(case when jsonb_typeof(x -> 'match_towns') = 'array' then x -> 'match_towns' else '[]'::jsonb end) t limit 6) q;
      if cardinality(v_mtowns) = 0 and length(private.town_key(v_town)) >= 3 then v_mtowns := array[private.town_key(v_town)]; end if;
      select o_id, o_match into v_lib, v_match from private.match_course_research(v_mkeys, v_state, v_mtowns);
      if v_lib is null and coalesce(v_access, '') <> 'closed' and cardinality(v_mkeys) > 0 and v_name !~* '\mnote only\M' then
        -- Not in the library: add it as a listing (no holes, no map position). Its name without a "?", its area the
        -- first town named (no brackets, no street numbers) and the state, e.g. "Lismore NSW".
        v_listing := btrim(regexp_replace(v_name, '\s*\?\s*', ' ', 'g'));
        v_area := nullif(btrim(split_part(split_part(regexp_replace(regexp_replace(coalesce(v_town, ''), '\([^)]*\)?', ' ', 'g'), '\?', ' ', 'g'), '/', 1), ',', 1)), '');
        if v_area ~ '[0-9]' then v_area := null; end if;
        v_base := btrim(left(btrim(regexp_replace(lower(v_listing), '[^a-z0-9]+', '-', 'g'), '-'), 50), '-');
        if length(v_base) < 2 then v_base := 'course'; end if;
        v_n := 1;
        loop
          v_slug := case when v_n = 1 then v_base when v_n = 2 then v_base || '-' || lower(v_state) else v_base || '-' || v_n end;
          if not exists (select 1 from public.course_library where slug = v_slug) then
            begin
              insert into public.course_library (slug, name, area, lat, lng, holes, osm)
              values (v_slug, left(v_listing, 80), left(concat_ws(' ', v_area, v_state), 80), null, null, '[]'::jsonb, false)
              returning id into v_lib;
              exit;
            exception when unique_violation then null;
            end;
          end if;
          v_n := v_n + 1;
          if v_n > 50 then exit; end if;
        end loop;
        v_match := case when v_lib is not null then 'new' else 'unmatched' end;
      elsif v_lib is null then
        v_match := 'unmatched';
      end if;
    end if;

    if e.id is null then
      insert into public.course_research (import_key, library_id, match, name, town, state, region, holes, par, fee_weekday, fee_weekend,
        cart_required, access_type, good_for_groups, drive_from_sydney_hours, booking_url, group_enquiry_url, website, phone, email,
        details, sources, last_checked)
      values (v_key, v_lib, v_match, v_name, v_town, v_state, private.research_text(x -> 'region', 80),
        private.research_num(x -> 'holes', 1, 72)::int, private.research_num(x -> 'par', 27, 80)::int,
        private.research_num(x -> 'fee_weekday', 0, 2000), private.research_num(x -> 'fee_weekend', 0, 2000),
        case when jsonb_typeof(x -> 'cart_required') = 'boolean' then (x ->> 'cart_required')::boolean end, v_access,
        private.research_num(x -> 'good_for_groups', 1, 5)::int, private.research_num(x -> 'drive_from_sydney_hours', 0, 30),
        private.research_url(x -> 'booking_url'), private.research_url(x -> 'group_enquiry_url'), private.research_url(x -> 'website'),
        private.research_text(x -> 'phone', 200), private.research_text(x -> 'email', 200), v_details, v_sources,
        case when x ->> 'last_checked' ~ '^\d{4}-\d{2}-\d{2}$' then (x ->> 'last_checked')::date end);
      n_ins := n_ins + 1;
    else
      update public.course_research r set
        library_id = v_lib, match = v_match, name = v_name, town = v_town, state = v_state, region = private.research_text(x -> 'region', 80),
        holes = private.research_num(x -> 'holes', 1, 72)::int, par = private.research_num(x -> 'par', 27, 80)::int,
        fee_weekday = private.research_num(x -> 'fee_weekday', 0, 2000), fee_weekend = private.research_num(x -> 'fee_weekend', 0, 2000),
        cart_required = case when jsonb_typeof(x -> 'cart_required') = 'boolean' then (x ->> 'cart_required')::boolean end,
        access_type = v_access, good_for_groups = private.research_num(x -> 'good_for_groups', 1, 5)::int,
        drive_from_sydney_hours = private.research_num(x -> 'drive_from_sydney_hours', 0, 30),
        booking_url = private.research_url(x -> 'booking_url'), group_enquiry_url = private.research_url(x -> 'group_enquiry_url'),
        website = private.research_url(x -> 'website'), phone = private.research_text(x -> 'phone', 200), email = private.research_text(x -> 'email', 200),
        details = v_details, sources = v_sources,
        last_checked = case when x ->> 'last_checked' ~ '^\d{4}-\d{2}-\d{2}$' then (x ->> 'last_checked')::date end
      where r.id = e.id
      returning (r.library_id, r.match, r.name, r.town, r.region, r.holes, r.par, r.fee_weekday, r.fee_weekend, r.cart_required, r.access_type,
                 r.good_for_groups, r.drive_from_sydney_hours, r.booking_url, r.group_enquiry_url, r.website, r.phone, r.email, r.details,
                 r.sources, r.last_checked)
             is distinct from
             (e.library_id, e.match, e.name, e.town, e.region, e.holes, e.par, e.fee_weekday, e.fee_weekend, e.cart_required, e.access_type,
              e.good_for_groups, e.drive_from_sydney_hours, e.booking_url, e.group_enquiry_url, e.website, e.phone, e.email, e.details,
              e.sources, e.last_checked)
        into v_changed;
      if v_changed then
        update public.course_research set updated_at = now() where id = e.id;
        n_upd := n_upd + 1;
      else
        n_same := n_same + 1;
      end if;
    end if;
    case v_match when 'exact' then n_exact := n_exact + 1; when 'near' then n_near := n_near + 1; when 'new' then n_new := n_new + 1;
      else n_un := n_un + 1; v_unmatched := v_unmatched || concat(v_name, ' (', coalesce(v_town || ' ', ''), v_state, ')'); end case;
  end loop;

  -- The guide: replace by key; sections no longer in it are switched off (never deleted).
  if jsonb_typeof(p_guides) = 'array' and jsonb_array_length(p_guides) > 0 then
    if jsonb_array_length(p_guides) > 200 then raise exception 'Bad guides'; end if;
    for g in select * from jsonb_array_elements(p_guides) loop
      if coalesce(g ->> 'key', '') !~ '^[a-z0-9][a-z0-9-]{1,60}$' or g ->> 'kind' not in ('general', 'region')
         or private.research_text(g -> 'title', 120) is null or coalesce(length(g ->> 'body'), 0) not between 1 and 40000 then
        raise exception 'Bad guide section: %', left(coalesce(g ->> 'key', '?'), 60);
      end if;
      insert into public.region_guides as t (key, kind, title, state, regions, body, sort, active, updated_at)
      values (g ->> 'key', g ->> 'kind', private.research_text(g -> 'title', 120),
              case when g ->> 'state' ~ '^(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)(/(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)){0,7}$' then g ->> 'state' end,
              coalesce((select array_agg(left(r #>> '{}', 80)) from (select r from jsonb_array_elements(case when jsonb_typeof(g -> 'regions') = 'array' then g -> 'regions' else '[]'::jsonb end) r
                        where jsonb_typeof(r) = 'string' limit 60) q), '{}'),
              g ->> 'body', coalesce(private.research_num(g -> 'sort', -100000, 100000)::int, 0), true, now())
      on conflict (key) do update set kind = excluded.kind, title = excluded.title, state = excluded.state, regions = excluded.regions,
        body = excluded.body, sort = excluded.sort, active = true,
        updated_at = case when (t.kind, t.title, t.state, t.regions, t.body, t.sort, t.active) is distinct from
                               (excluded.kind, excluded.title, excluded.state, excluded.regions, excluded.body, excluded.sort, true)
                          then now() else t.updated_at end;
      v_keys := v_keys || (g ->> 'key');
      n_g := n_g + 1;
    end loop;
    update public.region_guides set active = false, updated_at = now() where active and not (key = any (v_keys));
    get diagnostics n_g_removed = row_count;
  end if;

  insert into private.course_research_runs (rows_in, inserted, updated, unchanged, exact, near, added, unmatched, guides)
  values (n_in, n_ins, n_upd, n_same, n_exact, n_near, n_new, n_un, n_g);
  return json_build_object('rows', n_in, 'inserted', n_ins, 'updated', n_upd, 'unchanged', n_same,
    'exact', n_exact, 'near', n_near, 'new', n_new, 'unmatched', n_un, 'unmatched_names', to_json(v_unmatched),
    'guides', n_g, 'guides_removed', n_g_removed);
end $$;
revoke all on function public.import_course_research(jsonb, jsonb) from public, anon;
grant execute on function public.import_course_research(jsonb, jsonb) to authenticated, service_role;   -- checked inside: platform admin only

-- How the research matched (Josh, after an import): counts, and the courses that didn't match.
create or replace function public.course_research_report()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if not (coalesce(auth.role(), '') = 'service_role' or (auth.uid() is not null and private.is_platform_admin())) then
    raise exception 'Only the app''s team can see this';
  end if;
  return json_build_object(
    'rows', (select count(*) from public.course_research),
    'by_match', (select json_object_agg(match, n) from (select match, count(*) n from public.course_research group by match) s),
    'unmatched', (select coalesce(json_agg(concat(name, ' (', coalesce(town || ' ', ''), state, ')') order by state, name), '[]'::json)
                  from public.course_research where match = 'unmatched'),
    'guides', (select count(*) from public.region_guides where active));
end $$;
revoke all on function public.course_research_report() from public, anon;
grant execute on function public.course_research_report() to authenticated, service_role;
