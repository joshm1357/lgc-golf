-- 038 — Stage 8b part 2: QR kit scans and the club's counts. Additive.
-- Each QR code carries the club's ref and its placement (cart, par3, counter, tv, stay). A scan is logged with no
-- person attached — only a daily scrambled visitor mark (so one phone scanning twice counts once a day, and nobody can
-- work back to a phone). The club sees counts only — never a player's or a group's name.

create table if not exists private.scan_salt (salt text not null);
insert into private.scan_salt (salt) select encode(extensions.gen_random_bytes(24), 'hex') where not exists (select 1 from private.scan_salt);
revoke all on private.scan_salt from public, anon, authenticated;

create table if not exists public.scan_log (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  course_id uuid references public.course_library(id) on delete set null,
  placement text not null check (placement in ('cart', 'par3', 'counter', 'tv', 'stay', 'card', 'invite')),
  hole int check (hole is null or hole between 1 and 27),
  visitor text not null,
  created_at timestamptz not null default now()
);
create index if not exists scan_log_club_idx on public.scan_log (club_id, created_at);
create index if not exists scan_log_visitor_idx on public.scan_log (visitor, created_at);
alter table public.scan_log enable row level security;
revoke all on public.scan_log from anon, authenticated;

-- Logged when a club's code is opened (no sign-in needed). At most 20 a day per visitor, so counts can't be pumped.
create or replace function public.log_scan(p_ref text, p_placement text, p_course_slug text default null, p_hole int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_course uuid; v_visitor text;
begin
  select id into v_club from public.clubs where ref = upper(left(btrim(coalesce(p_ref, '')), 12));
  if v_club is null or p_placement not in ('cart', 'par3', 'counter', 'tv', 'stay') then return; end if;
  select id into v_course from public.course_library where slug = lower(btrim(coalesce(p_course_slug, ''))) and club_id = v_club;
  v_visitor := md5(coalesce(private.request_ip(), 'unknown') || current_date::text || (select salt from private.scan_salt limit 1));
  if (select count(*) from public.scan_log where visitor = v_visitor and created_at > now() - interval '1 day') >= 20 then return; end if;
  insert into public.scan_log (club_id, course_id, placement, hole, visitor)
  values (v_club, v_course, p_placement, case when p_hole between 1 and 27 then p_hole end, v_visitor);
end $$;
revoke all on function public.log_scan(text, text, text, int) from public;
grant execute on function public.log_scan(text, text, text, int) to anon, authenticated;

-- The club's counts (part of the club screen). Counts only; groups are counted by the first club code that started them.
create or replace function public.club_stats(p_days int default 90)
returns json language sql stable security definer set search_path = '' as $$
  with c as (select id, ref from public.clubs where id = private.club_of(auth.uid())),
       since as (select now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 730)) as t),
       g as (select gr.id, gr.quick, gr.source ->> 'placement' as placement, gr.created_at from public.groups gr, c
             where gr.source ->> 'ref' = c.ref and gr.created_at > (select t from since))
  select json_build_object(
    'days', least(greatest(coalesce(p_days, 90), 1), 730),
    'scans', (select coalesce(json_object_agg(placement, n), '{}'::json) from
               (select placement, count(distinct visitor || created_at::date::text) n from public.scan_log, c
                where club_id = c.id and created_at > (select t from since) group by placement) x),
    'rounds_started', (select count(*) from public.rounds r join g on g.id = r.group_id),
    'groups_created', (select count(*) from g),
    'groups_by_placement', (select coalesce(json_object_agg(coalesce(placement, 'other'), n), '{}'::json) from
               (select placement, count(*) n from g group by placement) x),
    'groups_came_back', (select count(*) from g where (select count(distinct r.play_date) from public.rounds r where r.group_id = g.id) >= 2),
    'trips_planned', (select count(*) from public.plans p join g on g.id = p.group_id),
    'made_official', (select count(*) from g where not g.quick))
  from c;
$$;
revoke all on function public.club_stats(int) from public, anon;
grant execute on function public.club_stats(int) to authenticated;
