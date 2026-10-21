-- 034 — Stage 7: anyone can start a new group. Additive: one column on groups, one function.
-- The new group starts empty — nothing from L.G.C: no players, trips, courses, rules, trophies or history. Its look is
-- the plain The Golf Trip look, its features are the preset the wizard picked, and the person who made it is its
-- organiser. The rest of the wizard uses the functions organisers already have (set_group_look, use_starter_rulebook,
-- create_my_player, admin_create_player, group_invite).

alter table public.groups add column if not exists created_by uuid default auth.uid();

-- Web addresses a group can't take (for <slug>.thegolftrip.club later).
create or replace function private.reserved_slug(p text) returns boolean language sql immutable as $$
  select p = any (array['lgc', 'www', 'app', 'api', 'admin', 'start', 'join', 'help', 'support', 'mail', 'static',
                        'assets', 'staging', 'dev', 'test', 'demo', 'thegolftrip', 'golftrip', 'about', 'privacy', 'terms']);
$$;

create or replace function public.create_group(p_name text, p_features jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_name text := btrim(coalesce(p_name, '')); v_base text; v_slug text; v_n int := 1;
        v_code text; v_g uuid; k text; v jsonb;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if length(v_name) not between 2 and 40 then raise exception 'The group name needs 2–40 characters'; end if;
  if jsonb_typeof(p_features) <> 'object' then raise exception 'Features must be a list of switches'; end if;
  -- Limits: 3 new groups a day per person, 30 an hour across everyone (stops a runaway script).
  if (select count(*) from public.groups where created_by = v_uid and created_at > now() - interval '1 day') >= 3 then
    raise exception 'That''s 3 new groups today — try again tomorrow';
  end if;
  if (select count(*) from public.groups where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Lots of groups are being started right now — try again in a few minutes';
  end if;
  -- Its web address: from the name, made unique.
  v_base := left(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), 30);
  if length(v_base) < 2 then v_base := 'group'; end if;
  if private.reserved_slug(v_base) then v_base := v_base || '-golf'; end if;
  v_slug := v_base;
  while exists (select 1 from public.groups where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  loop
    v_code := private.random_code(10);
    exit when not exists (select 1 from public.groups where group_pin = v_code);
  end loop;
  insert into public.groups (slug, name, group_pin, legacy, created_by) values (v_slug, v_name, v_code, false, v_uid)
  returning id into v_g;
  insert into public.group_members (group_id, user_id, role) values (v_g, v_uid, 'organiser');
  -- The feature preset (only switches the app knows about).
  for k, v in select key, value from jsonb_each(p_features) loop
    if not exists (select 1 from public.feature_catalogue where key = k) then raise exception 'Unknown feature %', k; end if;
    if jsonb_typeof(v) <> 'boolean' then raise exception 'Feature % must be on or off', k; end if;
    insert into public.group_features (group_id, feature_key, enabled) values (v_g, k, v::text::boolean);
  end loop;
  return v_g;
end $$;
revoke all on function public.create_group(text, jsonb) from public, anon;
grant execute on function public.create_group(text, jsonb) to authenticated;

-- All the switches at once (the wizard's preset, or custom). Same rules as set_feature.
create or replace function public.set_features(p_switches jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); k text; v jsonb;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can change features'; end if;
  if jsonb_typeof(p_switches) <> 'object' then raise exception 'Features must be a list of switches'; end if;
  for k, v in select key, value from jsonb_each(p_switches) loop
    if not exists (select 1 from public.feature_catalogue where key = k) then raise exception 'Unknown feature %', k; end if;
    if jsonb_typeof(v) <> 'boolean' then raise exception 'Feature % must be on or off', k; end if;
    insert into public.group_features (group_id, feature_key, enabled) values (v_g, k, v::text::boolean)
    on conflict (group_id, feature_key) do update set enabled = excluded.enabled, updated_by = auth.uid(), updated_at = now();
  end loop;
end $$;
revoke all on function public.set_features(jsonb) from public, anon;
grant execute on function public.set_features(jsonb) to authenticated;
