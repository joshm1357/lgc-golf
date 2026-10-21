-- 039c — Stage 8b re-check fixes. Additive (replaced function bodies, one new function, one more picture type).

-- Scans: at most 60 phones a day from one internet address (a busy clubhouse wifi), so totals can't be pumped.
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
  if (select count(distinct visitor) from public.scan_log where ip_mark = v_ip and created_at > now() - interval '1 day') >= 60
     and not exists (select 1 from public.scan_log where visitor = v_visitor and created_at > now() - interval '1 day') then return; end if;
  if (select count(*) from public.scan_log where ip_mark = v_ip and created_at > now() - interval '1 day') >= 300 then return; end if;
  insert into public.scan_log (club_id, course_id, placement, hole, visitor, ip_mark)
  values (v_club, v_course, p_placement, case when p_hole between 1 and 27 then p_hole end, v_visitor, v_ip);
end $$;

-- Club counts: the split of groups by where the code was is only shown once there are 10 or more groups.
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
    'groups_by_placement', case when (select count(*) from g) < 10 then '{}'::json else
               (select coalesce(json_object_agg(coalesce(placement, 'other'), private.fewer_than_5(n)), '{}'::json) from
               (select placement, count(*) n from g group by placement) x) end,
    'groups_came_back', private.fewer_than_5((select count(*) from (select group_id from r group by group_id having count(distinct play_date) >= 2) x)),
    'trips_planned', private.fewer_than_5((select count(*) from public.plans p join g on g.id = p.group_id where p.created_at > (select t from since))),
    'made_official', private.fewer_than_5((select count(*) from g where not g.quick)))
  from c;
$$;

-- A club can change its TV key (if the old link got out). The old link stops working straight away.
create or replace function public.new_club_tv_key()
returns text language plpgsql security definer set search_path = '' as $$
declare v_club uuid := private.club_of(auth.uid()); v_key text := encode(extensions.gen_random_bytes(9), 'hex');
begin
  if v_club is null then raise exception 'Only a club account can do that'; end if;
  update public.clubs set tv_key = v_key where id = v_club;
  return v_key;
end $$;
revoke all on function public.new_club_tv_key() from public, anon;
grant execute on function public.new_club_tv_key() to authenticated;

-- AVIF pictures too (some phones' photos, when the app can't shrink them).
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif']
where id = 'photos' and not ('image/avif' = any (coalesce(allowed_mime_types, array['image/avif'])));
