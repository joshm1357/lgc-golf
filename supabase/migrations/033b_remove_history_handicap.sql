-- 033b — run after 033. Pasted by hand into the SQL editor (it contains a delete, which the automatic tool won't run).
-- Take back a handicap that was added as history (a typo). Only history entries — the app offers no way to remove a
-- real change (admin, Tribunal) here.
create or replace function public.remove_history_handicap(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  delete from public.handicap_history where id = p_id and group_id = v_g and imported;
  if not found then raise exception 'Only handicaps added as history can be removed'; end if;
end $$;
revoke all on function public.remove_history_handicap(uuid) from public, anon;
grant execute on function public.remove_history_handicap(uuid) to authenticated;
