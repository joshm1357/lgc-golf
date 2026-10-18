-- 039b — Stage 8b review fixes. Additive (new columns, new functions, replaced function bodies, one new upload rule).

-- 1. Clubs can upload their logo. The old "members upload photos" rule only lets group members upload, and a club
--    account usually isn't in a group. This rule lets a club upload into its own folder, and nothing else.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'clubs upload their own logo') then
    create policy "clubs upload their own logo" on storage.objects for insert to authenticated
      with check (bucket_id = 'photos' and split_part(name, '/', 1) = 'clubs'
                  and split_part(name, '/', 2) = coalesce(private.club_of(auth.uid())::text, '-no-club-'));
  end if;
end $$;

-- 2. Nobody without a club can use the clubs/ folder; and the photos bucket only takes pictures, up to 12 MB (the
--    app shrinks photos to well under 1 MB; 12 MB is its own limit for the rare phone that can't shrink).
create or replace function private.photo_path_ok(p_name text, p_organiser boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_first text := split_part(p_name, '/', 1); v_g uuid; v_club uuid;
begin
  if v_first = 'clubs' then
    v_club := private.club_of(auth.uid());
    return v_club is not null and split_part(p_name, '/', 2) = v_club::text;
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
update storage.buckets set file_size_limit = 12 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
where id = 'photos' and file_size_limit is null;

-- 3. Saving checked hole data changes pars and stroke indexes only — every tee and green point is kept.
create or replace function public.club_update_course(p_course_id uuid, p_holes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid := private.club_of(auth.uid()); v_new jsonb; v_old jsonb; v_holes jsonb; v_lat double precision; v_lng double precision;
begin
  if v_club is null then raise exception 'Only a club account can do that'; end if;
  select holes into v_old from public.course_library where id = p_course_id and club_id = v_club for update;
  if v_old is null then raise exception 'That isn''t your club''s course'; end if;
  v_new := private.clean_holes(p_holes);
  if jsonb_array_length(v_old) = jsonb_array_length(v_new) then
    select jsonb_agg(o || jsonb_build_object('par', n -> 'par', 'si', n -> 'si') order by (o ->> 'n')::int) into v_holes
    from jsonb_array_elements(v_old) o join jsonb_array_elements(v_new) n on (n ->> 'n')::int = (o ->> 'n')::int;
    v_holes := private.fill_points(private.clean_holes(v_holes), v_new);
  else
    v_holes := v_new;
  end if;
  select lat, lng into v_lat, v_lng from private.course_centre(v_holes);
  perform set_config('lgc.club_edit', 'on', true);
  update public.course_library set holes = v_holes, verified = true,
    osm = osm or exists (select 1 from jsonb_array_elements(v_holes) h where (h ->> 'osm')::boolean),
    lat = coalesce(v_lat, lat), lng = coalesce(v_lng, lng), updated_at = now()
  where id = p_course_id;
  perform set_config('lgc.club_edit', 'off', true);
end $$;

-- 4. Checked courses: groups can't move them or change their area either; clearing the club (Josh unclaims it, or the
--    club is removed) goes through and the course goes back to unchecked.
create or replace function private.protect_verified() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.club_id is not null and new.club_id is null then
    new.verified := false;
    return new;
  end if;
  if old.verified and coalesce(current_setting('lgc.club_edit', true), '') <> 'on' then
    new.name := old.name;
    new.holes := private.fill_points(old.holes, new.holes);
    new.verified := true;
    new.club_id := old.club_id;
    new.area := coalesce(old.area, new.area);
    new.lat := coalesce(old.lat, new.lat);
    new.lng := coalesce(old.lng, new.lng);
  end if;
  return new;
end $$;

-- Josh can unclaim a course (the club keeps its account; the course page goes back to normal).
create or replace function public.admin_unclaim(p_claim uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_course uuid; v_user uuid;
begin
  if not private.is_platform_admin() then raise exception 'Only Josh can do that'; end if;
  select course_id, user_id into v_course, v_user from public.club_claims where id = p_claim and status = 'approved';
  if v_course is null then raise exception 'That claim isn''t approved'; end if;
  update public.course_library set club_id = null where id = v_course and club_id = private.club_of(v_user);
end $$;
revoke all on function public.admin_unclaim(uuid) from public, anon;
grant execute on function public.admin_unclaim(uuid) to authenticated;

create or replace function public.admin_club_claims()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', k.id, 'course', l.name, 'course_slug', l.slug, 'area', l.area, 'claimed', l.club_id is not null,
           'claimed_by_this', l.club_id is not null and l.club_id = private.club_of(k.user_id),
           'club_name', k.club_name, 'contact_name', k.contact_name, 'contact_email', k.contact_email, 'contact_phone', k.contact_phone,
           'role_at_club', k.role_at_club, 'note', k.note, 'status', k.status, 'created_at', k.created_at,
           'signed_in_as', (select email from auth.users where id = k.user_id)) order by (k.status = 'pending') desc, k.created_at desc), '[]'::json)
  from public.club_claims k join public.course_library l on l.id = k.course_id
  where private.is_platform_admin();
