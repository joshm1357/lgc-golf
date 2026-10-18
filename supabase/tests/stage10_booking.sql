-- Stage 10–11 test: booking links, group booking enquiries, group plans. STAGING only, after 042 and 043. Rolled back.
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated, anon;
grant all on sequence t_results_n_seq to authenticated, anon;

-- A group (organiser g01, player g02) with a trip to "Port Stephens & Co", 3 people in; a partner club with a bookings
-- email (manager g03); Josh (g04).
insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-000000001003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false),
  ('00000000-0000-4000-8000-000000001004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false);
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-000000001004');
insert into public.groups (id, slug, name, group_pin, legacy, created_by) values
  ('00000000-0000-4000-8000-000000001a00', 'zzqx-ten', 'Zzqx Ten', 'ZZQXTEN001', false, '00000000-0000-4000-8000-000000001001');
insert into public.players (id, group_id, name, handicap, approved) values
  ('00000000-0000-4000-8000-000000001b01', '00000000-0000-4000-8000-000000001a00', 'Olly', 10, true),
  ('00000000-0000-4000-8000-000000001b02', '00000000-0000-4000-8000-000000001a00', 'Pip', 18, true),
  ('00000000-0000-4000-8000-000000001b03', '00000000-0000-4000-8000-000000001a00', 'Ted', 20, true);
insert into public.group_members (group_id, user_id, role, player_id) values
  ('00000000-0000-4000-8000-000000001a00', '00000000-0000-4000-8000-000000001001', 'organiser', '00000000-0000-4000-8000-000000001b01'),
  ('00000000-0000-4000-8000-000000001a00', '00000000-0000-4000-8000-000000001002', 'player', '00000000-0000-4000-8000-000000001b02');
insert into public.plans (id, group_id, kind, name, status, start_date, end_date, location_name, created_by, organiser_id) values
  ('00000000-0000-4000-8000-000000001c01', '00000000-0000-4000-8000-000000001a00', 'trip', 'Zzqx Trip', 'planning', current_date + 30, current_date + 32, 'Port Stephens & Co',
   '00000000-0000-4000-8000-000000001b01', '00000000-0000-4000-8000-000000001b01');
insert into public.plan_rsvps (plan_id, player_id, status) select '00000000-0000-4000-8000-000000001c01', id, 'in' from public.players where group_id = '00000000-0000-4000-8000-000000001a00';
with c as (insert into public.clubs (name, ref, booking_email) values ('Zzqx Links Club', 'ZZQXTEN1', 'bookings@zzqx.example') returning id)
insert into public.club_members (club_id, user_id) select id, '00000000-0000-4000-8000-000000001003' from c;
insert into public.course_library (slug, name, holes, club_id) values ('zzqx-links', 'Zzqx Links Golf Club',
  (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g) order by g) from generate_series(1, 18) g), (select id from public.clubs where ref = 'ZZQXTEN1'));
insert into public.course_library (slug, name, holes) values ('zzqx-unclaimed', 'Zzqx Unclaimed Golf Club',
  (select jsonb_agg(jsonb_build_object('n', g, 'par', 4, 'si', g) order by g) from generate_series(1, 18) g));

-- 1. Booking links: off by default; on, the address has the place, dates and people filled in.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000001002","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-000000001a00"}', true); end $$;
do $$ begin perform public.booking_link('stay', '00000000-0000-4000-8000-000000001c01'); insert into t_results (label, result) values ('links with the switch off', 'ok');
exception when others then insert into t_results (label, result) values ('links with the switch off', 'refused'); end $$;
reset role;
insert into public.group_features (group_id, feature_key, enabled) values ('00000000-0000-4000-8000-000000001a00', 'booking_links', true)
on conflict (group_id, feature_key) do update set enabled = true;
set local role authenticated;
insert into t_results (label, result) select 'accommodation link', replace(replace(public.booking_link('stay', '00000000-0000-4000-8000-000000001c01') ->> 'url', (current_date + 30)::text, 'START'), (current_date + 32)::text, 'END');
insert into t_results (label, result) select 'what the screen says about money', public.booking_link('golf', '00000000-0000-4000-8000-000000001c01') ->> 'disclosure';
insert into t_results (label, result) select 'getting there link', public.booking_link('transport', '00000000-0000-4000-8000-000000001c01') ->> 'url';
do $$ begin perform public.booking_link('bogus', '00000000-0000-4000-8000-000000001c01'); insert into t_results (label, result) values ('a made-up link kind', 'ok');
exception when others then insert into t_results (label, result) values ('a made-up link kind', 'refused'); end $$;
do $$ begin perform 1 from public.booking_targets; insert into t_results (label, result) values ('read the link templates', 'ok');
exception when others then insert into t_results (label, result) values ('read the link templates', 'refused'); end $$;
reset role;
insert into t_results (label, result) select 'taps counted', count(*)::text from public.booking_clicks where group_id = '00000000-0000-4000-8000-000000001a00';

