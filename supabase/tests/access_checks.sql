-- Access checks within one group (after 022: people join through group_members). Run on STAGING only (it creates test people, then undoes everything).
-- It acts as an ordinary player (Mike) and as the admin (Josh) and records what each is allowed to do.
-- The whole run is rolled back at the end on purpose: the results come back as the error message
-- ("RESULTS: ..."), so nothing is left behind in the database.
-- Run it before and after 020_merge_policies.sql: the results must be identical.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.players (id, group_id, name, handicap) values
  ('00000000-0000-4000-8000-0000000000b1', private.legacy_group(), 'Test Josh', 14),
  ('00000000-0000-4000-8000-0000000000b2', private.legacy_group(), 'Test Mike', 18);
insert into public.group_members (group_id, user_id, player_id, role) values
  (private.legacy_group(), '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', 'organiser'),
  (private.legacy_group(), '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2', 'player');
insert into public.trips (id, group_id, name) values ('00000000-0000-4000-8000-0000000000c1', private.legacy_group(), 'Test trip');
insert into public.courses (id, group_id, name, holes) values ('00000000-0000-4000-8000-0000000000c2', private.legacy_group(), 'Test course', '[{"n":1,"par":4,"si":1}]');
insert into public.rounds (id, trip_id, course_id, name, format, status) values
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2', 'Test round', 'stableford', 'live');
insert into public.round_pins (round_id, hole, lat, lng, set_by) values
  ('00000000-0000-4000-8000-0000000000c3', 1, -35, 150, '00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-0000000000c3', 2, -35, 150, '00000000-0000-4000-8000-0000000000b2');
insert into public.plans (id, group_id, name, created_by) values ('00000000-0000-4000-8000-0000000000d1', private.legacy_group(), 'Admin plan', '00000000-0000-4000-8000-0000000000b1');
insert into public.plans (id, group_id, name, created_by, proposed) values ('00000000-0000-4000-8000-0000000000d2', private.legacy_group(), 'Mike idea', '00000000-0000-4000-8000-0000000000b2', true);
insert into public.plans (id, group_id, name, created_by, proposed) values ('00000000-0000-4000-8000-0000000000d3', private.legacy_group(), 'Mike idea 2', '00000000-0000-4000-8000-0000000000b2', true);
insert into public.plans (id, group_id, name, created_by, proposed, status) values ('00000000-0000-4000-8000-0000000000d4', private.legacy_group(), 'Mike passed idea', '00000000-0000-4000-8000-0000000000b2', true, 'cancelled');
insert into public.plan_costs (id, plan_id, title, amount, paid_by, created_by) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', 'Josh cost', 100, '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d1', 'Mike cost', 50, '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2');
insert into public.plan_items (id, plan_id, kind, title, created_by, owner_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'job', 'Unowned job', '00000000-0000-4000-8000-0000000000b1', null),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'info', 'Josh info', '00000000-0000-4000-8000-0000000000b1', null),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000d1', 'job', 'Mike job', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000d1', 'job', 'Another unowned job', '00000000-0000-4000-8000-0000000000b1', null);

-- ================= As Mike (ordinary player) =================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';

insert into t_results (label, result) select 'mike sees members rows (own only)', count(*)::text from public.members;
do $$ declare n int; begin
  with d as (delete from public.round_pins where hole = 1 returning 1) select count(*) into n from d;
  insert into t_results (label, result) values ('mike clears pin (rows)', n);
end $$;
do $$ begin
  insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://x/mike', 'k', 'a');
  insert into t_results (label, result) values ('mike adds own phone', 'ok');
exception when others then insert into t_results (label, result) values ('mike adds own phone', 'refused'); end $$;
do $$ begin
  insert into public.push_subscriptions (endpoint, player_id, p256dh, auth) values ('https://x/fake', '00000000-0000-4000-8000-0000000000b1', 'k', 'a');
  insert into t_results (label, result) values ('mike adds phone as Josh', 'ok');
exception when others then insert into t_results (label, result) values ('mike adds phone as Josh', 'refused'); end $$;
insert into t_results (label, result) select 'mike sees phones', count(*)::text from public.push_subscriptions;

-- plans
do $$ begin
  insert into public.plans (name, proposed) values ('Mike new idea', true);
  insert into t_results (label, result) values ('mike suggests a plan', 'ok');
exception when others then insert into t_results (label, result) values ('mike suggests a plan', 'refused'); end $$;
do $$ begin
  insert into public.plans (name, proposed) values ('Mike real plan', false);
  insert into t_results (label, result) values ('mike adds a non-suggested plan', 'ok');
