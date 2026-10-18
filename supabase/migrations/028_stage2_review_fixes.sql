-- 028 — fixes from the independent Stage 2 review. Additive: functions replaced, two new functions.

-- The test helper used to check which address header can be trusted: emptied and locked (drop it by hand later:
-- drop function public.tmp_echo_headers();). Staging only — it was never in a migration file before this.
create or replace function public.tmp_echo_headers() returns json language sql stable as $$ select '{}'::json $$;
revoke all on function public.tmp_echo_headers() from public, anon, authenticated;

-- ------------------------------------------------------------------ The caller's real address
-- Checked on staging: the first x-forwarded-for entry is whatever the caller sends (spoofable). Cloudflare's
-- cf-connecting-ip / Supabase's sb-forwarded-for are set by the platform.
create or replace function private.request_ip()
returns text language plpgsql stable security definer set search_path = '' as $$
declare h json; v text;
begin
  begin
    h := current_setting('request.headers', true)::json;
  exception when others then return null;
  end;
  v := coalesce(h ->> 'sb-forwarded-for', h ->> 'cf-connecting-ip');
  if v is null and h ->> 'x-forwarded-for' is not null then
    -- The last entry is the one our own platform added.
    v := btrim(regexp_replace(h ->> 'x-forwarded-for', '^.*,', ''));
  end if;
  return nullif(btrim(split_part(coalesce(v, ''), ',', 1)), '');
end $$;

-- Also a cap across everyone on wrong group/admin PINs (fresh anonymous users dodge the per-person limit).
-- Invite links aren't in this cap — their codes can't be guessed and new groups use nothing else.
create or replace function private.pin_check()
returns void language plpgsql security definer set search_path = '' as $$
declare v_ip text := private.request_ip();
begin
  if (select count(*) from private.pin_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10
     or (v_ip is not null and (select count(*) from private.pin_attempts where ip = v_ip and at > now() - interval '1 hour') >= 30)
     or (select count(*) from private.pin_attempts where kind in ('join', 'admin') and at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many wrong PINs — wait an hour and try again';
  end if;
end $$;

-- ------------------------------------------------------------------ Admin PIN: an organiser switches it off
create or replace function public.turn_off_admin_pin()
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  update public.groups set admin_pin = null where id = v_g;
  -- The old settings row can't be empty: give it an unguessable value nobody knows (nothing reads it for the PIN now).
  if (select legacy from public.groups where id = v_g) then update public.settings set admin_pin = private.random_code(24) where id = 1; end if;
end $$;
revoke all on function public.turn_off_admin_pin() from public, anon;
grant execute on function public.turn_off_admin_pin() to authenticated;

-- Off (no admin PIN) → simply "not the PIN", like any wrong PIN, so old phones show their normal message.
create or replace function public.claim_admin(p_pin text)
returns boolean language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid := private.current_group(); v_pin text;
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  if not (select legacy from public.groups where id = v_g) then
    raise exception 'This group doesn''t use an admin PIN — ask an organiser to make you one';
  end if;
  perform private.pin_check();
  select admin_pin into v_pin from public.groups where id = v_g;
  if v_pin is null or v_pin <> trim(p_pin) then
    perform private.pin_fail('admin');
    return false;
  end if;
  update public.group_members set role = 'organiser' where group_id = v_g and user_id = auth.uid();
  insert into public.posts (group_id, kind, body)
  values (v_g, 'auto', '🔑 Someone used the admin PIN and is now an organiser.');
  return true;
end $$;

-- ------------------------------------------------------------------ Names: guests make their own; organisers hand out
create or replace function public.claim_player(p_player_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid := private.current_group();
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  if private.is_group_guest(v_g) then raise exception 'Guests add themselves as a new player — an organiser can link you to a name'; end if;
  if not exists (select 1 from public.players where id = p_player_id and group_id = v_g) then raise exception 'No such player'; end if;
  -- One at a time per group, so two people can't take the same free name at once.
  perform 1 from public.groups where id = v_g for update;
  if exists (select 1 from public.group_members where group_id = v_g and player_id = p_player_id and user_id <> auth.uid()) then
    raise exception 'Someone has already picked that name — ask an organiser to give it to you';
  end if;
  update public.group_members set player_id = p_player_id where group_id = v_g and user_id = auth.uid();
end $$;

-- An organiser gives a name to the right person (moving it off anyone else who had it).
create or replace function public.assign_player(p_user uuid, p_player uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  if not exists (select 1 from public.group_members where group_id = v_g and user_id = p_user) then raise exception 'Not in this group'; end if;
  if p_player is not null and not exists (select 1 from public.players where id = p_player and group_id = v_g) then raise exception 'No such player'; end if;
  perform 1 from public.groups where id = v_g for update;
  update public.group_members set player_id = null where group_id = v_g and player_id = p_player and user_id <> p_user;
  update public.group_members set player_id = p_player where group_id = v_g and user_id = p_user;
end $$;
revoke all on function public.assign_player(uuid, uuid) from public, anon;
grant execute on function public.assign_player(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------ Roles: never zero organisers; changes go on the feed
create or replace function public.set_member_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_old text; v_name text;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can change roles'; end if;
  if p_role not in ('organiser', 'player', 'guest') then raise exception 'Unknown role'; end if;
  perform 1 from public.groups where id = v_g for update;  -- two organisers at once can't leave none
  select role into v_old from public.group_members where group_id = v_g and user_id = p_user;
  if v_old is null then raise exception 'Not in this group'; end if;
  if v_old = p_role then return; end if;
  if v_old = 'organiser' and (select count(*) from public.group_members where group_id = v_g and role = 'organiser') <= 1 then
    raise exception 'The group needs at least one organiser — make someone else one first';
  end if;
  update public.group_members set role = p_role where group_id = v_g and user_id = p_user;
  select coalesce(p.nickname, p.name) into v_name from public.group_members m join public.players p on p.id = m.player_id
    where m.group_id = v_g and m.user_id = p_user;
  insert into public.posts (group_id, kind, body)
  values (v_g, 'auto', '👥 ' || coalesce(v_name, 'Someone without a name yet') || ' is now ' ||
    case p_role when 'organiser' then 'an organiser' when 'guest' then 'a guest' else 'a player' end || '.');
end $$;
