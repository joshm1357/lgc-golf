-- 042 — Stage 10: booking links and group booking enquiries. Additive. No money changes hands.
-- 1. Booking links (feature 'booking_links', off by default): a trip's Details shows "Find accommodation / Find a
--    course / Getting there". Each goes through one redirect (this database builds the address from a template), so a
--    referral code can be added later without an app update. No referral accounts are signed up; nothing is earned.
-- 2. Group booking enquiries: on a claimed course page (and from a trip's place vote), a form — dates, group size,
--    rounds, contact — is logged against the club's code and opens the person's own email app addressed to the club.
--    (No email service needed.) The club sees its enquiries. Any future payment goes to the club itself, never to staff,
--    and is disclosed.

-- 1. Booking links.
create table if not exists public.booking_targets (
  kind text primary key check (kind in ('stay', 'golf', 'transport')),
  label text not null,
  url_template text not null,   -- {place} {start} {end} {people} {rooms} {ref}
  ref_code text,                -- a referral code, later; empty now
  active boolean not null default true
);
alter table public.booking_targets enable row level security;
revoke all on public.booking_targets from anon, authenticated;
insert into public.booking_targets (kind, label, url_template) values
  ('stay', 'Find accommodation', 'https://www.booking.com/searchresults.html?ss={place}&checkin={start}&checkout={end}&group_adults={people}&no_rooms={rooms}'),
  ('golf', 'Find a course', 'https://www.google.com/maps/search/golf+course+near+{place}'),
  ('transport', 'Getting there', 'https://www.google.com/maps/dir/?api=1&destination={place}')
on conflict (kind) do nothing;

create table if not exists public.booking_clicks (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists booking_clicks_group_idx on public.booking_clicks (group_id, created_at);
alter table public.booking_clicks enable row level security;
revoke all on public.booking_clicks from anon, authenticated;

-- The redirect: the app opens #/go/<kind>/<plan> and this returns where to send the phone. Counts the click.
create or replace function public.booking_go(p_kind text, p_plan uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); p record; t record; v_people int; v_url text;
begin
  if v_g is null or not private.is_group_member(v_g) then raise exception 'Not in this group'; end if;
  perform private.require_feature(v_g, 'booking_links');
  select * into t from public.booking_targets where kind = p_kind and active;
  if t.kind is null then raise exception 'That link isn''t available'; end if;
  select * into p from public.plans where id = p_plan and group_id = v_g;
  if p.id is null then raise exception 'That trip isn''t in your group'; end if;
  if coalesce(btrim(p.location_name), '') = '' then raise exception 'Add where the trip is first'; end if;
  select count(*) into v_people from public.plan_rsvps where plan_id = p.id and status = 'in';
  v_people := greatest(coalesce(v_people, 0), 1);
  v_url := t.url_template;
  v_url := replace(v_url, '{place}', private.url_encode(p.location_name));
  v_url := replace(v_url, '{start}', coalesce(p.start_date::text, ''));
  v_url := replace(v_url, '{end}', coalesce(coalesce(p.end_date, p.start_date + 1)::text, ''));
  v_url := replace(v_url, '{people}', v_people::text);
  v_url := replace(v_url, '{rooms}', greatest(1, ceil(v_people / 2.0))::int::text);
  v_url := replace(v_url, '{ref}', private.url_encode(coalesce(t.ref_code, '')));
  insert into public.booking_clicks (group_id, plan_id, kind) values (v_g, p.id, t.kind);
  return v_url;
end $$;
revoke all on function public.booking_go(text, uuid) from public, anon;
grant execute on function public.booking_go(text, uuid) to authenticated;

create or replace function private.url_encode(p text) returns text language plpgsql immutable set search_path = '' as $$
declare r text := ''; c text; b bytea; i int;
begin
  for i in 1 .. coalesce(length(p), 0) loop
    c := substr(p, i, 1);
    if c ~ '^[A-Za-z0-9_.~-]$' then r := r || c;
    elsif c = ' ' then r := r || '+';
    else
      b := convert_to(c, 'UTF8');
      for j in 0 .. length(b) - 1 loop r := r || '%' || upper(lpad(to_hex(get_byte(b, j)), 2, '0')); end loop;
    end if;
  end loop;
  return r;
end $$;
revoke all on function private.url_encode(text) from public, anon, authenticated;

-- 2. Group booking enquiries.
create table if not exists public.booking_enquiries (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  course_id uuid references public.course_library(id) on delete set null,
  user_id uuid,
  from_group boolean not null default false,
  contact_name text not null,
  contact_email text,
  contact_phone text,
  start_date date,
  end_date date,
  group_size int,
  rounds int,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists booking_enquiries_club_idx on public.booking_enquiries (club_id, created_at);
alter table public.booking_enquiries enable row level security;
revoke all on public.booking_enquiries from anon, authenticated;

-- Send one (anyone signed in, even phone-only). Returns the club's email and phone and the email text, for the phone's
-- own email app. At most 5 a day per person.
create or replace function public.send_booking_enquiry(p_course_slug text, p_name text, p_email text, p_phone text,
  p_start date, p_end date, p_size int, p_rounds int, p_note text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); l record; c record; v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g')), 80);
        v_email text := nullif(left(btrim(coalesce(p_email, '')), 120), ''); v_phone text := nullif(left(btrim(coalesce(p_phone, '')), 30), '');
        v_note text := nullif(left(btrim(coalesce(p_note, '')), 600), ''); v_body text; v_g uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into l from public.course_library where slug = lower(btrim(p_course_slug)) and not hidden;
  if l.id is null or l.club_id is null then raise exception 'That course isn''t taking enquiries through the app'; end if;
  select * into c from public.clubs where id = l.club_id;
  if c.booking_email is null and c.booking_phone is null then raise exception 'The club hasn''t added a bookings contact yet'; end if;
  if length(v_name) < 2 then raise exception 'Add your name'; end if;
  if v_email is null and v_phone is null then raise exception 'Add an email or a phone number so the club can reply'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn''t look right'; end if;
  if p_size is not null and p_size not between 2 and 200 then raise exception 'Group size is 2 to 200'; end if;
  if p_rounds is not null and p_rounds not between 1 and 20 then raise exception 'Rounds is 1 to 20'; end if;
  if p_start is not null and (p_start < current_date - 1 or p_start > current_date + 730) then raise exception 'Pick dates in the next two years'; end if;
  if p_end is not null and p_start is not null and (p_end < p_start or p_end > p_start + 30) then raise exception 'Check the dates'; end if;
  if (select count(*) from public.booking_enquiries where user_id = v_uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s 5 enquiries today — try again tomorrow';
  end if;
  begin v_g := private.current_group(); exception when others then v_g := null; end;
  insert into public.booking_enquiries (club_id, course_id, user_id, from_group, contact_name, contact_email, contact_phone, start_date, end_date, group_size, rounds, note)
  values (c.id, l.id, v_uid, v_g is not null, v_name, v_email, v_phone, p_start, coalesce(p_end, p_start), p_size, p_rounds, v_note);
  v_body := 'Hi ' || c.name || E',\n\nWe''re a group of ' || coalesce(p_size::text, 'several') || ' golfers looking at ' || l.name
    || case when p_start is not null then ' on ' || to_char(p_start, 'FMDD Mon YYYY') || case when p_end is not null and p_end > p_start then ' to ' || to_char(p_end, 'FMDD Mon YYYY') else '' end else '' end
    || case when p_rounds is not null then ', ' || p_rounds || ' round' || case when p_rounds = 1 then '' else 's' end else '' end || E'.\n'
    || coalesce(E'\n' || v_note || E'\n', '')
    || E'\nCould you let us know availability and group rates?\n\n' || v_name
    || coalesce(E'\n' || v_email, '') || coalesce(E'\n' || v_phone, '')
    || E'\n\n(Sent from The Golf Trip, ref ' || c.ref || ')';
  return json_build_object('to', c.booking_email, 'phone', c.booking_phone, 'club', c.name,
                           'subject', 'Group booking enquiry — ' || l.name, 'body', v_body);
end $$;
revoke all on function public.send_booking_enquiry(text, text, text, text, date, date, int, int, text) from public, anon;
grant execute on function public.send_booking_enquiry(text, text, text, text, date, date, int, int, text) to authenticated;

-- The club's enquiries (its own only; the person chose to send these to the club).
create or replace function public.club_enquiries(p_days int default 90)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', e.id, 'course', l.name, 'contact_name', e.contact_name, 'contact_email', e.contact_email,
           'contact_phone', e.contact_phone, 'start_date', e.start_date, 'end_date', e.end_date, 'group_size', e.group_size,
           'rounds', e.rounds, 'note', e.note, 'created_at', e.created_at) order by e.created_at desc), '[]'::json)
  from public.booking_enquiries e left join public.course_library l on l.id = e.course_id
  where e.club_id = private.club_of(auth.uid())
    and e.created_at > now() - make_interval(days => case when p_days in (30, 90, 365) then p_days else 90 end);
$$;
revoke all on function public.club_enquiries(int) from public, anon;
grant execute on function public.club_enquiries(int) to authenticated;

-- Partner courses matching a trip's place-vote options (by name), so the vote can offer "Ask about a group booking".
create or replace function public.partner_courses_for(p_names text[])
returns table (name text, slug text, course text)
language sql stable security definer set search_path = '' as $$
  select n, l.slug, l.name from unnest(coalesce(p_names, '{}')) n
  join lateral (select l.slug, l.name from public.course_library l join public.clubs c on c.id = l.club_id
                where not l.hidden and (c.booking_email is not null or c.booking_phone is not null)
                  and length(private.course_key(n)) >= 3 and private.course_key(l.name) = private.course_key(n) limit 1) l on true
  where auth.uid() is not null
  limit 20;
$$;
revoke all on function public.partner_courses_for(text[]) from public, anon;
grant execute on function public.partner_courses_for(text[]) to authenticated;

-- Booking links can now be switched on (the switch was "coming soon").
