-- 036 — Stage 7b: the quick round (club-partners addendum) and the Clubhouse TV switch (Stage 3 addition). Additive.
--
-- A public course page (no sign-in) has "Start a round with your mates". That makes a *quick group* ("Josh's round at
-- Bowral Golf Club") with its own copy of the course, a one-day trip and one live round, using a phone-only sign-in.
-- Mates join from a guest link with just a name: they're approved straight away and put in today's round.
-- Where it came from (a club's QR code and its placement, or another group's results card) is kept on the group so we
-- can count it later — never shown to clubs.

-- ------------------------------------------------------------------ Stage 3 addition: Clubhouse TV (off by default)
insert into public.feature_catalogue (key, default_on, parent, tier) values ('clubhouse_tv', false, null, 'free')
on conflict (key) do nothing;

-- ------------------------------------------------------------------ Quick groups
alter table public.groups add column if not exists quick boolean not null default false;
alter table public.groups add column if not exists source jsonb;   -- { ref, placement, from_group } — first scan or card
grant select (quick) on public.groups to authenticated;

-- The public course page: what anyone can see without signing in (no groups, no pins, no rounds).
create or replace function public.course_page(p_slug text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('id', l.id, 'slug', l.slug, 'name', l.name, 'area', l.area, 'lat', l.lat, 'lng', l.lng, 'osm', l.osm,
           'holes', (select json_agg(json_strip_nulls(json_build_object('n', h -> 'n', 'par', h -> 'par', 'si', h -> 'si', 'green', h -> 'green', 'tee', h -> 'tee', 'osm', h -> 'osm')) order by (h ->> 'n')::int)
                     from jsonb_array_elements(l.holes) h))
  from public.course_library l where l.slug = lower(btrim(p_slug)) and not l.hidden;
$$;
revoke all on function public.course_page(text) from public;
grant execute on function public.course_page(text) to anon, authenticated;

-- Where a new group came from, kept tidy: only these keys, short strings.
create or replace function private.clean_source(p jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
    'ref', left(nullif(regexp_replace(coalesce(p ->> 'ref', ''), '[^A-Za-z0-9_-]', '', 'g'), ''), 40),
    'placement', case when p ->> 'placement' in ('cart', 'par3', 'counter', 'tv', 'stay', 'card', 'invite') then p ->> 'placement' end,
    'from_group', left(nullif(regexp_replace(coalesce(p ->> 'from_group', ''), '[^a-z0-9-]', '', 'g'), ''), 60))), '{}'::jsonb);
$$;
revoke all on function private.clean_source(jsonb) from public, anon, authenticated;

