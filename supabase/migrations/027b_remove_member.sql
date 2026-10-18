-- 027b — take someone out of a group (split from 027 because it contains a delete, which needs Josh's approval to apply).

-- Organisers take someone out of the group (their scores and posts stay; their player is freed for someone else).
create or replace function public.remove_member(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  if (select role from public.group_members where group_id = v_g and user_id = p_user) = 'organiser'
     and (select count(*) from public.group_members where group_id = v_g and role = 'organiser') <= 1 then
    raise exception 'The group needs at least one organiser';
  end if;
  delete from public.group_members where group_id = v_g and user_id = p_user;
end $$;

revoke all on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;
