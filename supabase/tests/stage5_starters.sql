-- Stage 5 test: starter rulebooks. STAGING only, after 032. Rolled back; results in the error message.
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
insert into public.groups (id, slug, name, group_pin) values ('00000000-0000-4000-8000-00000000ab00', 'test-h', 'Test Group H', 'H-CODE-TEST-1');
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-00000000ab01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000ab02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.group_members (group_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000ab00', '00000000-0000-4000-8000-00000000ab01', 'organiser'),
  ('00000000-0000-4000-8000-00000000ab00', '00000000-0000-4000-8000-00000000ab02', 'player');
set local role authenticated;
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000ab00"}', true); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000ab02","role":"authenticated"}';
do $$ begin perform public.use_starter_rulebook('just_scoring'); insert into t_results (label, result) values ('player picks a starter', 'ok');
exception when others then insert into t_results (label, result) values ('player picks a starter', 'refused'); end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000ab01","role":"authenticated"}';
do $$ begin perform public.use_starter_rulebook('nonsense'); insert into t_results (label, result) values ('unknown starter', 'ok');
exception when others then insert into t_results (label, result) values ('unknown starter', 'refused'); end $$;
insert into t_results (label, result) values ('organiser picks Ambrose and Stableford', public.use_starter_rulebook('ambrose_stableford')::text);
insert into t_results (label, result) select 'rules are the group''s and in force', count(*) filter (where group_id = '00000000-0000-4000-8000-00000000ab00' and status = 'active')::text || ' / names: ' || bool_or(title ilike '%BD%' or detail ilike '%putt buddies%' or detail ilike '%L.G.C%')::text from public.rules;
do $$ begin perform public.use_starter_rulebook('just_scoring'); insert into t_results (label, result) values ('second starter on top', 'ok');
exception when others then insert into t_results (label, result) values ('second starter on top', 'refused'); end $$;
insert into t_results (label, result) select 'L.G.C rules untouched', count(*)::text from public.rules where group_id = private.legacy_group() and created_at > now() - interval '1 minute';
reset role;
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
