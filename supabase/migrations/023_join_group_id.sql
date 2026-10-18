-- 023: Joining a group by PIN also says WHICH group was joined, so the app can open it straight away
-- (someone already in one group who joins a second). join_group (true/false) stays for older phones.
create or replace function public.join_group_id(p_pin text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_g uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into v_g from public.groups where group_pin = trim(p_pin);
  if v_g is null then return null; end if;
  insert into public.group_members (group_id, user_id) values (v_g, auth.uid()) on conflict do nothing;
  return v_g;
end $$;
revoke execute on function public.join_group_id(text) from public, anon;
grant execute on function public.join_group_id(text) to authenticated;