-- Start a quick round. Returns { group_id, round_id, invite } (invite = the guest link code).
create or replace function public.start_quick_round(p_slug text, p_my_name text, p_handicap numeric, p_format text,
                                                    p_ctp int[], p_ld int[], p_source jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_me text := btrim(regexp_replace(coalesce(p_my_name, ''), '[[:cntrl:]]+', ' ', 'g'));
        l record; v_g uuid; v_p uuid; v_c uuid; v_t uuid; v_r uuid; v_name text; v_slug text; v_base text; v_n int := 1;
        v_code text; v_today date := (now() at time zone 'Australia/Sydney')::date; v_holes int; v_tok text;
        v_ctp int[]; v_ld int[]; v_anon boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if length(v_me) not between 1 and 30 then raise exception 'Your name needs 1–30 characters'; end if;
  if p_handicap is null or p_handicap < -10 or p_handicap > 54 then raise exception 'A handicap is from −10 to 54'; end if;
  if p_format not in ('stableford', 'ambrose') then raise exception 'Pick Stableford or Ambrose'; end if;
  select * into l from public.course_library where slug = lower(btrim(p_slug)) and not hidden;
  if l.id is null then raise exception 'That course isn''t in the library'; end if;
  perform pg_advisory_xact_lock(hashtext('create_group:' || v_uid::text));
  -- Limits: 5 quick rounds a day per person; phone-only starters share 60 an hour (a busy Saturday across clubs).
  if (select count(*) from public.groups where created_by = v_uid and quick and created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s 5 quick rounds today — try again tomorrow';
  end if;
  v_anon := coalesce((select is_anonymous from auth.users where id = v_uid), true);
  if v_anon and (select count(*) from public.groups g join auth.users u on u.id = g.created_by
                 where g.quick and g.created_at > now() - interval '1 hour' and u.is_anonymous) >= 60 then
    raise exception 'Lots of rounds are starting right now — try again in a few minutes';
  end if;
  v_holes := jsonb_array_length(l.holes);
  select coalesce(array_agg(distinct x order by x), '{}') into v_ctp from unnest(coalesce(p_ctp, '{}')) x where x between 1 and v_holes;
  select coalesce(array_agg(distinct x order by x), '{}') into v_ld from unnest(coalesce(p_ld, '{}')) x where x between 1 and v_holes;

  -- The group: "<name>'s round at <course>", its own address and join code.
  v_name := left(v_me || '''s round at ' || l.name, 40);
  v_base := btrim(left(btrim(regexp_replace(lower(v_me || '-at-' || l.slug), '[^a-z0-9]+', '-', 'g'), '-'), 30), '-');
  if length(v_base) < 2 or private.reserved_slug(v_base) then v_base := 'round'; end if;
  loop
    v_code := private.random_code(10);
    exit when not exists (select 1 from public.groups where group_pin = v_code);
  end loop;
  loop
    v_slug := case when v_n = 1 then v_base else v_base || '-' || v_n end;
    if not exists (select 1 from public.groups where slug = v_slug) then
      begin
        insert into public.groups (slug, name, group_pin, legacy, created_by, quick, source)
        values (v_slug, v_name, v_code, false, v_uid, true, private.clean_source(p_source)) returning id into v_g;
        exit;
      exception when unique_violation then null;
      end;
    end if;
    v_n := v_n + 1;
  end loop;
  insert into public.group_members (group_id, user_id, role) values (v_g, v_uid, 'organiser');
  -- Just what a quick round needs: scores, side comps, the winner, GPS, and planning next year's. (No feed: nothing
  -- to scroll, and no "approve them" posts — people are approved straight away.)
  insert into public.group_features (group_id, feature_key, enabled)
  select v_g, f.key, f.key in ('side_comps', 'trophies', 'gps', 'planner', 'planner_tasks', 'notifications')
  from public.feature_catalogue f;
  insert into public.players (group_id, name, handicap, approved) values (v_g, v_me, round(p_handicap, 1), true) returning id into v_p;
  insert into public.handicap_history (group_id, player_id, old_handicap, new_handicap, reason) values (v_g, v_p, null, round(p_handicap, 1), 'Starting handicap');
  update public.group_members set player_id = v_p where group_id = v_g and user_id = v_uid;
  -- Its own copy of the course, a one-day trip and the round, live straight away.
  insert into public.courses (group_id, name, holes, library_id) values (v_g, l.name, l.holes, l.id) returning id into v_c;
  update public.course_library set copies = copies + 1 where id = l.id;
  insert into public.trips (group_id, name, start_date, end_date) values (v_g, left(l.name || ' ' || to_char(v_today, 'FMDD Mon YYYY'), 80), v_today, v_today)
  returning id into v_t;
  insert into public.rounds (group_id, trip_id, course_id, name, play_date, format, status, ctp_holes, ld_holes)
  values (v_g, v_t, v_c, (case when p_format = 'ambrose' then 'Ambrose' else 'Stableford' end) || ' — ' || l.name, v_today, p_format, 'live', v_ctp, v_ld)
  returning id into v_r;
  insert into public.round_players (round_id, player_id, playing_handicap) values (v_r, v_p, round(p_handicap));
  -- The guest link mates join with.
  loop
    v_tok := private.random_code(12);
    exit when not exists (select 1 from public.group_invites where token = v_tok);
  end loop;
  insert into public.group_invites (token, group_id, role) values (v_tok, v_g, 'guest');
  return json_build_object('group_id', v_g, 'round_id', v_r, 'invite', v_tok);
end $$;
revoke all on function public.start_quick_round(text, text, numeric, text, int[], int[], jsonb) from public, anon;
grant execute on function public.start_quick_round(text, text, numeric, text, int[], int[], jsonb) to authenticated;

-- In a quick group, people who join are approved straight away and go into today's live round.
create or replace function private.quick_group_join() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and tg_when = 'BEFORE' then
    if exists (select 1 from public.groups where id = new.group_id and quick) then new.approved := true; end if;
    return new;
  end if;
  if exists (select 1 from public.groups where id = new.group_id and quick) then
    insert into public.round_players (round_id, player_id, playing_handicap)
    select r.id, new.id, round(new.handicap) from public.rounds r
    where r.group_id = new.group_id and r.status = 'live' and r.format = 'stableford'
    on conflict do nothing;
  end if;
  return new;
end $$;
create or replace trigger ac_players_quick_approve before insert on public.players for each row execute function private.quick_group_join();
create or replace trigger zz_players_quick_round after insert on public.players for each row execute function private.quick_group_join();

-- "Make it official": a quick group becomes an ordinary group (the wizard then names it and adds a crest).
create or replace function public.make_group_official()
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  update public.groups set quick = false where id = v_g;
end $$;
revoke all on function public.make_group_official() from public, anon;
grant execute on function public.make_group_official() to authenticated;

-- Where an ordinary group came from (the wizard, started from a results card or a club's code). Set once.
create or replace function public.set_group_source(p_source jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  update public.groups set source = private.clean_source(p_source) where id = v_g and source is null;
end $$;
revoke all on function public.set_group_source(jsonb) from public, anon;
grant execute on function public.set_group_source(jsonb) to authenticated;

-- my_status also says whether this is a quick group (the 031 version plus "quick").
create or replace function public.my_status()
returns json language sql stable security definer set search_path = 'public' as $$
  with g as (select private.current_group() as id)
  select json_build_object(
    'is_member', (select id from g) is not null,
    'is_admin', coalesce(private.is_group_organiser((select id from g)), false),
    'player_id', private.my_player_id((select id from g)),
    'group_name', (select name from public.groups where id = (select id from g)),
    'group_id', (select id from g),
    'legacy', (select legacy from public.groups where id = (select id from g)),
    'quick', (select quick from public.groups where id = (select id from g)),
    'role', (select role from public.group_members where group_id = (select id from g) and user_id = auth.uid()),
    'signed_in', not coalesce((select is_anonymous from auth.users where id = auth.uid()), true),
    'look', (select json_build_object('short_name', short_name, 'crest_url', crest_url, 'primary', colour_primary,
                                      'accent', colour_accent, 'font', font)
             from public.groups where id = (select id from g)),
    'groups', coalesce((select json_agg(json_build_object('id', gr.id, 'name', gr.name, 'slug', gr.slug, 'role', gm.role) order by gm.created_at)
                        from public.group_members gm join public.groups gr on gr.id = gm.group_id
                        where gm.user_id = auth.uid()), '[]'::json)
  );
$$;
