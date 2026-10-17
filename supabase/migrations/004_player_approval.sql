-- 004: People not on the list add themselves; they need the admin's OK (players.approved).
alter table public.players add column approved boolean not null default true;
create or replace function public.players_approval_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approved is distinct from old.approved and not public.is_admin() then
    raise exception 'Only the admin can approve players';
  end if;
  return new;
end $$;
create trigger players_approval_guard before update on public.players
for each row execute function public.players_approval_guard();
revoke execute on function public.players_approval_guard() from public, anon, authenticated;
