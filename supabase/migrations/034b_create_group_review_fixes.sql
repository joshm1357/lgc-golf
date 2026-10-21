-- 034b — Stage 7 review fixes. Additive: two new versions of functions (the old ones stay for any phone mid-wizard).
--  1. create_group also adds the organiser as a player, in the same step — so a dropped signal can't leave a group
--     without its maker on it, and the wizard never needs to make the group twice.
--  2. Limits: 3 new groups a day per person; phone-only (not signed-in) makers share a cap of 10 an hour, so a script
--     can't block signed-in organisers.
--  3. Web addresses: nothing that looks like L.G.C's ("lgc", "l-g-c", "lgc-golf", "lgc-2"…); never ends in a dash;
--     two groups with the same name at the same moment both get one. Group names lose control characters.
--  4. set_features can be told which group it's for, and refuses if the phone has drifted to another group.

create or replace function private.reserved_slug(p text) returns boolean language sql immutable set search_path = '' as $$
  select p = any (array['www', 'app', 'api', 'admin', 'start', 'join', 'help', 'support', 'mail', 'static',
                        'assets', 'staging', 'dev', 'test', 'demo', 'thegolftrip', 'golftrip', 'about', 'privacy', 'terms', 'c', 'club'])
      or p ~ '^l-?g-?c(-|$)';
$$;
revoke all on function private.reserved_slug(text) from public, anon, authenticated;

create or replace function public.create_group(p_name text, p_features jsonb, p_my_name text, p_handicap numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_name text; v_me text := btrim(coalesce(p_my_name, '')); v_base text; v_slug text; v_n int := 1;
        v_code text; v_g uuid; v_p uuid; k text; v jsonb; v_anon boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  v_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g'));
  if length(v_name) not between 2 and 40 then raise exception 'The group name needs 2–40 characters'; end if;
  if length(v_me) not between 1 and 30 then raise exception 'Your name needs 1–30 characters'; end if;
  if p_handicap is null or p_handicap < -10 or p_handicap > 54 then raise exception 'A handicap is from −10 to 54'; end if;
  if jsonb_typeof(p_features) <> 'object' then raise exception 'Features must be a list of switches'; end if;
  perform pg_advisory_xact_lock(hashtext('create_group:' || v_uid::text));
  if (select count(*) from public.groups where created_by = v_uid and created_at > now() - interval '1 day') >= 3 then
    raise exception 'That''s 3 new groups today — try again tomorrow';
  end if;
  v_anon := coalesce((select is_anonymous from auth.users where id = v_uid), true);
  if v_anon and (select count(*) from public.groups g join auth.users u on u.id = g.created_by
                 where g.created_at > now() - interval '1 hour' and u.is_anonymous) >= 10 then
    raise exception 'Lots of groups are being started right now — sign in, or try again in a few minutes';
  end if;
  v_base := btrim(left(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), 30), '-');
  if length(v_base) < 2 or private.reserved_slug(v_base) then v_base := 'group'; end if;
  loop
    v_code := private.random_code(10);
    exit when not exists (select 1 from public.groups where group_pin = v_code);
  end loop;
  loop
    v_slug := case when v_n = 1 then v_base else v_base || '-' || v_n end;
    if not exists (select 1 from public.groups where slug = v_slug) then
      begin
        insert into public.groups (slug, name, group_pin, legacy, created_by) values (v_slug, v_name, v_code, false, v_uid)
        returning id into v_g;
        exit;
      exception when unique_violation then null;  -- someone took it this instant: try the next one
      end;
    end if;
    v_n := v_n + 1;
  end loop;
  insert into public.group_members (group_id, user_id, role) values (v_g, v_uid, 'organiser');
  for k, v in select key, value from jsonb_each(p_features) loop
    if not exists (select 1 from public.feature_catalogue where key = k) then raise exception 'Unknown feature %', k; end if;
    if jsonb_typeof(v) <> 'boolean' then raise exception 'Feature % must be on or off', k; end if;
    insert into public.group_features (group_id, feature_key, enabled) values (v_g, k, v::text::boolean);
  end loop;
  -- The organiser on the player list, like create_my_player.
  insert into public.players (group_id, name, handicap, approved) values (v_g, v_me, round(p_handicap, 1), true) returning id into v_p;
  insert into public.handicap_history (group_id, player_id, old_handicap, new_handicap, reason) values (v_g, v_p, null, round(p_handicap, 1), 'Starting handicap');
  update public.group_members set player_id = v_p where group_id = v_g and user_id = v_uid;
  return v_g;
end $$;
revoke all on function public.create_group(text, jsonb, text, numeric) from public, anon;
grant execute on function public.create_group(text, jsonb, text, numeric) to authenticated;

create or replace function public.set_features(p_switches jsonb, p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_group is distinct from private.current_group() then raise exception 'This phone switched groups — reload and try again'; end if;
  perform public.set_features(p_switches);
end $$;
revoke all on function public.set_features(jsonb, uuid) from public, anon;
grant execute on function public.set_features(jsonb, uuid) to authenticated;

-- The first version (name and switches only) is retired: it was only ever on staging. It stays, so nothing is dropped.
create or replace function public.create_group(p_name text, p_features jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Update the app to start a group (pull down to refresh)';
end $$;
