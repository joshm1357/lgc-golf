-- 005: create_my_player marks non-admin self-adds as unapproved and posts a join request to the feed.
create or replace function public.create_my_player(p_name text, p_nickname text, p_handicap numeric, p_avatar_url text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_admin boolean := public.is_admin();
begin
  if not public.is_member() then raise exception 'Join the group first'; end if;
  insert into public.players (name, nickname, handicap, avatar_url, approved)
  values (trim(p_name), nullif(trim(coalesce(p_nickname,'')), ''), coalesce(p_handicap, 18), p_avatar_url, v_admin)
  returning id into v_id;
  insert into public.handicap_history (player_id, old_handicap, new_handicap, reason)
  values (v_id, null, coalesce(p_handicap, 18), 'Starting handicap');
  update public.members set player_id = v_id where user_id = auth.uid();
  if not v_admin then
    insert into public.posts (kind, body, link)
    values ('auto', trim(p_name) || ' wants to join — admin, approve them in More → Admin.', '/admin');
  end if;
  return v_id;
end $$;
revoke execute on function public.create_my_player(text, text, numeric, text) from public, anon;
grant execute on function public.create_my_player(text, text, numeric, text) to authenticated;