-- 2. Enquiries: to a claimed course with a bookings contact; checks; the club sees its own.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000001002","role":"authenticated"}';
insert into t_results (label, result) select 'enquiry email', (r ->> 'to') || ' / ' || (r ->> 'subject') || ' / ref in body: ' || ((r ->> 'body') ~ 'ref ZZQXTEN1')
  from (select public.send_booking_enquiry('zzqx-links', 'Pip Smith', 'pip@example.com', '0400 000 000', current_date + 30, current_date + 32, 12, 2, 'Carts please')::jsonb r) x;
do $$ begin perform public.send_booking_enquiry('zzqx-links', 'Pip', 'pip@example.com', '0400 000 000', null, null, 12, 2); insert into t_results (label, result) values ('the same club twice in a day', 'ok');
exception when others then insert into t_results (label, result) values ('the same club twice in a day', 'refused'); end $$;
do $$ begin perform public.send_booking_enquiry('zzqx-unclaimed', 'Pip', 'pip@example.com', null, null, null, 12, 2); insert into t_results (label, result) values ('enquiry to an unclaimed course', 'ok');
exception when others then insert into t_results (label, result) values ('enquiry to an unclaimed course', 'refused'); end $$;
do $$ begin perform public.send_booking_enquiry('zzqx-links', 'Pip', 'pip@example.com', null, null, null, 12, 2); insert into t_results (label, result) values ('phone-only sign-in without a phone', 'ok');
exception when others then insert into t_results (label, result) values ('phone-only sign-in without a phone', 'refused'); end $$;
do $$ begin perform public.send_booking_enquiry('zzqx-links', 'Pip', null, null, null, null, 12, 2); insert into t_results (label, result) values ('enquiry with no way to reply', 'ok');
exception when others then insert into t_results (label, result) values ('enquiry with no way to reply', 'refused'); end $$;
do $$ begin perform public.send_booking_enquiry('zzqx-links', 'Pip', 'pip@example.com', null, null, null, 1000, 2); insert into t_results (label, result) values ('a group of 1000', 'ok');
exception when others then insert into t_results (label, result) values ('a group of 1000', 'refused'); end $$;
do $$ begin perform 1 from public.booking_enquiries; insert into t_results (label, result) values ('read the enquiries table', 'ok');
exception when others then insert into t_results (label, result) values ('read the enquiries table', 'refused'); end $$;
insert into t_results (label, result) select 'a player asks for the club''s enquiries', public.club_enquiries(90)::text;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000001003","role":"authenticated"}';
insert into t_results (label, result) select 'the club sees it', (e ->> 'contact_name') || ' / ' || (e ->> 'group_size') || ' golfers / ' || (e ->> 'course')
  from (select json_array_elements(public.club_enquiries(90)) e) x;
insert into t_results (label, result) select 'place vote match', coalesce((select slug from public.partner_courses_for(array['Zzqx Links GC', 'Zzqx Unclaimed Golf Club', 'Mudgee']) limit 1), 'none')
  || ' / matches ' || (select count(*) from public.partner_courses_for(array['Zzqx Links GC', 'Zzqx Unclaimed Golf Club', 'Mudgee']))
  || ' / a town on its own: ' || (select count(*) from public.partner_courses_for(array['Zzqx']));

-- 3. Group plans: everything free; an organiser can't make their group premium; Josh can; a premium feature follows.
reset role;
insert into t_results (label, result) select 'every group free', (select count(*) from public.groups where group_plan <> 'free')::text;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000001001","role":"authenticated"}';
reset role;
-- Even with full table rights (like a function owned by the database), an organiser's request can't change the plan.
do $$ begin update public.groups set group_plan = 'premium' where id = '00000000-0000-4000-8000-000000001a00'; insert into t_results (label, result) values ('organiser makes it premium', 'ok');
exception when others then insert into t_results (label, result) values ('organiser makes it premium', sqlerrm); end $$;
update public.feature_catalogue set tier = 'premium' where key = 'booking_links';
insert into t_results (label, result) select 'premium feature on a free group', public.feature_on('00000000-0000-4000-8000-000000001a00', 'booking_links')::text;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000001004","role":"authenticated"}';
select public.admin_set_group_plan('00000000-0000-4000-8000-000000001a00', 'premium');
reset role;
insert into t_results (label, result) select 'premium feature on a premium group', public.feature_on('00000000-0000-4000-8000-000000001a00', 'booking_links')::text;
set local role authenticated;
insert into t_results (label, result) select 'Josh''s booking numbers', (b -> 'enquiries' -> 0 ->> 'n') || ' enquiry / taps ' || (b -> 'link_taps')::text
  from (select public.admin_booking_numbers(90)::jsonb b) x;
reset role;
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
