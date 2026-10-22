-- 083 — Links, not PINs (22 Oct 2026, Josh: "I don't want PINs any more. It should all be links").
-- Additive only: three new functions. Nothing is dropped or renamed — the PIN columns and functions (join_group,
-- join_group_id, claim_admin, set_pins, turn_off_admin_pin) stay for old app versions still on people's phones.
--
--  1. share_join_code(): the join code that goes inside every link the app shares (a recap, a vote, a trip), so
--     someone with no session can open it, join and land on that page. Any member gets it, not only organisers:
--     a player gets the group's player invite code, a guest gets the guest code. It's the same standing invite
--     link the organiser already shares (027), so nothing new is opened up; new players still need approving
--     wherever the group approves them today.
--  2. use_player_link(token): a personal link (046) used on a phone WITHOUT a proper sign-in — the live app has
--     sign-in switched off. The phone becomes that player straight away (no name pick). Works once, like 046.
--     A proper sign-in goes through 046's claim_player_link, unchanged.
--  3. create_my_player_link(): "Copy my link" — a player makes their own personal link, to open the app as
--     themselves on another phone. Same rules as an organiser's (046): one live link per player, works once,
--     14 days; a new one replaces the old.
-- Words: a "group" is a golf group; a "player" is a row in players; a "member" is a sign-in in group_members.

-- ------------------------------------------------------------------ 1. The join code for shared links
create or replace function public.share_join_code()
returns text language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_mine text; v_role text; v_token text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select m.role into v_mine from public.group_members m where m.group_id = v_g and m.user_id = auth.uid();
  if v_mine is null then raise exception 'Join the group first'; end if;
  -- A guest's links bring people in as guests; everyone else's as players (organiser links are never shared this way).
  v_role := case when v_mine = 'guest' then 'guest' else 'player' end;
  perform 1 from public.groups where id = v_g for update;   -- two people at once can't make two live codes
  select token into v_token from public.group_invites where group_id = v_g and role = v_role and revoked_at is null;
  if v_token is null then
    loop
      v_token := private.random_code(12);
      exit when not exists (select 1 from public.group_invites where token = v_token)
            and not exists (select 1 from public.player_links where token = v_token)
            and not exists (select 1 from public.organiser_invites where token = v_token);
    end loop;
    insert into public.group_invites (token, group_id, role, created_by) values (v_token, v_g, v_role, auth.uid());
  end if;
  return v_token;
end $$;

-- ------------------------------------------------------------------ 2. A personal link on a phone-only sign-in
create or replace function public.use_player_link(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.player_links%rowtype;
  v_me uuid := auth.uid();
  v_mine public.group_members%rowtype;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  -- A proper sign-in: 046 exactly as before (that's what keeps history on any phone).
  if not coalesce((select is_anonymous from auth.users where id = v_me), true) then
    return public.claim_player_link(p_token);
  end if;
  perform private.pin_check();
  select * into l from public.player_links where token = upper(trim(p_token)) for update;
  if l.token is null then perform private.pin_fail('invite'); return null; end if;
  if l.used_by = v_me then return l.group_id; end if;   -- tapped twice
  if l.used_at is not null then raise exception 'That link has already been used — ask your organiser for a new one'; end if;
  if l.revoked_at is not null then raise exception 'There''s a newer link for you — use the latest one'; end if;
  if l.expires_at <= now() then raise exception 'That link has run out (they last 14 days) — ask your organiser for a new one'; end if;
  if exists (select 1 from public.players where id = l.player_id and approved is false) then
    raise exception 'You''re not approved yet — ask your organiser';
  end if;
  select * into v_mine from public.group_members where group_id = l.group_id and user_id = v_me;
  if v_mine.user_id is not null and v_mine.player_id is not null and v_mine.player_id <> l.player_id then
    raise exception 'This phone is already someone else in this group — ask your organiser to sort it out';
  end if;
  if v_mine.user_id is null then
    insert into public.group_members (group_id, user_id, player_id, role) values (l.group_id, v_me, l.player_id, l.role);
  else
    update public.group_members
       set player_id = l.player_id,
           role = case when v_mine.role = 'organiser' or l.role = 'organiser' then 'organiser'
                       when v_mine.role = 'player' or l.role = 'player' then 'player' else 'guest' end
     where group_id = l.group_id and user_id = v_me;
  end if;
  update public.player_links set used_at = now(), used_by = v_me where token = l.token;
  return l.group_id;
end $$;

-- ------------------------------------------------------------------ 3. "Copy my link"
create or replace function public.create_my_player_link()
returns text language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); m public.group_members%rowtype; v_role text; v_token text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into m from public.group_members where group_id = v_g and user_id = auth.uid();
  if m.user_id is null then raise exception 'Join the group first'; end if;
  if m.player_id is null then raise exception 'Pick your name first'; end if;
  if exists (select 1 from public.players where id = m.player_id and approved is false) then
    raise exception 'You''re not approved yet — ask your organiser';
  end if;
  -- The player's best role (as 046 does): an organiser's own link keeps them an organiser on the new phone.
  select x.role into v_role from public.group_members x where x.group_id = v_g and x.player_id = m.player_id
   order by case x.role when 'organiser' then 1 when 'player' then 2 else 3 end limit 1;
  update public.player_links set revoked_at = now() where player_id = m.player_id and used_at is null and revoked_at is null;
  loop
    v_token := private.random_code(12);
    exit when not exists (select 1 from public.player_links where token = v_token)
          and not exists (select 1 from public.group_invites where token = v_token)
          and not exists (select 1 from public.organiser_invites where token = v_token);
  end loop;
  insert into public.player_links (token, group_id, player_id, role) values (v_token, v_g, m.player_id, coalesce(v_role, m.role, 'player'));
  return v_token;
end $$;

revoke all on function public.share_join_code(), public.use_player_link(text), public.create_my_player_link() from public, anon;
grant execute on function public.share_join_code(), public.use_player_link(text), public.create_my_player_link() to authenticated;
