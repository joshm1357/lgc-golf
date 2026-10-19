-- Personal links test (20 Oct 2026). STAGING only, after 046. Everything is rolled back; the results come back as the
-- error message ("RESULTS: ..."). Expected answers are in personal_links.expected.txt.
--
-- Group P: po — organiser (signed in); mike — a player on a phone-only sign-in, with scores history;
--   mg — Mike's new proper sign-in (Google); nosy — signed in, in no group; anon — phone-only, in no group;
--   sam — a player whose link someone else (mg) tries after Mike; pq — organiser of another group Q.

create temp table t_results (n serial, label text, result text);
grant all on t_results to authenticated;
grant all on sequence t_results_n_seq to authenticated;
create temp table t_tok (k text primary key, v text);
grant all on t_tok to authenticated;

insert into public.groups (id, slug, name, group_pin, admin_pin) values
  ('00000000-0000-4000-8000-00000000f000', 'test-p', 'Test Group P', 'P-CODE-TEST-1', 'p-admin-1234'),
  ('00000000-0000-4000-8000-00000000f100', 'test-q', 'Test Group Q', 'Q-CODE-TEST-1', 'q-admin-1234');
insert into auth.users (id, instance_id, aud, role, is_anonymous, email) values
  ('00000000-0000-4000-8000-0000000f0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'po@example.com'),
  ('00000000-0000-4000-8000-0000000f0a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, null),
  ('00000000-0000-4000-8000-0000000f0a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'mike@example.com'),
  ('00000000-0000-4000-8000-0000000f0a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'nosy@example.com'),
  ('00000000-0000-4000-8000-0000000f0a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, null),
  ('00000000-0000-4000-8000-0000000f0a06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, 'pq@example.com');
insert into public.players (id, group_id, name, nickname, handicap) values
  ('00000000-0000-4000-8000-0000000f0b01', '00000000-0000-4000-8000-00000000f000', 'P Organiser', null, 10),
  ('00000000-0000-4000-8000-0000000f0b02', '00000000-0000-4000-8000-00000000f000', 'Mike Morris', 'Mike', 18),
  ('00000000-0000-4000-8000-0000000f0b03', '00000000-0000-4000-8000-00000000f000', 'Sam Smith', null, 20),
  ('00000000-0000-4000-8000-0000000f0b10', '00000000-0000-4000-8000-00000000f100', 'Q Organiser', null, 9);
insert into public.group_members (group_id, user_id, player_id, role) values
  ('00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-0000000f0a01', '00000000-0000-4000-8000-0000000f0b01', 'organiser'),
  ('00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-0000000f0a02', '00000000-0000-4000-8000-0000000f0b02', 'player'),
  ('00000000-0000-4000-8000-00000000f100', '00000000-0000-4000-8000-0000000f0a06', '00000000-0000-4000-8000-0000000f0b10', 'organiser');
insert into public.handicap_history (group_id, player_id, old_handicap, new_handicap, reason) values
  ('00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-0000000f0b02', 20, 18, 'Tribunal');

set local role authenticated;

-- ================= po — organiser makes links =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f000"}', true); end $$;
insert into t_tok values ('mike', public.create_player_link('00000000-0000-4000-8000-0000000f0b02'));
insert into t_results (label, result) select 'link is 12 characters', length(v)::text from t_tok where k = 'mike';
insert into t_tok values ('mike-old', (select v from t_tok where k = 'mike'));
update t_tok set v = public.create_player_link('00000000-0000-4000-8000-0000000f0b02') where k = 'mike';
insert into t_results (label, result) select 'a new link replaces the old one', (a.v <> b.v)::text from t_tok a, t_tok b where a.k = 'mike' and b.k = 'mike-old';
insert into t_tok values ('sam', public.create_player_link('00000000-0000-4000-8000-0000000f0b03'));
do $$ begin
  perform public.create_player_link('00000000-0000-4000-8000-0000000f0b10');
  insert into t_results (label, result) values ('link for another group''s player', 'made');
exception when others then insert into t_results (label, result) values ('link for another group''s player', 'refused'); end $$;
do $$ declare n int; begin
  select count(*) into n from public.player_links;
  insert into t_results (label, result) values ('read the links table', n::text);
exception when others then insert into t_results (label, result) values ('read the links table', 'refused'); end $$;
insert into t_results (label, result)
  select 'organiser sees Mike: phones / signed in / link waiting',
         (x->>'phones') || ' / ' || (x->>'signed_in') || ' / ' || (x->>'link_waiting')
  from json_array_elements(public.player_sign_ins()) x where x->>'player_id' = '00000000-0000-4000-8000-0000000f0b02';

-- ================= Mike's old phone (phone-only player) can't make links or see sign-ins =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a02","role":"authenticated"}';
do $$ begin
  perform public.create_player_link('00000000-0000-4000-8000-0000000f0b03');
  insert into t_results (label, result) values ('player makes a link', 'made');
exception when others then insert into t_results (label, result) values ('player makes a link', 'refused'); end $$;
do $$ begin
  perform public.player_sign_ins();
  insert into t_results (label, result) values ('player sees who''s signed in', 'yes');
exception when others then insert into t_results (label, result) values ('player sees who''s signed in', 'refused'); end $$;

-- ================= pq — organiser of group Q can't see P's =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a06","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f000"}', true); end $$;
insert into t_results (label, result)
  select 'Q organiser asking for P''s sign-ins sees', coalesce(string_agg(x->>'player_id', ','), 'only Q') from json_array_elements(public.player_sign_ins()) x
  where x->>'player_id' like '00000000-0000-4000-8000-0000000f0b0%';
do $$ begin
  perform public.create_player_link('00000000-0000-4000-8000-0000000f0b02');
  insert into t_results (label, result) values ('Q organiser makes a link for P''s Mike', 'made');
exception when others then insert into t_results (label, result) values ('Q organiser makes a link for P''s Mike', 'refused'); end $$;
do $$ begin perform set_config('request.headers', '{}', true); end $$;

-- ================= anon — a phone-only sign-in opens Mike's link =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a05","role":"authenticated"}';
insert into t_results (label, result)
  select 'phone-only reads the link: name / group / state / signed in',
         (x->>'player_name') || ' / ' || (x->>'group_name') || ' / ' || (x->>'state') || ' / ' || (x->>'signed_in')
  from (select public.player_link_info(v) x from t_tok where k = 'mike') s;
do $$ begin
  perform public.claim_player_link((select v from t_tok where k = 'mike'));
  insert into t_results (label, result) values ('phone-only uses the link', 'claimed');
exception when others then insert into t_results (label, result) values ('phone-only uses the link', 'refused: ' || left(sqlerrm, 28)); end $$;
insert into t_results (label, result) select 'old link says', (public.player_link_info(v)->>'state') from t_tok where k = 'mike-old';

-- ================= mg — Mike signs in properly and uses his link =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a03","role":"authenticated"}';
do $$ begin
  perform public.claim_player_link((select v from t_tok where k = 'mike-old'));
  insert into t_results (label, result) values ('the replaced link', 'claimed');
exception when others then insert into t_results (label, result) values ('the replaced link', 'refused: ' || left(sqlerrm, 26)); end $$;
insert into t_results (label, result) select 'Mike uses his link → group', (public.claim_player_link(v) = '00000000-0000-4000-8000-00000000f000')::text from t_tok where k = 'mike';
insert into t_results (label, result) select 'tapping it again is fine', (public.claim_player_link(v) = '00000000-0000-4000-8000-00000000f000')::text from t_tok where k = 'mike';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f000"}', true); end $$;
insert into t_results (label, result) select 'Mike''s new sign-in: player / role / signed in',
  ((public.my_status()->>'player_id') = '00000000-0000-4000-8000-0000000f0b02')::text || ' / ' || (public.my_status()->>'role') || ' / ' || (public.my_status()->>'signed_in');
insert into t_results (label, result) select 'Mike sees his handicap history', count(*)::text from public.handicap_history where player_id = '00000000-0000-4000-8000-0000000f0b02';
-- Mike now tries Sam's link: he's already Mike in this group.
do $$ begin
  perform public.claim_player_link((select v from t_tok where k = 'sam'));
  insert into t_results (label, result) values ('Mike uses Sam''s link', 'claimed');
exception when others then insert into t_results (label, result) values ('Mike uses Sam''s link', 'refused: ' || left(sqlerrm, 30)); end $$;
do $$ begin perform set_config('request.headers', '{}', true); end $$;

-- ================= Mike's old phone still works =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a02","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f000"}', true); end $$;
insert into t_results (label, result) select 'old phone still Mike', ((public.my_status()->>'player_id') = '00000000-0000-4000-8000-0000000f0b02')::text;
do $$ begin perform set_config('request.headers', '{}', true); end $$;

-- ================= nosy — someone else signed in tries Mike's used link, then guesses =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a04","role":"authenticated"}';
insert into t_results (label, result) select 'used link says', (public.player_link_info(v)->>'state') from t_tok where k = 'mike';
do $$ begin
  perform public.claim_player_link((select v from t_tok where k = 'mike'));
  insert into t_results (label, result) values ('someone else uses Mike''s used link', 'claimed');
exception when others then insert into t_results (label, result) values ('someone else uses Mike''s used link', 'refused: ' || left(sqlerrm, 31)); end $$;
insert into t_results (label, result) select 'nosy is in group P', exists (select 1 from public.group_members where group_id = '00000000-0000-4000-8000-00000000f000' and user_id = '00000000-0000-4000-8000-0000000f0a04')::text;
insert into t_results (label, result) values ('wrong link', coalesce(public.player_link_info('ZZZZZZZZZZZZ')::text, 'null'));

-- ================= po — organiser sees Mike signed in =================
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a01","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{"x-group-id":"00000000-0000-4000-8000-00000000f000"}', true); end $$;
insert into t_results (label, result)
  select 'organiser sees Mike: phones / signed in / email / link waiting',
         (x->>'phones') || ' / ' || (x->>'signed_in') || ' / ' || (x->>'email') || ' / ' || (x->>'link_waiting')
  from json_array_elements(public.player_sign_ins()) x where x->>'player_id' = '00000000-0000-4000-8000-0000000f0b02';
-- An expired link
update t_tok set v = public.create_player_link('00000000-0000-4000-8000-0000000f0b03') where k = 'sam';
reset role;
update public.player_links set expires_at = now() - interval '1 minute' where token = (select v from t_tok where k = 'sam');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000f0a04","role":"authenticated"}';
do $$ begin perform set_config('request.headers', '{}', true); end $$;
insert into t_results (label, result) select 'expired link says', (public.player_link_info(v)->>'state') from t_tok where k = 'sam';
do $$ begin
  perform public.claim_player_link((select v from t_tok where k = 'sam'));
  insert into t_results (label, result) values ('expired link used', 'claimed');
exception when others then insert into t_results (label, result) values ('expired link used', 'refused: ' || left(sqlerrm, 27)); end $$;

reset role;
do $$ begin
  raise exception 'RESULTS: %', (select string_agg(label || ' = ' || result, ' | ' order by n) from t_results);
end $$;
