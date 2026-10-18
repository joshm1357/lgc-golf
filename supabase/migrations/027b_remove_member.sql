-- 027b — take someone out of a group (split from 027 because it contains a delete, which needs Josh's approval to
-- apply). Run after 028. The group row is locked first so two organisers can't remove each other at once.

create or replace function public.remove_member(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_name text;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  perform 1 from public.groups where id = v_g for update;
  if (select role from public.group_members where group_id = v_g and user_id = p_user) = 'organiser'
     and (select count(*) from public.group_members where group_id = v_g and role = 'organiser') <= 1 then
    raise exception 'The group needs at least one organiser';
  end if;
  select coalesce(p.nickname, p.name) into v_name from public.group_members m join public.players p on p.id = m.player_id
    where m.group_id = v_g and m.user_id = p_user;
  delete from public.group_members where group_id = v_g and user_id = p_user;
  insert into public.posts (group_id, kind, body)
  values (v_g, 'auto', '👋 ' || coalesce(v_name, 'Someone without a name yet') || ' was taken out of the group.');
end $$;
revoke all on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;
