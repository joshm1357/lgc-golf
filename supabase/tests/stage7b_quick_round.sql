-- Stage 7b test: the quick round. STAGING only, after 035, 036 and 036b. Rolled back; results in the error message.
update private.platform_flags set is_on = true where key = 'new_groups_open';  -- 047: new groups on for this test (rolled back)
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated, anon;
grant all on sequence t_results_n_seq to authenticated, anon;
create temp table t_ids (k text, id uuid, extra text);
grant all on t_ids to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000b0002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);
insert into public.course_library (slug, name, area, holes) values ('zzqx-quick-links', 'Zzqx Quick Links', 'Bowral NSW',
  (select jsonb_agg(jsonb_build_object('n', g, 'par', case when g in (3, 12) then 3 when g in (5, 14) then 5 else 4 end, 'si', g)) from generate_series(1, 18) g));

-- Anyone, not signed in, sees the course page.
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
insert into t_results (label, result) select 'course page without signing in', (p ->> 'name') || ' / ' || json_array_length(p -> 'holes') || ' holes'
  from (select public.course_page('zzqx-quick-links') p) x;
do $$ begin perform public.start_quick_round('zzqx-quick-links', 'Nobody', 18, 'stableford', '{3}', '{5}', '{}'); insert into t_results (label, result) values ('start a round with no session at all', 'ok');
exception when others then insert into t_results (label, result) values ('start a round with no session at all', 'refused'); end $$;

-- A phone-only organiser starts a Stableford round.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000b0001","role":"authenticated"}';
insert into t_ids select 'q', (r ->> 'group_id')::uuid, r ->> 'invite' from (select public.start_quick_round('zzqx-quick-links', 'Josh', 14.2, 'stableford', '{3,12,99}', '{5}',
  '{"ref":"BOWRAL1","placement":"cart","junk":"x<script>"}') r) x;
insert into t_results (label, result) select 'quick group', g.name || ' / quick ' || g.quick from public.groups g where g.id = (select id from t_ids where k = 'q');
do $$ begin perform set_config('request.headers', json_build_object('x-group-id', (select id from t_ids where k = 'q'))::text, true); end $$;
insert into t_results (label, result) select 'the round', r.format || ' / ' || r.status || ' / ctp ' || r.ctp_holes::text || ' / ld ' || r.ld_holes::text || ' / ' || (r.play_date is not null)
  from public.rounds r where r.group_id = (select id from t_ids where k = 'q');
insert into t_results (label, result) select 'on the round', string_agg(p.name || ' ' || rp.playing_handicap, ', ') from public.round_players rp join public.players p on p.id = rp.player_id
  join public.rounds r on r.id = rp.round_id where r.group_id = (select id from t_ids where k = 'q');
insert into t_results (label, result) select 'features: feed / side comps / trophies / tribunal', public.feature_on(id, 'feed') || ' / ' || public.feature_on(id, 'side_comps') || ' / ' || public.feature_on(id, 'trophies') || ' / ' || public.feature_on(id, 'tribunal') from t_ids where k = 'q';
insert into t_results (label, result) select 'my_status says quick', (public.my_status() ->> 'quick');

-- A mate opens the guest link and adds just a name: approved and in the round straight away.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000b0002","role":"authenticated"}';
select public.join_by_invite((select extra from t_ids where k = 'q'));
insert into t_results (label, result) select 'mate joins as', role from public.group_members where user_id = auth.uid() and group_id = (select id from t_ids where k = 'q');
select public.create_my_player('Mike', null, 18, null);
insert into t_results (label, result) select 'mate approved and on the round', p.approved || ' / ' || (select count(*) from public.round_players rp where rp.player_id = p.id)
  from public.players p where p.group_id = (select id from t_ids where k = 'q') and p.name = 'Mike';
do $$ begin perform public.create_my_player('Mike again', null, 18, null); insert into t_results (label, result) values ('the same mate adds a second player', 'ok');
exception when others then insert into t_results (label, result) values ('the same mate adds a second player', 'refused'); end $$;
do $$ begin perform public.make_group_official(); insert into t_results (label, result) values ('guest makes it official', 'ok');
exception when others then insert into t_results (label, result) values ('guest makes it official', 'refused'); end $$;

-- Bad input.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000b0001","role":"authenticated"}';
do $$ declare a text[]; begin
  foreach a slice 1 in array array[['no-such-course', 'Josh', '14', 'stableford'], ['zzqx-quick-links', '', '14', 'stableford'],
                                     ['zzqx-quick-links', 'Josh', '70', 'stableford'], ['zzqx-quick-links', 'Josh', '14', 'matchplay']] loop
    begin perform public.start_quick_round(a[1], a[2], a[3]::numeric, a[4], '{}', '{}', '{}'); insert into t_results (label, result) values ('bad quick round', 'ok');
    exception when others then insert into t_results (label, result) values ('bad quick round', 'refused'); end;
  end loop;
end $$;

-- The organiser makes it official.
do $$ begin perform set_config('request.headers', json_build_object('x-group-id', (select id from t_ids where k = 'q'))::text, true); end $$;
select public.make_group_official();
insert into t_results (label, result) select 'made official', (not quick)::text from public.groups where id = (select id from t_ids where k = 'q');
insert into t_results (label, result) select 'mates become players', string_agg(role, ',' order by role) from public.group_members where group_id = (select id from t_ids where k = 'q');
reset role;
insert into t_results (label, result) select 'library use counted only once official', copies::text from public.course_library where slug = 'zzqx-quick-links';
insert into t_results (label, result) select 'where it came from (tidied)', source::text from public.groups where id = (select id from t_ids where k = 'q');
-- In an ordinary group (L.G.C), a new player still waits for approval and isn't put in any round.
with x as (insert into public.players (group_id, name, handicap, approved) values (private.legacy_group(), 'Zzqx Test', 18, false) returning id)
insert into t_ids select 'lp', id, null from x;
insert into t_results (label, result) select 'ordinary group unchanged', p.approved || ' / ' || (select count(*) from public.round_players where player_id = p.id)
  from public.players p where p.id = (select id from t_ids where k = 'lp');
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