$$;

-- 5. Scans: counted per phone (a random mark the phone keeps, scrambled with the salt and the Sydney date), so a
--    clubhouse wifi isn't one person. The 20-a-day limit is per phone; a looser 300-a-day limit per internet address.
alter table public.scan_log add column if not exists ip_mark text;
create index if not exists scan_log_ip_idx on public.scan_log (ip_mark, created_at);

create or replace function public.count_scan(p_ref text, p_placement text, p_course_slug text default null, p_hole int default null, p_visitor text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_course uuid; v_visitor text; v_ip text; v_day text := (now() at time zone 'Australia/Sydney')::date::text;
        v_salt text := (select salt from private.scan_salt limit 1);
begin
  select id into v_club from public.clubs where ref = upper(left(btrim(coalesce(p_ref, '')), 12));
  if v_club is null or p_placement not in ('cart', 'par3', 'counter', 'tv', 'stay') then return; end if;
  select id into v_course from public.course_library where slug = lower(btrim(coalesce(p_course_slug, ''))) and club_id = v_club;
  v_ip := md5(coalesce(private.request_ip(), 'unknown') || v_day || v_salt);
  v_visitor := case when coalesce(p_visitor, '') ~ '^[A-Za-z0-9-]{8,64}$' then md5('v' || p_visitor || v_day || v_salt) else v_ip end;
  if (select count(*) from public.scan_log where visitor = v_visitor and created_at > now() - interval '1 day') >= 20 then return; end if;
  if (select count(*) from public.scan_log where ip_mark = v_ip and created_at > now() - interval '1 day') >= 300 then return; end if;
  insert into public.scan_log (club_id, course_id, placement, hole, visitor, ip_mark)
  values (v_club, v_course, p_placement, case when p_hole between 1 and 27 then p_hole end, v_visitor, v_ip);
end $$;
revoke all on function public.count_scan(text, text, text, int, text) from public;
grant execute on function public.count_scan(text, text, text, int, text) to anon, authenticated;

-- Phones on the earlier version keep working.
create or replace function public.log_scan(p_ref text, p_placement text, p_course_slug text default null, p_hole int default null)
returns void language sql security definer set search_path = '' as $$
  select public.count_scan(p_ref, p_placement, p_course_slug, p_hole, null);
$$;

-- 6. Club counts: only rounds at the club's own courses, inside the period; 30, 90 or 365 days only; and any number
--    of groups or rounds under 5 is shown as "fewer than 5" (-1), so nobody can watch one group's comings and goings.
create or replace function private.fewer_than_5(n bigint) returns int language sql immutable set search_path = '' as $$
  select case when n = 0 then 0 when n < 5 then -1 else n::int end;
$$;
revoke all on function private.fewer_than_5(bigint) from public, anon, authenticated;

create or replace function public.club_stats(p_days int default 90)
returns json language sql stable security definer set search_path = '' as $$
  with c as (select id, ref from public.clubs where id = private.club_of(auth.uid())),
       d as (select case when p_days in (30, 90, 365) then p_days else 90 end as n),
       since as (select now() - make_interval(days => (select n from d)) as t),
       lib as (select l.id from public.course_library l, c where l.club_id = c.id),
       r as (select r.id, r.group_id, r.play_date from public.rounds r join public.courses co on co.id = r.course_id
             where co.library_id in (select id from lib) and r.created_at > (select t from since)),
       g as (select gr.id, gr.quick, gr.source ->> 'placement' as placement from public.groups gr, c
             where gr.source ->> 'ref' = c.ref and gr.created_at > (select t from since))
  select json_build_object(
    'days', (select n from d),
    'scans', (select coalesce(json_object_agg(placement, n), '{}'::json) from
               (select placement, count(distinct visitor) n from public.scan_log, c
                where club_id = c.id and created_at > (select t from since) group by placement) x),
    'rounds_started', private.fewer_than_5((select count(*) from r)),
    'groups_created', private.fewer_than_5((select count(*) from g)),
    'groups_by_placement', (select coalesce(json_object_agg(coalesce(placement, 'other'), private.fewer_than_5(n)), '{}'::json) from
               (select placement, count(*) n from g group by placement) x),
    'groups_came_back', private.fewer_than_5((select count(*) from (select group_id from r group by group_id having count(distinct play_date) >= 2) x)),
    'trips_planned', private.fewer_than_5((select count(*) from public.plans p join g on g.id = p.group_id where p.created_at > (select t from since))),
    'made_official', private.fewer_than_5((select count(*) from g where not g.quick)))
  from c;
$$;

-- 7. The clubhouse TV needs the club's TV key in its link (on the kit), so it isn't open to anyone who guesses the
--    course name. The feed sends list positions, not database ids.
alter table public.clubs add column if not exists tv_key text not null default encode(extensions.gen_random_bytes(9), 'hex');

create or replace function public.my_club_tv_key()
returns text language sql stable security definer set search_path = '' as $$
  select tv_key from public.clubs where id = private.club_of(auth.uid());
$$;
revoke all on function public.my_club_tv_key() from public, anon;
grant execute on function public.my_club_tv_key() to authenticated;

create or replace function public.tv_board(p_slug text, p_key text)
returns json language sql stable security definer set search_path = '' as $$
  with l as (select l.id, l.name from public.course_library l join public.clubs c on c.id = l.club_id
             where l.slug = lower(btrim(p_slug)) and not l.hidden and c.tv_key = btrim(coalesce(p_key, ''))),
       today as (select (now() at time zone 'Australia/Sydney')::date as d),
       r as (select r.*, row_number() over (order by r.created_at) as pos from public.rounds r join public.courses c on c.id = r.course_id
             where c.library_id = (select id from l) and r.tv and r.status in ('live', 'locked')
               and r.play_date = (select d from today) and public.feature_on(r.group_id, 'clubhouse_tv')),
       ps as (select r.id as round_id, p.id as player_id, row_number() over (partition by r.id order by p.created_at, p.id) as pos,
                     coalesce(nullif(btrim(p.nickname), ''), split_part(btrim(p.name), ' ', 1)) as name
              from r join public.players p on p.group_id = r.group_id
              where p.id in (select player_id from public.round_players where round_id = r.id)
                 or p.id in (select tp.player_id from public.team_players tp join public.teams t on t.id = tp.team_id where t.round_id = r.id)),
       ts as (select t.round_id, t.id as team_id, t.handicap, row_number() over (partition by t.round_id order by t.created_at, t.id) as pos
              from public.teams t where t.round_id in (select id from r))
  select json_build_object('course', (select name from l), 'rounds', coalesce((select json_agg(json_build_object(
    'id', 'r' || r.pos, 'format', r.format, 'status', r.status,
    'holes', (select json_agg(json_build_object('n', h -> 'n', 'par', h -> 'par', 'si', h -> 'si') order by (h ->> 'n')::int)
              from public.courses c, jsonb_array_elements(c.holes) h where c.id = r.course_id),
    'round_players', (select coalesce(json_agg(json_build_object('player_id', 'p' || ps.pos, 'playing_handicap', rp.playing_handicap)), '[]'::json)
                      from public.round_players rp join ps on ps.round_id = r.id and ps.player_id = rp.player_id where rp.round_id = r.id),
    'players', (select coalesce(json_agg(json_build_object('id', 'p' || ps.pos, 'name', ps.name) order by ps.pos), '[]'::json) from ps where ps.round_id = r.id),
    'teams', (select coalesce(json_agg(json_build_object('id', 't' || ts.pos, 'handicap', ts.handicap,
                       'player_ids', (select coalesce(json_agg('p' || ps.pos), '[]'::json) from public.team_players tp join ps on ps.round_id = r.id and ps.player_id = tp.player_id
                                      where tp.team_id = ts.team_id)) order by ts.pos), '[]'::json)
              from ts where ts.round_id = r.id),
    'scores', (select coalesce(json_agg(json_build_object('subject_id', coalesce('p' || ps.pos, 't' || ts.pos), 'hole', s.hole, 'strokes', s.strokes, 'picked_up', s.picked_up)), '[]'::json)
               from public.scores s left join ps on ps.round_id = r.id and ps.player_id = s.subject_id
               left join ts on ts.round_id = r.id and ts.team_id = s.subject_id
               where s.round_id = r.id and (ps.pos is not null or ts.pos is not null))
  ) order by r.pos) from r), '[]'::json))
  where exists (select 1 from l);
$$;
revoke all on function public.tv_board(text, text) from public;
grant execute on function public.tv_board(text, text) to anon, authenticated;

-- The keyless version (from 039) now shows no rounds — only the course name — so an old link can't watch groups.
create or replace function public.tv_board(p_slug text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('course', l.name, 'rounds', '[]'::json, 'needs_key', true)
  from public.course_library l where l.slug = lower(btrim(p_slug)) and not l.hidden;
$$;