exception when others then insert into t_results (label, result) values ('mike adds a non-suggested plan', 'refused'); end $$;
do $$ declare n int; begin
  with u as (update public.plans set name = 'hacked' where id = '00000000-0000-4000-8000-0000000000d1' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('mike edits admin plan (rows)', n);
end $$;
do $$ declare n int; begin
  with u as (update public.plans set name = 'Mike idea v2' where id = '00000000-0000-4000-8000-0000000000d2' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('mike edits own suggestion (rows)', n);
end $$;
do $$ begin
  update public.plans set proposed = false where id = '00000000-0000-4000-8000-0000000000d2';
  insert into t_results (label, result) values ('mike approves own suggestion', 'ok');
exception when others then insert into t_results (label, result) values ('mike approves own suggestion', 'refused'); end $$;
do $$ declare n int; begin
  with d as (delete from public.plans where id = '00000000-0000-4000-8000-0000000000d1' returning 1) select count(*) into n from d;
  insert into t_results (label, result) values ('mike deletes admin plan (rows)', n);
end $$;
do $$ declare n int; begin
  with d as (delete from public.plans where id = '00000000-0000-4000-8000-0000000000d3' returning 1) select count(*) into n from d;
  insert into t_results (label, result) values ('mike withdraws own suggestion (rows)', n);
end $$;

do $$ declare n int; begin
  with u as (update public.plans set status = 'planning' where id = '00000000-0000-4000-8000-0000000000d4' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('mike revives passed suggestion (rows)', n);
end $$;
do $$ begin
  update public.plans set rsvp_locked = true where id = '00000000-0000-4000-8000-0000000000d2';
  insert into t_results (label, result) values ('mike locks own suggestion list', 'ok');
exception when others then insert into t_results (label, result) values ('mike locks own suggestion list', 'refused'); end $$;

-- plan_costs
do $$ begin
  insert into public.plan_costs (plan_id, title, amount, paid_by) values ('00000000-0000-4000-8000-0000000000d1', 'Mike fuel', 20, '00000000-0000-4000-8000-0000000000b2');
  insert into t_results (label, result) values ('mike logs own cost', 'ok');
exception when others then insert into t_results (label, result) values ('mike logs own cost', 'refused'); end $$;
do $$ begin
  insert into public.plan_costs (plan_id, title, amount, paid_by) values ('00000000-0000-4000-8000-0000000000d1', 'Fake', 20, '00000000-0000-4000-8000-0000000000b1');
  insert into t_results (label, result) values ('mike logs cost as paid by Josh', 'ok');
exception when others then insert into t_results (label, result) values ('mike logs cost as paid by Josh', 'refused'); end $$;
do $$ declare n int; begin
  with u as (update public.plan_costs set amount = 1 where id = '00000000-0000-4000-8000-0000000000e1' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('mike edits Josh cost (rows)', n);
end $$;
do $$ declare n int; begin
  with u as (update public.plan_costs set amount = 55 where id = '00000000-0000-4000-8000-0000000000e2' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('mike edits own cost (rows)', n);
end $$;
do $$ begin
  update public.plan_costs set paid_by = '00000000-0000-4000-8000-0000000000b1' where id = '00000000-0000-4000-8000-0000000000e2';
  insert into t_results (label, result) values ('mike moves own cost to Josh', 'ok');
exception when others then insert into t_results (label, result) values ('mike moves own cost to Josh', 'refused'); end $$;
do $$ declare n int; begin
  with d as (delete from public.plan_costs where id = '00000000-0000-4000-8000-0000000000e1' returning 1) select count(*) into n from d;
  insert into t_results (label, result) values ('mike deletes Josh cost (rows)', n);
end $$;

-- plan_items
do $$ declare n int; begin
  with u as (update public.plan_items set owner_id = '00000000-0000-4000-8000-0000000000b2' where id = '00000000-0000-4000-8000-0000000000f1' returning owner_id) select count(*) into n from u;
  insert into t_results (label, result) values ('mike claims unowned job (rows)', n);
end $$;
do $$ declare n int; begin
  with u as (update public.plan_items set title = 'hacked' where id = '00000000-0000-4000-8000-0000000000f2' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('mike edits Josh info (rows)', n);
end $$;
do $$ declare n int; begin
  with u as (update public.plan_items set done = true where id = '00000000-0000-4000-8000-0000000000f3' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('mike ticks own job (rows)', n);
end $$;

-- ================= As a stranger (signed in, never joined) =================
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
insert into t_results (label, result) select 'stranger sees players', count(*)::text from public.players;
do $$ declare n int; begin
  with u as (update public.plan_items set done = true where id = '00000000-0000-4000-8000-0000000000f4' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('stranger claims/changes an unowned job (rows)', n);
end $$;

-- ================= As Josh (admin) =================
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
insert into t_results (label, result) select 'admin sees all L.G.C members rows', (count(*) = (select count(*) from public.group_members where group_id = private.legacy_group()))::text from public.members;
do $$ declare n int; begin
  with d as (delete from public.round_pins where hole = 2 returning 1) select count(*) into n from d;
  insert into t_results (label, result) values ('admin clears pin (rows)', n);
end $$;
do $$ declare n int; begin
  with u as (update public.plans set name = 'Admin plan v2' where id = '00000000-0000-4000-8000-0000000000d1' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('admin edits plan (rows)', n);
end $$;
do $$ declare n int; begin
  with u as (update public.plan_costs set amount = 99 where id = '00000000-0000-4000-8000-0000000000e2' returning 1) select count(*) into n from u;
  insert into t_results (label, result) values ('admin edits Mike cost (rows)', n);
end $$;
do $$ begin
  insert into public.plans (name) values ('Admin new plan');
  insert into t_results (label, result) values ('admin adds a plan', 'ok');
exception when others then insert into t_results (label, result) values ('admin adds a plan', 'refused'); end $$;

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
