-- 050c — No "wants to join — approve them" post for someone already approved (21 Oct 2026). From the 050 review:
-- a team-link joiner is approved straight away (050 cup_side_from_link), so create_my_player's approval nag in the
-- Feed was noise (28 posts for a Ryder Cup). Same function as before; the post now only goes up when the new player
-- is actually waiting for approval.
create or replace function public.create_my_player(p_name text, p_nickname text, p_handicap numeric, p_avatar_url text)
returns uuid language plpgsql security definer set search_path = 'public' as $function$
declare v_id uuid; v_g uuid := private.current_group(); v_admin boolean; v_approved boolean;
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  v_admin := private.is_group_organiser(v_g);
  insert into public.players (group_id, name, nickname, handicap, avatar_url, approved)
  values (v_g, trim(p_name), nullif(trim(coalesce(p_nickname,'')), ''), coalesce(p_handicap, 18), p_avatar_url, v_admin)
  returning id, approved into v_id, v_approved;
  insert into public.handicap_history (group_id, player_id, old_handicap, new_handicap, reason)
  values (v_g, v_id, null, coalesce(p_handicap, 18), 'Starting handicap');
  update public.group_members set player_id = v_id where group_id = v_g and user_id = auth.uid();
  if not v_approved and public.feature_on(v_g, 'feed') then
    insert into public.posts (group_id, kind, body, link)
    values (v_g, 'auto', trim(p_name) || ' wants to join — admin, approve them in More → Admin.', '/admin');
  end if;
  return v_id;
end $function$;
