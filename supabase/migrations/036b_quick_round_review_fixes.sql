-- 036b — Stage 7b review fixes. Additive: replaced functions.
--  1. No fake players: in a quick group each person adds themselves once, and a group tops out at 40 players.
--  2. A quick round doesn't count as "using" a library course (so phone-only rounds can't push a course up the
--     search or lock its details); making the group official does.
--  3. The phone-only limit is per course (20 an hour), so one script can't stop quick rounds everywhere.
--  4. Making it official turns the mates (guests) into players.

create or replace function private.quick_group_join() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and tg_when = 'BEFORE' then
    if exists (select 1 from public.groups where id = new.group_id and quick) then
      if exists (select 1 from public.group_members m where m.group_id = new.group_id and m.user_id = auth.uid()
                 and m.player_id is not null and m.role <> 'organiser') then
        raise exception 'You''re already in this round';
      end if;
      if (select count(*) from public.players where group_id = new.group_id) >= 40 then
        raise exception 'This round is full (40 players)';
      end if;
      new.approved := true;
    end if;
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

create or replace function public.make_group_official()
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  if not (select quick from public.groups where id = v_g) then return; end if;
  update public.groups set quick = false where id = v_g;
  update public.group_members set role = 'player' where group_id = v_g and role = 'guest';
  -- Now it's a real group using the course: count it in the library.
  update public.course_library l set copies = copies + 1
  where l.id in (select library_id from public.courses where group_id = v_g and library_id is not null);
end $$;

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
  if (select count(*) from public.groups where created_by = v_uid and quick and created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s 5 quick rounds today — try again tomorrow';
  end if;
  v_anon := coalesce((select is_anonymous from auth.users where id = v_uid), true);
  if v_anon and (select count(*) from public.groups g join auth.users u on u.id = g.created_by
                 join public.courses c on c.group_id = g.id and c.library_id = l.id
                 where g.quick and g.created_at > now() - interval '1 hour' and u.is_anonymous) >= 20 then
    raise exception 'Lots of rounds are starting here right now — try again in a few minutes';
  end if;
  v_holes := jsonb_array_length(l.holes);
  select coalesce(array_agg(distinct x order by x), '{}') into v_ctp from unnest(coalesce(p_ctp, '{}')) x where x between 1 and v_holes;
  select coalesce(array_agg(distinct x order by x), '{}') into v_ld from unnest(coalesce(p_ld, '{}')) x where x between 1 and v_holes;
  v_name := v_me || '’s round at ' || l.name;
  if length(v_name) > 40 then v_name := left(v_me, 30) || '’s round'; end if;  -- never cut a name mid-word
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
  insert into public.group_features (group_id, feature_key, enabled)
  select v_g, f.key, f.key in ('side_comps', 'trophies', 'gps', 'planner', 'planner_tasks', 'notifications')
  from public.feature_catalogue f;
  insert into public.players (group_id, name, handicap, approved) values (v_g, v_me, round(p_handicap, 1), true) returning id into v_p;
  insert into public.handicap_history (group_id, player_id, old_handicap, new_handicap, reason) values (v_g, v_p, null, round(p_handicap, 1), 'Starting handicap');
  update public.group_members set player_id = v_p where group_id = v_g and user_id = v_uid;
  insert into public.courses (group_id, name, holes, library_id) values (v_g, l.name, l.holes, l.id) returning id into v_c;
  insert into public.trips (group_id, name, start_date, end_date) values (v_g, left(l.name || ' ' || to_char(v_today, 'FMDD Mon YYYY'), 80), v_today, v_today)
  returning id into v_t;
  insert into public.rounds (group_id, trip_id, course_id, name, play_date, format, status, ctp_holes, ld_holes)
  values (v_g, v_t, v_c, (case when p_format = 'ambrose' then 'Ambrose' else 'Stableford' end) || ' — ' || l.name, v_today, p_format, 'live', v_ctp, v_ld)
  returning id into v_r;
  insert into public.round_players (round_id, player_id, playing_handicap) values (v_r, v_p, round(p_handicap));
  loop
    v_tok := private.random_code(12);
    exit when not exists (select 1 from public.group_invites where token = v_tok);
  end loop;
  insert into public.group_invites (token, group_id, role) values (v_tok, v_g, 'guest');
  return json_build_object('group_id', v_g, 'round_id', v_r, 'invite', v_tok);
end $$;
