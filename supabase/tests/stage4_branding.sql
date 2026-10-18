-- Stage 4 test: each group's look. STAGING only, after 031 and 031b. Rolled back; results in the error message.
create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;

insert into public.groups (id, slug, name, group_pin) values ('00000000-0000-4000-8000-00000000a900', 'test-g', 'Test Group G', 'G-CODE-TEST-1');
insert into auth.users (id, instance_id, aud, role) values
  ('00000000-0000-4000-8000-00000000a901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000a902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.group_members (group_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000a900', '00000000-0000-4000-8000-00000000a901', 'organiser'),
  ('00000000-0000-4000-8000-00000000a900', '00000000-0000-4000-8000-00000000a902', 'player');

insert into storage.objects (bucket_id, name) values ('photos', '00000000-0000-4000-8000-00000000a900/crest/1.png');
insert into public.group_invites (group_id, token, role) values ('00000000-0000-4000-8000-00000000a900', 'GINVITETEST1', 'player');
insert into t_results (label, result) select 'L.G.C look', short_name || ' / ' || crest_url || ' / ' || colour_primary || ' / ' || colour_accent || ' / ' || font from public.groups where legacy;
insert into t_results (label, result) select 'new group look', coalesce(short_name, '-') || ' / ' || coalesce(crest_url, 'plain') || ' / ' || colour_primary || ' / ' || colour_accent || ' / ' || font from public.groups where id = '00000000-0000-4000-8000-00000000a900';

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000a902","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000a900"}', true); end $$;
do $$ begin
  perform public.set_group_look('Hijacked', null, '#000000', '#FFFFFF', 'plain', null);
  insert into t_results (label, result) values ('player changes the look', 'ok');
exception when others then insert into t_results (label, result) values ('player changes the look', 'refused'); end $$;

set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000a901","role":"authenticated"}';
select public.set_group_look('The Mulligans', 'MULL', '#123456', '#F0C040', 'serif', 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/photos/00000000-0000-4000-8000-00000000a900/crest/1.png');
insert into t_results (label, result) select 'organiser sets the look', (s ->> 'group_name') || ' / ' || (s -> 'look' ->> 'short_name') || ' / ' || (s -> 'look' ->> 'primary') || ' / ' || (s -> 'look' ->> 'font')
  from (select public.my_status() s) x;
do $$ begin
  perform public.set_group_look('The Mulligans', null, '#123456', '#F0C040', 'serif', 'https://x.supabase.co/storage/v1/object/public/photos/' || private.legacy_group() || '/crest/1.jpg');
  insert into t_results (label, result) values ('crest from another group''s folder', 'ok');
exception when others then insert into t_results (label, result) values ('crest from another group''s folder', 'refused'); end $$;
do $$ begin
  perform public.set_group_look('The Mulligans', null, '#123456', '#F0C040', 'serif', 'builtin:lgc');
  insert into t_results (label, result) values ('L.G.C crest in another group', 'ok');
exception when others then insert into t_results (label, result) values ('L.G.C crest in another group', 'refused'); end $$;
do $$ begin
  perform public.set_group_look('The Mulligans', null, 'red', '#F0C040', 'serif', null);
  insert into t_results (label, result) values ('colour that isn''t a colour', 'ok');
exception when others then insert into t_results (label, result) values ('colour that isn''t a colour', 'refused'); end $$;
do $$ begin
  perform public.set_group_look('The Mulligans', null, '#123456', '#F0C040', 'comic_sans', null);
  insert into t_results (label, result) values ('font that isn''t offered', 'ok');
exception when others then insert into t_results (label, result) values ('font that isn''t offered', 'refused'); end $$;
do $$ declare u text; begin
  foreach u in array array[
    'https://evil.example/storage/v1/object/public/photos/00000000-0000-4000-8000-00000000a900/crest/1.png',
    'data:image/svg+xml,<svg/><!--/storage/v1/object/public/photos/00000000-0000-4000-8000-00000000a900/crest/1.png-->',
    'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/photos/00000000-0000-4000-8000-00000000a900/crest/../../x/1.png',
    'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/photos/00000000-0000-4000-8000-00000000a900/crest/2.png'] loop
    begin
      perform public.set_group_look('The Mulligans', null, '#123456', '#F0C040', 'serif', u);
      insert into t_results (label, result) values ('crest ' || left(u, 30) || '…', 'ok');
    exception when others then insert into t_results (label, result) values ('crest ' || left(u, 30) || '…', 'refused'); end;
  end loop;
end $$;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000a902","role":"authenticated"}';
insert into t_results (label, result) select 'invite shows the look', (i -> 'look' ->> 'short_name') || ' / ' || (i -> 'look' ->> 'primary') || ' / ' || (i -> 'look' ->> 'name')
  from (select public.invite_info('GINVITETEST1') i) x;
insert into t_results (label, result) select 'G sees L.G.C''s look', count(*)::text from public.groups where legacy;

reset role;
do $$ begin raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results); end $$;
