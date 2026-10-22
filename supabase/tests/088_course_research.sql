-- Course research import (088, ov17, 22 Oct 2026). STAGING only, after 088. Everything is rolled back; the results
-- come back as the error message ("RESULTS: ..."). Expected answers are in 088_course_research.expected.txt.
--
-- Checks import_course_research: only the platform admin (or the service role) can run it; the compact form; exact /
-- near / new / unmatched matching (a new course becomes a library listing with no holes and no map position; a closed
-- one isn't added); re-running the same file changes nothing and adds nothing; a changed fee updates the row; the
-- guide is replaced by key and a section that's gone is switched off (not deleted); anyone signed in reads the
-- research, a visitor with no sign-in can't; the report.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated, anon, service_role;
grant all on sequence t_results_n_seq to authenticated, anon, service_role;
create temp table t_lib_count (n int);
grant all on t_lib_count to authenticated, anon, service_role;

insert into auth.users (id, instance_id, aud, role, is_anonymous, email) values
  ('00000000-0000-4000-8000-0000000c8a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'research-admin@example.com'),
  ('00000000-0000-4000-8000-0000000c8a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'research-player@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000c8a01');
-- Two library courses to match against: one in its own town, one listed under the suburb next door.
insert into public.course_library (id, slug, name, area, lat, lng, holes) values
  ('00000000-0000-4000-8000-0000000c8b01', 'zzqtestville-golf-club', 'Zzqtestville Golf Club', 'Zzqtestville NSW', -30.5, 151.5, '[]'),
  ('00000000-0000-4000-8000-0000000c8b02', 'zzqotherplace-gc', 'Zzqotherplace GC', 'Zzqfarfield NSW', -30.6, 151.6, '[]');

-- The file (compact form): exact, near (another town), new, closed.
create temp table t_payload (v jsonb, guides jsonb, guides2 jsonb);
grant all on t_payload to authenticated, anon, service_role;
insert into t_payload values (
  '{"c":["import_key","match_keys","match_towns","name","town","state","region","fee_weekday","access_type","good_for_groups","sources","last_checked","d.visitor_times"],
    "r":[["zzqtestville|NSW",["zzqtestville"],["zzqtestville"],"Zzqtestville Golf Club","Zzqtestville","NSW","Zzq Region",55,"public",4,["https://example.com/a"],"2026-10-01","Visitors welcome 7 days"],
         ["zzqotherplace|NSW",["zzqotherplace"],["zzqnearby"],"Zzqotherplace Golf Club","Zzqnearby","NSW","Zzq Region",70,"semi_private",3,[],"2026-10-01","After 11:30 Saturdays"],
         ["zzqbrandnew|NSW",["zzqbrandnew"],["zzqnowhere"],"Zzqbrandnew Links?","Zzqnowhere (12 Some St)","NSW","Zzq Region",null,"public"],
         ["zzqgone|NSW",["zzqgone"],["zzqnowhere"],"Zzqgone Golf Club","Zzqnowhere","NSW","Zzq Region",null,"closed"]]}',
  '[{"key":"zzq-access-types","kind":"general","title":"How to read access","body":"public: anyone can book."},
    {"key":"zzq-region","kind":"region","title":"NSW: Zzq Region","state":"NSW","regions":["Zzq Region"],"body":"Book after 11:30 on Saturdays."}]',
  '[{"key":"zzq-access-types","kind":"general","title":"How to read access","body":"public: anyone can book (updated)."}]');

insert into t_lib_count select count(*) from public.course_library;
set local role authenticated;

-- ================= A player (signed in, not the platform admin) =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c8a02","role":"authenticated"}';
do $$ begin
  perform public.import_course_research((select v from t_payload), null);
  insert into t_results (label, result) values ('player: import', 'allowed');
exception when others then insert into t_results (label, result) values ('player: import', 'refused: ' || left(sqlerrm, 40)); end $$;
do $$ begin
  perform public.course_research_report();
  insert into t_results (label, result) values ('player: report', 'allowed');
exception when others then insert into t_results (label, result) values ('player: report', 'refused'); end $$;

-- ================= The platform admin =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c8a01","role":"authenticated"}';
insert into t_results (label, result)
  select 'admin: first import', (select (r->>'rows') || ' rows, ' || (r->>'inserted') || ' in, exact ' || (r->>'exact') || ', near ' || (r->>'near')
         || ', new ' || (r->>'new') || ', unmatched ' || (r->>'unmatched') || ' (' || (r->'unmatched_names'->>0) || '), guides ' || (r->>'guides')
         from (select public.import_course_research((select v from t_payload), (select guides from t_payload))::jsonb r) s);
insert into t_results (label, result)
  select 'exact → its library course', (library_id = '00000000-0000-4000-8000-0000000c8b01')::text || ' / ' || match from public.course_research where import_key = 'zzqtestville|NSW';
insert into t_results (label, result)
  select 'near → the one next door', (library_id = '00000000-0000-4000-8000-0000000c8b02')::text || ' / ' || match from public.course_research where import_key = 'zzqotherplace|NSW';
insert into t_results (label, result)
  select 'closed → no library course', coalesce(library_id::text, 'none') || ' / ' || match from public.course_research where import_key = 'zzqgone|NSW';
insert into t_results (label, result)
  select 'typed + details + sources', fee_weekday || ' / ' || access_type || ' / ' || good_for_groups || ' / ' || (details->>'visitor_times') || ' / ' || sources[1] || ' / ' || last_checked
  from public.course_research where import_key = 'zzqtestville|NSW';

-- Same file again: nothing changes, nothing is added.
insert into t_results (label, result)
  select 'admin: same file again', (select 'inserted ' || (r->>'inserted') || ', updated ' || (r->>'updated') || ', unchanged ' || (r->>'unchanged')
         from (select public.import_course_research((select v from t_payload), (select guides from t_payload))::jsonb r) s);
insert into t_results (label, result)
  select 'still one row each', (select count(*) from public.course_research where import_key like 'zzq%')::text;
insert into t_results (label, result)
  select 'guide updated_at kept', (select (updated_at < now() + interval '1 hour')::text from public.region_guides where key = 'zzq-region');

-- A newer file: the fee changed (list-of-objects form this time).
insert into t_results (label, result)
  select 'admin: newer file (fee 60)', (select 'inserted ' || (r->>'inserted') || ', updated ' || (r->>'updated') || ', exact ' || (r->>'exact')
         from (select public.import_course_research('[{"import_key":"zzqtestville|NSW","name":"Zzqtestville Golf Club","town":"Zzqtestville","state":"NSW","fee_weekday":60,"access_type":"public"}]'::jsonb, null)::jsonb r) s);
insert into t_results (label, result)
  select 'fee now / still its library course', fee_weekday || ' / ' || (library_id = '00000000-0000-4000-8000-0000000c8b01')::text from public.course_research where import_key = 'zzqtestville|NSW';

-- The guide again, with one section gone: replaced by key, the missing one switched off.
insert into t_results (label, result)
  select 'admin: guide again (one section)', (select 'guides ' || (r->>'guides') || ', switched off ' || (r->>'guides_removed')
         from (select public.import_course_research('[]'::jsonb, (select guides2 from t_payload))::jsonb r) s);
insert into t_results (label, result)
  select 'guide sections: body / region active', (select body from public.region_guides where key = 'zzq-access-types') || ' / '
         || (select active::text from public.region_guides where key = 'zzq-region');

-- A bad row is refused (and nothing from that call is kept).
do $$ begin
  perform public.import_course_research('[{"import_key":"Bad Key","name":"x","state":"NSW"}]'::jsonb, null);
  insert into t_results (label, result) values ('admin: bad row', 'allowed');
exception when others then insert into t_results (label, result) values ('admin: bad row', 'refused: ' || left(sqlerrm, 12)); end $$;

insert into t_results (label, result)
  select 'admin: report unmatched includes the closed one', ((public.course_research_report()->'unmatched')::jsonb ? 'Zzqgone Golf Club (Zzqnowhere NSW)')::text;

-- ================= Reading =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c8a02","role":"authenticated"}';
insert into t_results (label, result)
  select 'player reads research / guides', (select count(*) from public.course_research where import_key like 'zzq%')::text || ' / '
         || (select count(*) from public.region_guides where key like 'zzq-%')::text;
do $$ begin
  update public.course_research set fee_weekday = 1 where import_key = 'zzqtestville|NSW';
  insert into t_results (label, result) values ('player: change a row', case when found then 'changed' else 'nothing changed' end);
exception when others then insert into t_results (label, result) values ('player: change a row', 'refused'); end $$;

set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
do $$ begin
  perform count(*) from public.course_research;
  insert into t_results (label, result) values ('no sign-in: read research', 'allowed');
exception when others then insert into t_results (label, result) values ('no sign-in: read research', 'refused'); end $$;
do $$ begin
  perform public.import_course_research('[]'::jsonb, null);
  insert into t_results (label, result) values ('no sign-in: import', 'allowed');
exception when others then insert into t_results (label, result) values ('no sign-in: import', 'refused'); end $$;

-- ================= The service role (the importer's SQL files) =================
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';
insert into t_results (label, result)
  select 'service role: import', (select 'unchanged ' || (r->>'unchanged') from (select public.import_course_research(
    '[{"import_key":"zzqtestville|NSW","name":"Zzqtestville Golf Club","town":"Zzqtestville","state":"NSW","fee_weekday":60,"access_type":"public"}]'::jsonb, null)::jsonb r) s);

reset role;
-- (Read as the database owner: the library isn't readable directly from the app.)
insert into t_results (label, result)
  select 'new → a listing: name / area / holes / no map position', l.name || ' / ' || l.area || ' / ' || jsonb_array_length(l.holes) || ' / ' || (l.lat is null)::text
  from public.course_research r join public.course_library l on l.id = r.library_id where r.import_key = 'zzqbrandnew|NSW';
insert into t_results (label, result)
  select 'library grew by (after three imports)', ((select count(*) from public.course_library) - (select n from t_lib_count))::text;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
