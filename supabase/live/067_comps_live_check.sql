-- 067 — checks to run on LIVE after Josh's OK and after 067_comps.sql is applied there. NOT run yet.
-- Everything is read-only, or inside a block that ends with raise exception (so it all rolls back).
-- Paste each part into the Supabase SQL editor on the live project and read the output.

-- 1. The backfill: one comp per trophy, one Cup comp per group with Cup sides, sides linked.
select g.name as grp, t.name as trip, c.name, c.kind, c.round_ids, c.settings, c.trophy_id is not null as has_trophy,
       (select count(*) from public.cup_sides s where s.comp_id = c.id) as sides_linked
from public.comps c join public.groups g on g.id = c.group_id join public.trips t on t.id = c.trip_id
order by g.name, t.start_date, c.sort;

-- Expect 0 rows each:
select 'trophy without a comp' as problem, tr.id from public.trophies tr where length(btrim(tr.name)) >= 2 and not exists (select 1 from public.comps c where c.trophy_id = tr.id)
union all
select 'group with sides but no cup comp', s.group_id from public.cup_sides s where not exists (select 1 from public.comps c where c.group_id = s.group_id and c.kind = 'cup' and not c.retired)
union all
select 'side not linked', s.id from public.cup_sides s where s.comp_id is null
union all
select 'cup switched off', s.group_id from public.cup_sides s where not public.feature_on(s.group_id, 'cup');
-- (A group whose organiser switched its Cup off on purpose would show in the last line: the backfill leaves that alone.)

-- 2. Security, rolled back. Fill in: an organiser user + their group, a player user in the same group, a user from
-- another group, and a trip of the first group.
do $t$ declare out text[] := '{}'; n int;
  g uuid := '<group uuid>'; org uuid := '<organiser user uuid>'; ply uuid := '<player user uuid>';
  other_g uuid := '<another group uuid>'; other_u uuid := '<user in that group>'; trip uuid := '<a trip of the first group>';
begin
  perform set_config('request.headers', json_build_object('x-group-id', g)::text, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  select count(*) into n from public.comps; out := out || ('organiser sees ' || n)::text;
  insert into public.comps (trip_id, name, kind) values (trip, 'Live check comp', 'manual');
  out := out || 'organiser adds: ok'::text;
  begin insert into public.comps (trip_id, name, kind, settings) values (trip, 'Bad', 'manual', '{"teams":"fixed"}'); out := out || 'BAD: settings let through'::text;
  exception when others then out := out || 'bad settings refused'::text; end;
  perform set_config('request.jwt.claims', json_build_object('sub', ply, 'role', 'authenticated')::text, true);
  select count(*) into n from public.comps; out := out || ('player sees ' || n)::text;
  begin insert into public.comps (trip_id, name, kind) values (trip, 'Player comp', 'manual'); out := out || 'BAD: player added'::text;
  exception when others then out := out || 'player add refused'::text; end;
  update public.comps set name = 'Hacked' where group_id = g; get diagnostics n = row_count; out := out || ('player changed ' || n)::text;
  perform set_config('request.headers', json_build_object('x-group-id', other_g)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', other_u, 'role', 'authenticated')::text, true);
  select count(*) into n from public.comps where group_id = g; out := out || ('other group sees ' || n)::text;
  update public.comps set name = 'Hacked' where group_id = g; get diagnostics n = row_count; out := out || ('other group changed ' || n)::text;
  raise exception 'RESULTS: %', array_to_string(out, ' | ');
end $t$;
-- Expect: organiser adds ok | bad settings refused | player sees N | player add refused | player changed 0 |
--         other group sees 0 | other group changed 0

-- 3. Kurt's Cup still works: its sides, matches and points as before (the Cup screen now shows the comp's name,
-- which the backfill set to the trip's name — what the screen showed before).
select c.name, c.settings, (select json_agg(json_build_object('name', s.name, 'sort', s.sort)) from public.cup_sides s where s.comp_id = c.id) sides,
       (select count(*) from public.cup_matches m where m.group_id = c.group_id) matches
from public.comps c where c.kind = 'cup';
