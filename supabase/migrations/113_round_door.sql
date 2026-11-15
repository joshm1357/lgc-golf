-- 113 — Open the round door (ov44, Josh 15 Nov 2026; claude/round-door-addendum.md). RUNS AFTER 111 AND 112.
--
-- ADDITIVE ONLY: two switches' worth of small tables, six new functions, and six existing functions re-made with a
-- small change each (same names, same arguments). Nothing is dropped or renamed. Old app versions keep working:
-- v10.7 has no ask screens at all, and nothing here changes what its screens call.
--
-- In plain words:
--   1. THE DOOR. Starting a group stays invite-only (047's new_groups_open is untouched). A second switch,
--      round_asks_open, lets anyone signed in ask some mates for a round with no group. Behind the scenes that makes a
--      hidden quick group, which 047's lock refused — so the lock now lets through exactly that one case (a quick
--      group being made by start_round_ask while the round door is open) and nothing else. "Make it official" (a quick
--      group becoming a proper one) is refused while groups are invite-only, so the round door isn't a back way in.
--      OFF here. Turn it on per database:  update private.platform_flags set is_on = true where key = 'round_asks_open';
--   2. THE LINK'S PREVIEW. ask_preview(token) gives a chat app the ask in outline: who asked (first name), the days /
--      times / how far ahead, the course, whether it's still open, and the picture. Never an answer, the name of
--      anyone who answered, an email or a mobile. ask_set_card keeps the picture's address on the ask.
--   3. WHO SEES CONTACTS. A link answerer's email or mobile: whoever asked and that group's organisers. Not the
--      person booking any more (Josh 15 Nov) — they see names.
--   4. LIMITS. On top of 60 answers an ask: at most 6 new link answers per ask per day from one internet connection.
--      The connection is kept only as a scrambled daily mark (the same way club QR scans are counted, 038) — never an
--      address, and it can't be worked back to a phone.
--   5. COUNTING THE DOOR. door_counts: how many times each step happened per day, by where people came from. No
--      person, no phone, no ask attached. Josh's screen reads it with admin_door_funnel.
--   6. TIDY-UP. A hidden quick group whose ask closed over 30 days ago, where nobody but the asker answered and no
--      round was made, is deleted by a nightly job (the asker's account is untouched).
--   7. The ask's link says whether to show weather on the dates; new no-group asks have weather switched on.
--   8. An index so the Caddie box's AI uses can be counted per month (the platform cap, ASK_AI_MONTH_CAP).

-- =================================================================================================== 1. the door
insert into private.platform_flags (key, is_on, note)
values ('round_asks_open', false, 'Anyone signed in may ask some mates for a round with no group (a hidden quick group). Starting a group stays with new_groups_open.')
on conflict (key) do nothing;

-- 047's lock, with one way through: start_round_ask's hidden quick group, while the round door is open.
create or replace function private.new_groups_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Only people using the app are stopped; migrations and the SQL editor have no signed-in user.
  if auth.uid() is not null and not private.flag_on('new_groups_open') and not private.is_platform_admin() then
    if coalesce(new.quick, false) and current_setting('lgc.round_ask', true) = 'on' and private.flag_on('round_asks_open') then
      return new;
    end if;
    raise exception 'The Golf Trip is invite-only while we test it. Got an invite link? Open it to join your group.';
  end if;
  return new;
end $$;
revoke all on function private.new_groups_guard() from public, anon, authenticated;

-- So the app can say so before anyone fills in the ask.
create or replace function public.round_asks_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.flag_on('round_asks_open') or private.flag_on('new_groups_open') or private.is_platform_admin();
$$;
revoke all on function public.round_asks_open() from public;
grant execute on function public.round_asks_open() to anon, authenticated;

-- 111's start_round_ask, with three changes: it checks the round door, tells the lock it's a round ask, and switches
-- weather on for the hidden group (so the dates can show a forecast). Same arguments, same answer.
create or replace function public.start_round_ask(p_my_name text, p_ask jsonb, p_spots int default 4, p_closes_at timestamptz default null,
  p_note text default null, p_library uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me text := btrim(regexp_replace(coalesce(p_my_name, ''), '[[:cntrl:]]+', ' ', 'g'));
        v_g uuid; v_p uuid; v_c uuid; v_slug text; v_base text; v_n int := 1; v_code text; v_plan uuid; l record;
begin
  if v_uid is null or coalesce((select is_anonymous from auth.users where id = v_uid), true) then
    raise exception 'Sign in with Google or an email code first — then you can see the answers come in' using errcode = '42501', hint = 'save_spot';
  end if;
  if not (private.flag_on('round_asks_open') or private.flag_on('new_groups_open') or private.is_platform_admin()) then
    raise exception 'Asking some mates for a round isn’t open yet. Got an invite link? Open it to join your group.';
  end if;
  if length(v_me) not between 1 and 30 then raise exception 'Your name needs 1–30 characters'; end if;
  perform pg_advisory_xact_lock(hashtext('create_group:' || v_uid::text));
  if (select count(*) from public.groups where created_by = v_uid and quick and created_at > now() - interval '1 day') >= 10 then
    raise exception 'That’s 10 asks today — try again tomorrow';
  end if;
  v_base := btrim(left(btrim(regexp_replace(lower(v_me || '-rounds'), '[^a-z0-9]+', '-', 'g'), '-'), 30), '-');
  if length(v_base) < 2 or private.reserved_slug(v_base) then v_base := 'rounds'; end if;
  loop
    v_code := private.random_code(10);
    exit when not exists (select 1 from public.groups where group_pin = v_code);
  end loop;
  perform set_config('lgc.round_ask', 'on', true);
  loop
    v_slug := case when v_n = 1 then v_base else v_base || '-' || v_n end;
    if not exists (select 1 from public.groups where slug = v_slug) then
      begin
        insert into public.groups (slug, name, group_pin, legacy, created_by, quick)
        values (v_slug, left(v_me || '’s rounds', 40), v_code, false, v_uid, true) returning id into v_g;
        exit;
      exception when unique_violation then null;
      end;
    end if;
    v_n := v_n + 1;
  end loop;
  perform set_config('lgc.round_ask', 'off', true);
  insert into public.group_members (group_id, user_id, role) values (v_g, v_uid, 'organiser');
  insert into public.group_features (group_id, feature_key, enabled)
  select v_g, f.key, f.key in ('side_comps', 'trophies', 'gps', 'planner', 'planner_tasks', 'notifications', 'games', 'weather',
                               'ask_usual_week', 'ask_where', 'ask_notes', 'ask_whos_in')
  from public.feature_catalogue f;
  insert into public.players (group_id, name, approved) values (v_g, v_me, true) returning id into v_p;
  update public.group_members set player_id = v_p where group_id = v_g and user_id = v_uid;
  if p_library is not null then
    select * into l from public.course_library where id = p_library and not hidden;
    if l.id is null then raise exception 'That course isn’t in the library'; end if;
    perform set_config('lgc.library_link', 'on', true);
    insert into public.courses (group_id, name, holes, library_id) values (v_g, l.name, l.holes, l.id) returning id into v_c;
    perform set_config('lgc.library_link', 'off', true);
    update public.course_library set copies = copies + 1 where id = l.id;
  end if;
  v_plan := private.ask_create(v_g, v_p, null, p_ask, p_spots, null, p_closes_at, p_note, v_c, null, null);
  return jsonb_build_object('group_id', v_g, 'plan_id', v_plan, 'token', (select ask_token from public.plans where id = v_plan));
end $$;
revoke all on function public.start_round_ask(text, jsonb, int, timestamptz, text, uuid) from public, anon;
grant execute on function public.start_round_ask(text, jsonb, int, timestamptz, text, uuid) to authenticated;

-- "Make it official" (036b), refused while starting a group is invite-only — otherwise a round ask would be a back way
-- to a proper group. Everything else as it was.
create or replace function public.make_group_official()
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  if not (select quick from public.groups where id = v_g) then return; end if;
  if not private.flag_on('new_groups_open') and not private.is_platform_admin() then
    raise exception 'Starting a group is invite-only while we test it. Your rounds keep working as they are.';
  end if;
  update public.groups set quick = false where id = v_g;
  update public.group_members set role = 'player' where group_id = v_g and role = 'guest';
  -- Now it's a real group using the course: count it in the library.
  update public.course_library l set copies = copies + 1
  where l.id in (select library_id from public.courses where group_id = v_g and library_id is not null);
end $$;
revoke all on function public.make_group_official() from public, anon;
grant execute on function public.make_group_official() to authenticated;

-- =================================================================================================== 2. the link's preview
-- 108's column for a share picture (here too, so this file stands on its own; the definition is the same).
alter table public.plans add column if not exists card_url text check (card_url is null or (char_length(card_url) <= 500 and card_url ~ '^https://'));

-- Keep the ask's share picture (drawn on the phone, uploaded to the group's photos like a trip idea's).
create or replace function public.ask_set_card(p_plan uuid, p_card_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.plans;
begin
  select * into v from public.plans where id = p_plan;
  if v.id is null or not v.callout or v.ask is null or not private.is_group_member(v.group_id) then raise exception 'Round not found'; end if;
  if not private.callout_can_manage(v) then raise exception 'Only whoever put it out can do that'; end if;
  if p_card_url is null or char_length(p_card_url) > 500 or p_card_url !~ '^https://[^\s]+/storage/v1/object/public/photos/[^\s]+$' then
    raise exception 'That picture address isn’t one of ours';
  end if;
  perform set_config('tgt.idea_ok', 'on', true);   -- 108 keeps the share fields to functions like this one
  update public.plans set card_url = p_card_url where id = v.id;
  perform set_config('tgt.idea_ok', 'off', true);
end $$;
revoke all on function public.ask_set_card(uuid, text) from public, anon;
grant execute on function public.ask_set_card(uuid, text) to authenticated;

-- What a chat app may know about an ask from its link: who asked (first name), the ask itself (days, times, how far
-- ahead — not where), the course, whether it's still open, and the picture. Nothing about who answered; no contacts.
-- Callable by anyone (the Cloudflare page function uses the public key). No match → null.
create or replace function public.ask_preview(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    'by', private.callout_first(p.created_by), 'ask', p.ask - 'place', 'course', p.location_name, 'status', p.status, 'card_url', p.card_url)
  end
  from (select 1) one
  left join public.plans p on p.ask_token = upper(btrim(coalesce(p_token, ''))) and coalesce(p_token, '') ~* '^\s*[23456789A-HJ-NP-Z]{16}\s*$'
                              and p.callout and p.ask is not null
$$;
revoke all on function public.ask_preview(text) from public;
grant execute on function public.ask_preview(text) to anon, authenticated;

-- =================================================================================================== 7. the link says "weather"
-- 111's ask_public plus two keys: quick (a no-group ask) and weather (show a forecast on the dates: no-group asks
-- always; in a proper group, when its Weather switch is on).
create or replace function public.ask_public(p_token text, p_key text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.plans; g public.callout_guests; v_member boolean := false; v_quick boolean := false;
begin
  select * into v from public.plans where ask_token = upper(btrim(coalesce(p_token, ''))) and callout;
  if v.id is null then raise exception 'That link isn’t working — ask whoever sent it for a new one'; end if;
  if auth.uid() is not null then v_member := coalesce(private.is_group_member(v.group_id), false) and private.my_player_id(v.group_id) is not null; end if;
  if nullif(p_key, '') is not null then
    select * into g from public.callout_guests where plan_id = v.id and key_hash = private.ask_key_hash(p_key);
  end if;
  select coalesce(quick, false) into v_quick from public.groups where id = v.group_id;
  return jsonb_build_object(
    'plan_id', v.id, 'group_id', v.group_id, 'name', v.name, 'status', v.status, 'ask', v.ask, 'ask_full', to_jsonb(v.ask_full), 'closes_at', v.closes_at,
    'spots', v.spots, 'course', v.location_name, 'by', private.callout_first(v.created_by), 'start_date', v.start_date,
    'tee_time', v.tee_time, 'booked', v.booked_at is not null, 'member', v_member,
    'quick', coalesce(v_quick, false), 'weather', coalesce(v_quick, false) or public.feature_on(v.group_id, 'weather'),
    'voting', exists (select 1 from public.plan_polls po where po.plan_id = v.id and po.kind = 'dates'),
    'answers', (select coalesce(jsonb_agg(jsonb_build_object('player_id', a.player_id, 'name', private.callout_first(a.player_id),
                  'slots', a.slots, 'cant', a.cant, 'first_at', a.first_at) order by a.first_at), '[]'::jsonb)
                from public.callout_answers a where a.plan_id = v.id),
    'me', case when g.player_id is null then null else jsonb_build_object(
      'player_id', g.player_id, 'name', (select name from public.players where id = g.player_id), 'email', g.email, 'phone', g.phone,
      'claimed', g.user_id is not null,
      'answer', (select jsonb_build_object('slots', a.slots, 'cant', a.cant, 'where', a."where") from public.callout_answers a where a.plan_id = v.id and a.player_id = g.player_id),
      'standing', (select jsonb_build_object('has_spot', o.has_spot, 'place', o.place) from private.callout_order(v.id) o where o.player_id = g.player_id)) end);
end $$;
revoke all on function public.ask_public(text, text) from public;
grant execute on function public.ask_public(text, text) to anon, authenticated;

-- =================================================================================================== 4. limits on link answers
-- One row per ask, per scrambled connection mark, per day: how many NEW answers came from it. Server only.
create table if not exists private.ask_link_marks (
  plan_id uuid not null references public.plans(id) on delete cascade,
  mark text not null,
  day date not null default current_date,
  n int not null default 0,
  primary key (plan_id, mark, day)
);
revoke all on private.ask_link_marks from public, anon, authenticated;

-- The mark: this connection, today, for this ask — scrambled with the server's salt (038), so it can't be worked back
-- to an address and doesn't link one ask to another. Null when the connection can't be told (then there's no limit
-- from here; the 60-an-ask ceiling still holds).
create or replace function private.ask_link_mark(p_plan uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_ip text := private.request_ip();
begin
  if v_ip is null then return null; end if;
  return md5(v_ip || current_date::text || p_plan::text || coalesce((select salt from private.scan_salt limit 1), ''));
end $$;
revoke all on function private.ask_link_mark(uuid) from public, anon, authenticated;

-- 111's ask_guest_answer, plus the per-connection limit on NEW answers (changing your own answer is never limited).
create or replace function public.ask_guest_answer(p_token text, p_name text, p_email text, p_phone text, p_slots jsonb,
  p_cant boolean default false, p_where jsonb default null, p_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.plans; g public.callout_guests; v_p uuid; v_key text; v_name text; v_email text; v_phone text; v_quick boolean; n int;
        v_mark text; v_n int;
begin
  select * into v from public.plans where ask_token = upper(btrim(coalesce(p_token, ''))) and callout for update;
  if v.id is null then raise exception 'That link isn’t working — ask whoever sent it for a new one'; end if;
  if v.status <> 'planning' then raise exception 'This one’s decided — ask % if there’s room', coalesce(private.callout_first(v.created_by), 'whoever put it out'); end if;
  if nullif(p_key, '') is not null then
    select * into g from public.callout_guests where plan_id = v.id and key_hash = private.ask_key_hash(p_key);
  end if;
  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  if v_email is not null and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'That email doesn’t look right'; end if;
  if v_phone is not null and v_phone !~ '^[0-9 +()-]{8,20}$' then raise exception 'That mobile doesn’t look right'; end if;
  if g.player_id is null then
    v_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g'));
    if length(v_name) not between 1 and 30 then raise exception 'Your name, please'; end if;
    if v_email is null and v_phone is null then raise exception 'Add an email or mobile so % can reach you', coalesce(private.callout_first(v.created_by), 'whoever’s organising'); end if;
    if (select count(*) from public.callout_guests where plan_id = v.id) >= 60 then raise exception 'This one has plenty of answers — ask whoever sent it'; end if;
    v_mark := private.ask_link_mark(v.id);
    if v_mark is not null then
      insert into private.ask_link_marks as m (plan_id, mark, day, n) values (v.id, v_mark, current_date, 1)
      on conflict (plan_id, mark, day) do update set n = m.n + 1 returning m.n into v_n;
      if v_n > 6 then raise exception 'That’s a lot of answers from one place today — ask % to add you', coalesce(private.callout_first(v.created_by), 'whoever sent it'); end if;
    end if;
    select quick into v_quick from public.groups where id = v.group_id;
    insert into public.players (group_id, name, approved) values (v.group_id, v_name, coalesce(v_quick, false)) returning id into v_p;
    v_key := private.random_code(24);
    insert into public.callout_guests (player_id, plan_id, group_id, email, phone, key_hash)
    values (v_p, v.id, v.group_id, v_email, v_phone, private.ask_key_hash(v_key));
    if not v.invite_all then
      insert into public.plan_invites (plan_id, player_id, group_id) values (v.id, v_p, v.group_id) on conflict do nothing;
    end if;
  else
    v_p := g.player_id; v_key := p_key;
    update public.callout_guests set email = coalesce(v_email, email), phone = coalesce(v_phone, phone) where player_id = v_p;
  end if;
  n := private.ask_store(v, v_p, p_slots, p_cant, p_where);
  return jsonb_build_object('key', v_key, 'player_id', v_p, 'slots', n);
end $$;
revoke all on function public.ask_guest_answer(text, text, text, text, jsonb, boolean, jsonb, text) from public;
grant execute on function public.ask_guest_answer(text, text, text, text, jsonb, boolean, jsonb, text) to anon, authenticated;

-- =================================================================================================== 3. who sees contacts
-- 111's ask_contacts without the booker: whoever put it out (or organises the plan) and the group's organisers only.
create or replace function public.ask_contacts(p_plan uuid)
returns table (player_id uuid, name text, email text, phone text, signed_in boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v public.plans;
begin
  select * into v from public.plans where id = p_plan;
  if v.id is null or auth.uid() is null or not private.is_group_member(v.group_id) then return; end if;
  if not private.callout_can_manage(v) then return; end if;
  return query select g.player_id, p.name, g.email, g.phone, g.user_id is not null
    from public.callout_guests g join public.players p on p.id = g.player_id where g.plan_id = p_plan order by g.created_at;
end $$;
revoke all on function public.ask_contacts(uuid) from public, anon;
grant execute on function public.ask_contacts(uuid) to authenticated;

-- =================================================================================================== 8. AI uses per month
create index if not exists ask_ai_uses_at_idx on public.ask_ai_uses (at);

-- =================================================================================================== 5. counting the door
-- How many times each step happened on a day, by where people came from ('web-home', 'reply', …). Counts only: no
-- person, no phone, no ask. Server only; the app adds one through door_count and Josh reads it through admin_door_funnel.
create table if not exists public.door_counts (
  day date not null default current_date,
  step text not null check (step in ('opened', 'built', 'signed_in', 'link_made', 'shared', 'own_started', 'calendar')),
  source text not null default 'direct' check (source ~ '^[a-z0-9_-]{1,24}$'),
  n int not null default 0,
  primary key (day, step, source)
);
alter table public.door_counts enable row level security;   -- no rules: only the functions below touch it
revoke all on public.door_counts from anon, authenticated;

-- So one connection can't pump the counts: at most 60 a day each. The same scrambled daily mark as above; server only.
create table if not exists private.door_marks (
  mark text not null,
  day date not null default current_date,
  n int not null default 0,
  primary key (mark, day)
);
revoke all on private.door_marks from public, anon, authenticated;

create or replace function public.door_count(p_step text, p_source text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_src text := lower(left(btrim(coalesce(p_source, '')), 24)); v_ip text := private.request_ip(); v_mark text; v_n int;
begin
  if p_step is null or p_step not in ('opened', 'built', 'signed_in', 'link_made', 'shared', 'own_started', 'calendar') then return; end if;
  if v_src !~ '^[a-z0-9_-]{1,24}$' then v_src := 'direct'; end if;
  if v_ip is not null then
    v_mark := md5(v_ip || current_date::text || 'door' || coalesce((select salt from private.scan_salt limit 1), ''));
    insert into private.door_marks as m (mark, day, n) values (v_mark, current_date, 1)
    on conflict (mark, day) do update set n = m.n + 1 returning m.n into v_n;
    if v_n > 60 then return; end if;
  end if;
  -- At most 40 different sources a day, so made-up tags can't fill the table.
  if not exists (select 1 from public.door_counts where day = current_date and source = v_src)
     and (select count(distinct source) from public.door_counts where day = current_date) >= 40 then v_src := 'direct'; end if;
  insert into public.door_counts as c (day, step, source, n) values (current_date, p_step, v_src, 1)
  on conflict (day, step, source) do update set n = c.n + 1;
end $$;
revoke all on function public.door_count(text, text) from public;
grant execute on function public.door_count(text, text) to anon, authenticated;

-- Josh's screen: the round door's funnel over the last N days. The first steps come from the counts above; the rest are
-- read straight from the no-group asks themselves (first reply from someone else, first 4-ball, locked in).
create or replace function public.admin_door_funnel(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_days int := least(greatest(coalesce(p_days, 30), 1), 365); v_since date := current_date - (least(greatest(coalesce(p_days, 30), 1), 365) - 1);
        v_counts jsonb; v_sources jsonb; v_asks jsonb;
begin
  if not private.is_platform_admin() then raise exception 'Not for you'; end if;
  select coalesce(jsonb_object_agg(step, n), '{}'::jsonb) into v_counts
    from (select step, sum(n)::int as n from public.door_counts where day >= v_since group by step) x;
  select coalesce(jsonb_object_agg(source, steps), '{}'::jsonb) into v_sources
    from (select source, jsonb_object_agg(step, n) as steps
          from (select source, step, sum(n)::int as n from public.door_counts where day >= v_since group by source, step) y group by source) z;
  select jsonb_build_object(
      'asks', count(*),
      'first_reply', count(*) filter (where exists (select 1 from public.callout_answers a where a.plan_id = p.id and a.player_id <> p.created_by)),
      'fourball', count(*) filter (where coalesce((select o_n from private.ask_best(p.id)), 0) >= 4),
      'locked', count(*) filter (where p.status in ('confirmed', 'done')))
    into v_asks
    from public.plans p join public.groups g on g.id = p.group_id
    where p.callout and p.ask is not null and g.quick and p.created_at >= v_since;
  return jsonb_build_object('days', v_days, 'counts', v_counts, 'sources', v_sources, 'asks', v_asks);
end $$;
revoke all on function public.admin_door_funnel(int) from public, anon;
grant execute on function public.admin_door_funnel(int) to authenticated;

-- =================================================================================================== 6. tidy-up
-- A hidden quick group made for a round ask that went nowhere: over 30 days since it was made and since its last ask
-- closed, the asker is the only member, nobody else answered (in the app or by link), and no round was ever made.
-- Deleted child tables first, the same way "delete my group" does it (041b). The asker's account is untouched.
create or replace function private.round_door_tidy(p_now timestamptz default now(), p_limit int default 200) returns int
language plpgsql security definer set search_path = '' as $$
declare g record; t record; v_left int; v_pass int; n int := 0;
begin
  for g in
    select gr.id from public.groups gr
    where gr.quick and not gr.legacy and gr.created_at < p_now - interval '30 days'
      and (select count(*) from public.group_members m where m.group_id = gr.id) <= 1
      and exists (select 1 from public.plans p where p.group_id = gr.id and p.callout and p.ask is not null)
      and not exists (select 1 from public.plans p where p.group_id = gr.id
                      and (not p.callout or p.ask is null or p.status not in ('planning', 'cancelled')
                           or coalesce(p.closes_at, p.created_at) > p_now - interval '30 days'))
      and not exists (select 1 from public.rounds r where r.group_id = gr.id)
      and not exists (select 1 from public.callout_guests cg where cg.group_id = gr.id)
      and not exists (select 1 from public.callout_answers a join public.plans p on p.id = a.plan_id
                      where a.group_id = gr.id and a.player_id <> p.created_by)
      and (select count(*) from public.players pl where pl.group_id = gr.id) <= 1
    order by gr.created_at
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  loop
    begin
      v_pass := 0;
      loop
        v_pass := v_pass + 1;
        v_left := 0;
        for t in
          select c.table_name from information_schema.columns c join information_schema.tables tb
            on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
          where c.table_schema = 'public' and c.column_name = 'group_id'
            and c.table_name not in ('client_errors', 'plan_group_members')
        loop
          begin
            execute format('delete from public.%I where group_id = $1', t.table_name) using g.id;
          exception when foreign_key_violation then
            v_left := v_left + 1;
          end;
        end loop;
        exit when v_left = 0 or v_pass >= 12;
      end loop;
      if v_left > 0 then raise exception 'left over'; end if;
      update public.course_library set source_group_id = null where source_group_id = g.id;
      update public.client_errors set group_id = null where group_id = g.id;
      delete from public.groups where id = g.id;
      n := n + 1;
    exception when others then
      null;   -- leave this one whole (the block rolls its deletes back) and carry on with the next
    end;
  end loop;
  -- Yesterday's scrambled connection marks aren't needed again.
  delete from private.ask_link_marks where day < current_date - 1;
  delete from private.door_marks where day < current_date - 1;
  return n;
end $$;
revoke all on function private.round_door_tidy(timestamptz, int) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'lgc-round-door-tidy') then perform cron.unschedule('lgc-round-door-tidy'); end if;
    perform cron.schedule('lgc-round-door-tidy', '40 15 * * *', 'select private.round_door_tidy()');   -- about 2:40 am Sydney
  end if;
end $$;
