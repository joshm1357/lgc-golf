-- 037 — Stage 8b part 1: club partners — claiming a course, Josh approving by hand, the club's own page details.
-- Additive: five new tables (no direct access from the app — functions only), one column on course_library, functions.
--
-- Privacy rule (addendum): a club never sees players' names, scores or locations. Nothing here gives a club any
-- group's data; the club only edits its course's details and its own profile. (Counts come in part 2; TV in part 3.)
--
-- STOPs that still apply: Josh approves each claim by hand, and the first real one waits for him. Club accounts need a
-- real sign-in (Google or email), so the Stage 2 sign-in STOP comes first; claims are refused for phone-only users.

-- ------------------------------------------------------------------ Josh (and anyone he adds) runs the platform
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;
-- Josh adds himself once, in the SQL editor:  insert into public.platform_admins (user_id) values ('<his user id>');

create or replace function private.is_platform_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
revoke all on function private.is_platform_admin() from public, anon;

-- ------------------------------------------------------------------ Clubs
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 80),
  ref text not null unique check (ref ~ '^[A-Z0-9]{4,12}$'),     -- the code its QR kit carries
  logo_url text check (logo_url is null or length(logo_url) <= 300),
  booking_email text check (booking_email is null or (length(booking_email) <= 120 and booking_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  booking_phone text check (booking_phone is null or length(booking_phone) <= 30),
  booking_note text check (booking_note is null or length(booking_note) <= 400),
  offers text check (offers is null or length(offers) <= 600),
  created_at timestamptz not null default now()
);
alter table public.clubs enable row level security;
revoke all on public.clubs from anon, authenticated;

create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
alter table public.club_members enable row level security;
revoke all on public.club_members from anon, authenticated;

alter table public.course_library add column if not exists club_id uuid references public.clubs(id) on delete set null;
alter table public.course_library add column if not exists verified boolean not null default false;  -- hole data from the club

create table if not exists public.club_claims (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.course_library(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  club_name text not null check (length(club_name) between 2 and 80),
  contact_name text not null check (length(contact_name) between 2 and 80),
  contact_email text not null check (length(contact_email) <= 120 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text check (contact_phone is null or length(contact_phone) <= 30),
  role_at_club text check (role_at_club is null or length(role_at_club) <= 80),     -- e.g. "General manager"
  note text check (note is null or length(note) <= 600),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists club_claims_status_idx on public.club_claims (status, created_at);
alter table public.club_claims enable row level security;
revoke all on public.club_claims from anon, authenticated;

create or replace function private.club_of(p_user uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select club_id from public.club_members where user_id = p_user order by created_at limit 1;
$$;
revoke all on function private.club_of(uuid) from public, anon;

-- ------------------------------------------------------------------ Claiming a course
create or replace function public.request_club_claim(p_course_id uuid, p_club_name text, p_contact_name text, p_contact_email text,
                                                     p_contact_phone text, p_position text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or coalesce((select is_anonymous from auth.users where id = v_uid), true) then
    raise exception 'Sign in with Google or email first — a club account needs a proper sign-in';
  end if;
  if not exists (select 1 from public.course_library where id = p_course_id and not hidden) then raise exception 'That course isn''t in the library'; end if;
  if exists (select 1 from public.course_library where id = p_course_id and club_id is not null) then raise exception 'That course has already been claimed'; end if;
  if (select count(*) from public.club_claims where user_id = v_uid and created_at > now() - interval '1 day') >= 3 then
    raise exception 'That''s 3 claims today — Josh will be in touch about the ones you''ve sent';
  end if;
  if exists (select 1 from public.club_claims where user_id = v_uid and course_id = p_course_id and status = 'pending') then
    raise exception 'You''ve already asked to claim this course — Josh will be in touch';
  end if;
  insert into public.club_claims (course_id, user_id, club_name, contact_name, contact_email, contact_phone, role_at_club, note)
  values (p_course_id, v_uid, btrim(p_club_name), btrim(p_contact_name), lower(btrim(p_contact_email)),
          nullif(btrim(coalesce(p_contact_phone, '')), ''), nullif(btrim(coalesce(p_position, '')), ''), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

-- My claims and clubs (for the Club screen).
create or replace function public.my_club()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'signed_in', not coalesce((select is_anonymous from auth.users where id = auth.uid()), true),
    'platform_admin', private.is_platform_admin(),
    'club', (select json_build_object('id', c.id, 'name', c.name, 'ref', c.ref, 'logo_url', c.logo_url, 'booking_email', c.booking_email,
                                      'booking_phone', c.booking_phone, 'booking_note', c.booking_note, 'offers', c.offers,
                                      'courses', (select coalesce(json_agg(json_build_object('id', l.id, 'slug', l.slug, 'name', l.name, 'verified', l.verified) order by l.name), '[]'::json)
                                                  from public.course_library l where l.club_id = c.id))
             from public.clubs c where c.id = private.club_of(auth.uid())),
    'claims', (select coalesce(json_agg(json_build_object('id', k.id, 'course', l.name, 'status', k.status, 'created_at', k.created_at) order by k.created_at desc), '[]'::json)
               from public.club_claims k join public.course_library l on l.id = k.course_id where k.user_id = auth.uid()))
  where auth.uid() is not null;
$$;

-- ------------------------------------------------------------------ Josh decides (by hand, each one)
create or replace function public.admin_club_claims()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', k.id, 'course', l.name, 'course_slug', l.slug, 'area', l.area, 'claimed', l.club_id is not null,
           'club_name', k.club_name, 'contact_name', k.contact_name, 'contact_email', k.contact_email, 'contact_phone', k.contact_phone,
           'role_at_club', k.role_at_club, 'note', k.note, 'status', k.status, 'created_at', k.created_at,
           'signed_in_as', (select email from auth.users where id = k.user_id)) order by (k.status = 'pending') desc, k.created_at desc), '[]'::json)
  from public.club_claims k join public.course_library l on l.id = k.course_id
  where private.is_platform_admin();
$$;

create or replace function public.decide_club_claim(p_claim uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare k record; v_club uuid; v_ref text;
begin
  if not private.is_platform_admin() then raise exception 'Only Josh can decide claims'; end if;
  select * into k from public.club_claims where id = p_claim for update;
  if k.id is null or k.status <> 'pending' then raise exception 'That claim has already been decided'; end if;
  if not p_approve then
    update public.club_claims set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = k.id;
    return;
  end if;
  if exists (select 1 from public.course_library where id = k.course_id and club_id is not null) then raise exception 'That course has already been claimed'; end if;
  -- The person's existing club (a club with several courses), or a new one.
  v_club := private.club_of(k.user_id);
  if v_club is null then
    loop
      v_ref := upper(left(regexp_replace(k.club_name, '[^A-Za-z]', '', 'g'), 6)) || lpad((floor(random() * 1000))::int::text, 3, '0');
      if length(v_ref) < 4 then v_ref := 'CLUB' || lpad((floor(random() * 10000))::int::text, 4, '0'); end if;
      exit when not exists (select 1 from public.clubs where ref = v_ref);
    end loop;
    insert into public.clubs (name, ref) values (k.club_name, v_ref) returning id into v_club;
    insert into public.club_members (club_id, user_id) values (v_club, k.user_id);
  end if;
  update public.course_library set club_id = v_club where id = k.course_id;
  update public.club_claims set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = k.id;
  -- Any other pending claims for the same course are now moot.
  update public.club_claims set status = 'rejected', decided_by = auth.uid(), decided_at = now()
  where course_id = k.course_id and status = 'pending';
end $$;

-- ------------------------------------------------------------------ The club edits its own details
create or replace function public.club_update_profile(p_name text, p_logo_url text, p_booking_email text, p_booking_phone text,
                                                      p_booking_note text, p_offers text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid := private.club_of(auth.uid());
begin
  if v_club is null then raise exception 'Only a club account can do that'; end if;
  if p_logo_url is not null and p_logo_url !~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/photos/clubs/' || v_club::text || '/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$') then
    raise exception 'Upload the logo from this screen';
  end if;
  update public.clubs set name = btrim(p_name), logo_url = p_logo_url,
    booking_email = nullif(lower(btrim(coalesce(p_booking_email, ''))), ''), booking_phone = nullif(btrim(coalesce(p_booking_phone, '')), ''),
    booking_note = nullif(btrim(coalesce(p_booking_note, '')), ''), offers = nullif(btrim(coalesce(p_offers, '')), '')
  where id = v_club;
end $$;

-- Verified hole data: the club is the authority for par, stroke index, tees and greens. Groups' own copies don't change.
create or replace function public.club_update_course(p_course_id uuid, p_holes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid := private.club_of(auth.uid()); v_holes jsonb; v_lat double precision; v_lng double precision;
begin
  if v_club is null then raise exception 'Only a club account can do that'; end if;
  if not exists (select 1 from public.course_library where id = p_course_id and club_id = v_club) then raise exception 'That isn''t your club''s course'; end if;
  v_holes := private.clean_holes(p_holes);
  select lat, lng into v_lat, v_lng from private.course_centre(v_holes);
  perform set_config('lgc.club_edit', 'on', true);
  update public.course_library set holes = v_holes, verified = true,
    osm = exists (select 1 from jsonb_array_elements(v_holes) h where (h ->> 'osm')::boolean),
    lat = coalesce(v_lat, lat), lng = coalesce(v_lng, lng), updated_at = now()
  where id = p_course_id;
  perform set_config('lgc.club_edit', 'off', true);
end $$;

-- Group shares never overwrite a club's verified course: they can only fill missing points (as for copied entries).
create or replace function private.protect_verified() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.verified and coalesce(current_setting('lgc.club_edit', true), '') <> 'on' then
    new.name := old.name;
    new.holes := private.fill_points(old.holes, new.holes);
    new.verified := true;
    new.club_id := old.club_id;
  end if;
  return new;
end $$;
create or replace trigger aa_course_library_protect_verified before update on public.course_library
  for each row execute function private.protect_verified();

revoke all on function public.request_club_claim(uuid, text, text, text, text, text, text), public.my_club(), public.admin_club_claims(),
  public.decide_club_claim(uuid, boolean), public.club_update_profile(text, text, text, text, text, text), public.club_update_course(uuid, jsonb)
  from public, anon;
grant execute on function public.request_club_claim(uuid, text, text, text, text, text, text), public.my_club(), public.admin_club_claims(),
  public.decide_club_claim(uuid, boolean), public.club_update_profile(text, text, text, text, text, text), public.club_update_course(uuid, jsonb)
  to authenticated;

-- A club uploads its logo to photos/clubs/<club id>/… (the 022 rule plus the club's own folder).
create or replace function private.photo_path_ok(p_name text, p_organiser boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_first text := split_part(p_name, '/', 1); v_g uuid;
begin
  if v_first = 'clubs' then
    return split_part(p_name, '/', 2) = coalesce(private.club_of(auth.uid())::text, '-');
  end if;
  if v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_g := v_first::uuid;
  elsif v_first in ('avatars', 'feed', 'comps', 'tribunal') then
    v_g := private.legacy_group();
  else
    return false;
  end if;
  return case when p_organiser then private.is_group_organiser(v_g) else private.is_group_member(v_g) end;
end $$;

-- The public course page also shows the club's details when it's a partner course (the 036 version plus "club").
create or replace function public.course_page(p_slug text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('id', l.id, 'slug', l.slug, 'name', l.name, 'area', l.area, 'lat', l.lat, 'lng', l.lng, 'osm', l.osm,
           'verified', l.verified,
           'club', (select json_build_object('name', c.name, 'logo_url', c.logo_url, 'booking_email', c.booking_email,
                                             'booking_phone', c.booking_phone, 'booking_note', c.booking_note, 'offers', c.offers)
                    from public.clubs c where c.id = l.club_id),
           'holes', (select json_agg(json_strip_nulls(json_build_object('n', h -> 'n', 'par', h -> 'par', 'si', h -> 'si', 'green', h -> 'green', 'tee', h -> 'tee', 'osm', h -> 'osm')) order by (h ->> 'n')::int)
                     from jsonb_array_elements(l.holes) h))
  from public.course_library l where l.slug = lower(btrim(p_slug)) and not l.hidden;
$$;

-- Search with the partner label. Partner courses are labelled, never ranked above the others or used to hide them.
create or replace function public.find_courses(p_query text default '', p_lat double precision default null, p_lng double precision default null, p_limit int default 20)
returns table (id uuid, slug text, name text, area text, holes int, greens int, osm boolean, copies int, km numeric, partner boolean, verified boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.slug, s.name, s.area, s.holes, s.greens, s.osm, s.copies, s.km, l.club_id is not null, l.verified
  from public.search_courses(p_query, p_lat, p_lng, p_limit) with ordinality as s(id, slug, name, area, holes, greens, osm, copies, km, ord)
  join public.course_library l on l.id = s.id
  order by s.ord;
$$;
revoke all on function public.find_courses(text, double precision, double precision, int) from public, anon;
grant execute on function public.find_courses(text, double precision, double precision, int) to authenticated;
