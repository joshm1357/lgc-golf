-- 044 — Stage 10–11 review fixes. Additive (new functions, replaced bodies).

-- Booking links: the address and what to say about money come from the database together, so if a referral code is
-- ever added the screen says so without an app update. A one-day trip still books one night.
create or replace function public.booking_disclosure()
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.booking_targets where active and coalesce(ref_code, '') <> '')
    then 'The Golf Trip may get a small referral fee from bookings made through these links. It never changes your price.'
    else 'The Golf Trip doesn’t earn anything from these links.' end
  where auth.uid() is not null;
$$;
revoke all on function public.booking_disclosure() from public, anon;
grant execute on function public.booking_disclosure() to authenticated;

create or replace function public.booking_link(p_kind text, p_plan uuid)
returns json language plpgsql security definer set search_path = '' as $$
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
  v_url := replace(v_url, '{end}', coalesce(greatest(p.end_date, p.start_date + 1)::text, ''));
  v_url := replace(v_url, '{people}', v_people::text);
  v_url := replace(v_url, '{rooms}', greatest(1, ceil(v_people / 2.0))::int::text);
  v_url := replace(v_url, '{ref}', private.url_encode(coalesce(t.ref_code, '')));
  insert into public.booking_clicks (group_id, plan_id, kind) values (v_g, p.id, t.kind);
  return json_build_object('url', v_url, 'disclosure', public.booking_disclosure());
end $$;
revoke all on function public.booking_link(text, uuid) from public, anon;
grant execute on function public.booking_link(text, uuid) to authenticated;

-- Enquiries: one a day per person per club, 5 a day per person, 20 a day per club (so throwaway sign-ins can't flood a
-- club); a phone-only sign-in must give a phone number; an end date needs a start date.
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
  if v_phone is null and coalesce((select is_anonymous from auth.users where id = v_uid), true) then
    raise exception 'Add a phone number so the club can check it’s really you';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn''t look right'; end if;
  if v_phone is not null and v_phone !~ '^[0-9 +()-]{6,30}$' then raise exception 'That phone number doesn''t look right'; end if;
  if p_size is not null and p_size not between 2 and 200 then raise exception 'Group size is 2 to 200'; end if;
  if p_rounds is not null and p_rounds not between 1 and 20 then raise exception 'Rounds is 1 to 20'; end if;
  if p_end is not null and p_start is null then raise exception 'Add the first day too'; end if;
  if p_start is not null and (p_start < current_date - 1 or p_start > current_date + 730) then raise exception 'Pick dates in the next two years'; end if;
  if p_end is not null and (p_end < p_start or p_end > p_start + 30) then raise exception 'Check the dates'; end if;
  perform pg_advisory_xact_lock(hashtext('enquiry:' || c.id::text));
  if exists (select 1 from public.booking_enquiries where user_id = v_uid and club_id = c.id and created_at > now() - interval '1 day') then
    raise exception 'You’ve already asked this club today — they’ll be in touch';
  end if;
  if (select count(*) from public.booking_enquiries where user_id = v_uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s 5 enquiries today — try again tomorrow';
  end if;
  if (select count(*) from public.booking_enquiries where club_id = c.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'This club has had a lot of enquiries today — please call them instead';
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

-- Place votes: only an option that names a golf course (not just a town) and matches a partner course; always the same pick.
create or replace function public.partner_courses_for(p_names text[])
returns table (name text, slug text, course text)
language sql stable security definer set search_path = '' as $$
  select n, l.slug, l.name from unnest(coalesce(p_names, '{}')) n
  join lateral (select l.slug, l.name from public.course_library l join public.clubs c on c.id = l.club_id
                where not l.hidden and (c.booking_email is not null or c.booking_phone is not null)
                  and length(private.course_key(n)) >= 3 and private.course_key(l.name) = private.course_key(n)
                  and (n ~* '\m(golf|club|links|gc|country club|resort)\M' or lower(btrim(n)) = lower(btrim(l.name)))
                order by l.slug limit 1) l on true
  where auth.uid() is not null
  limit 20;
$$;

-- Plans: the guard works whoever is asking — only Josh's function (or the database itself) can change a plan.
create or replace function private.guard_group_plan() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.group_plan is distinct from old.group_plan and auth.uid() is not null
     and coalesce(current_setting('lgc.plan_edit', true), '') <> 'on' then
    raise exception 'Only Josh can change a group''s plan';
  end if;
  return new;
end $$;

create or replace function public.admin_set_group_plan(p_group uuid, p_plan text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Only Josh can do that'; end if;
  if p_plan not in ('free', 'premium') then raise exception 'Plan is free or premium'; end if;
  perform set_config('lgc.plan_edit', 'on', true);
  update public.groups set group_plan = p_plan where id = p_group;
  perform set_config('lgc.plan_edit', 'off', true);
end $$;
