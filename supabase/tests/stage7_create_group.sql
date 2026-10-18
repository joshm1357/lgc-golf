-- Stage 7 test: starting a new group. STAGING only, after 034. Rolled back; results in the error message.
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-00000000ae01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000ae02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
create temp table t_ids (k text, id uuid);
grant all on t_ids to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000ae01","role":"authenticated"}';
insert into t_ids select 'g1', public.create_group('The Thursday Hackers', '{"feed": false, "tribunal": false, "gps": true}');
insert into t_results (label, result) select 'made: slug / legacy / my role', g.slug || ' / ' || g.legacy || ' / ' || m.role
  from t_ids t join public.groups g on g.id = t.id join public.group_members m on m.group_id = g.id and m.user_id = auth.uid() where t.k = 'g1';
do $$ begin perform set_config('request.headers', json_build_object('x-group-id', (select id from t_ids where k = 'g1'))::text, true); end $$;
insert into t_results (label, result) select 'starts empty (players, trips, courses, rules, trophies, honours)',
  (select count(*) from public.players where group_id = (select id from t_ids where k = 'g1')) || ' ' ||
  (select count(*) from public.trips where group_id = (select id from t_ids where k = 'g1')) || ' ' ||
  (select count(*) from public.courses where group_id = (select id from t_ids where k = 'g1')) || ' ' ||
  (select count(*) from public.rules where group_id = (select id from t_ids where k = 'g1')) || ' ' ||
  (select count(*) from public.trophies where group_id = (select id from t_ids where k = 'g1')) || ' ' ||
  (select count(*) from public.honour_board where group_id = (select id from t_ids where k = 'g1'));
insert into t_results (label, result) select 'preset switches: feed / tribunal / gps / planner(default)',
  public.feature_on(id, 'feed') || ' / ' || public.feature_on(id, 'tribunal') || ' / ' || public.feature_on(id, 'gps') || ' / ' || public.feature_on(id, 'planner') from t_ids where k = 'g1';
insert into t_results (label, result) select 'plain look', (s -> 'look' ->> 'primary') || ' / ' || coalesce(s -> 'look' ->> 'crest_url', 'plain') from (select public.my_status() s) x;
insert into t_results (label, result) values ('organiser adds themselves', (public.create_my_player('Josh', null, 14, null) is not null)::text);
select public.set_features('{"feed": true, "planner": false}');
insert into t_results (label, result) select 'set_features: feed / planner', public.feature_on(id, 'feed') || ' / ' || public.feature_on(id, 'planner') from t_ids where k = 'g1';
insert into t_results (label, result) values ('starter rulebook', public.use_starter_rulebook('just_scoring')::text);
insert into t_results (label, result) values ('invite link', (length(public.group_invite('player')) = 12)::text);

-- Same name again: a different address. Reserved names get "-golf".
insert into t_ids select 'g2', public.create_group('The Thursday Hackers');
insert into t_results (label, result) select 'same name, new address', slug from public.groups where id = (select id from t_ids where k = 'g2');
select public.create_group('Third Group');
do $$ begin perform public.create_group('Fourth Group'); insert into t_results (label, result) values ('4th group today', 'ok');
exception when others then insert into t_results (label, result) values ('4th group today', 'refused'); end $$;

-- Someone else: can't change the first group's features; bad input refused.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000ae02","role":"authenticated"}';
do $$ begin perform public.set_features('{"feed": false}'); insert into t_results (label, result) values ('outsider changes features', 'ok');
exception when others then insert into t_results (label, result) values ('outsider changes features', 'refused'); end $$;
insert into t_ids select 'g3', public.create_group('LGC');
insert into t_results (label, result) select 'reserved name', slug from public.groups where id = (select id from t_ids where k = 'g3');
do $$ declare a text; begin
  foreach a in array array['x', repeat('y', 41)] loop
    begin perform public.create_group(a); insert into t_results (label, result) values ('bad name', 'ok');
    exception when others then insert into t_results (label, result) values ('bad name', 'refused'); end;
  end loop;
  begin perform public.create_group('Fine name', '{"made_up": true}'); insert into t_results (label, result) values ('unknown feature', 'ok');
  exception when others then insert into t_results (label, result) values ('unknown feature', 'refused'); end;
  begin perform public.create_group('Fine name', '{"feed": "yes"}'); insert into t_results (label, result) values ('feature not on/off', 'ok');
  exception when others then insert into t_results (label, result) values ('feature not on/off', 'refused'); end;
end $$;
insert into t_results (label, result) select 'outsider sees the first group', count(*)::text from public.groups where id = (select id from t_ids where k = 'g1');
set local request.jwt.claims to '{"role":"anon"}';
do $$ begin perform public.create_group('Nobody'); insert into t_results (label, result) values ('not signed in', 'ok');
exception when others then insert into t_results (label, result) values ('not signed in', 'refused'); end $$;
reset role;
insert into t_results (label, result) select 'L.G.C untouched (members)', (select count(*) from public.group_members where group_id = private.legacy_group() and created_at > now() - interval '1 minute')::text;
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
