-- 091 — "Call it off" instead of delete (ov21, 23 Oct 2026). ADDITIVE ONLY: three new columns, four new functions and
-- one new trigger. Nothing is dropped or renamed; old app versions keep working.
--
-- Why: a live trip ("March") was hard-deleted with one tap on a plain browser "OK" box, taking its votes, replies,
-- jobs and kitty with it. Now:
--  * CALL IT OFF (call_off_plan): sets the plan's status to 'cancelled' and keeps everything. It records who called
--    it off and when, so the trip says "Called off by Josh". Calling it back on ("Bring it back") puts it back to
--    'planning' (or 'confirmed' if it was locked in). Who can: the group's organisers, the trip's own organiser, or
--    the person who suggested an idea that hasn't been approved yet.
--  * DELETE only an EMPTY plan (delete_empty_plan): nobody but its creator has replied, and it has no votes, jobs,
--    costs, payments, chat or rounds. The app also makes the organiser type the trip's name first.
--  * A SAFETY NET (plans_delete_guard): a delete straight from the app (signed-in users) of a plan that ISN'T empty is
--    refused by the database, whatever the app version. Deletes run inside database functions or by the service key
--    (deleting a whole group, the access tests' tidy-up) are not affected.

-- =================================================================================================== columns
alter table public.plans add column if not exists cancelled_by uuid references public.players(id) on delete set null;
alter table public.plans add column if not exists cancelled_at timestamptz;
alter table public.plans add column if not exists cancelled_from text; -- the status it had before ('planning' / 'confirmed' / 'done')

-- =================================================================================================== is it empty?
-- Empty = nothing anyone else has put into it. The creator's own automatic "I'm in" doesn't count, nor do vote
-- options with no votes on them yet.
create or replace function private.plan_is_empty(p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not (
       exists (select 1 from public.plan_rsvps r join public.plans p on p.id = r.plan_id
               where r.plan_id = p_plan and r.player_id is distinct from p.created_by)
    or exists (select 1 from public.plan_votes v join public.plan_polls q on q.id = v.poll_id where q.plan_id = p_plan)
    or exists (select 1 from public.plan_items where plan_id = p_plan)
    or exists (select 1 from public.plan_costs where plan_id = p_plan)
    or exists (select 1 from public.plan_payments where plan_id = p_plan)
    or exists (select 1 from public.plan_transfers where plan_id = p_plan)
    or exists (select 1 from public.plan_comments where plan_id = p_plan)
    or exists (select 1 from public.rounds rd join public.plans p on p.trip_id = rd.trip_id where p.id = p_plan)
  )
$$;
revoke all on function private.plan_is_empty(uuid) from public, anon;
grant execute on function private.plan_is_empty(uuid) to authenticated; -- the delete guard below runs as the user

-- The app asks this to decide whether to offer "Delete" at all.
create or replace function public.plan_is_empty(p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plans where id = p_plan and private.is_group_member(group_id))
     and private.plan_is_empty(p_plan)
$$;
revoke all on function public.plan_is_empty(uuid) from public, anon;
grant execute on function public.plan_is_empty(uuid) to authenticated;

-- =================================================================================================== call it off / bring it back
create or replace function public.call_off_plan(p_plan uuid, p_off boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid;
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  me := private.my_player_id(v.group_id);
  if not (private.is_group_organiser(v.group_id)
          or (v.organiser_id is not null and v.organiser_id = me)
          or (v.proposed and v.created_by is not null and v.created_by = me)) then
    raise exception 'Only an organiser can call this trip off or bring it back';
  end if;
  if p_off then
    if v.status = 'cancelled' then return; end if;   -- a retry
    update public.plans set status = 'cancelled', cancelled_by = me, cancelled_at = now(), cancelled_from = v.status
    where id = p_plan;
  else
    if v.status <> 'cancelled' then return; end if;
    update public.plans
      set status = case when v.cancelled_from in ('planning', 'confirmed', 'done') then v.cancelled_from else 'planning' end,
          cancelled_by = null, cancelled_at = null, cancelled_from = null
    where id = p_plan;
  end if;
end $$;
revoke all on function public.call_off_plan(uuid, boolean) from public, anon;
grant execute on function public.call_off_plan(uuid, boolean) to authenticated;

-- =================================================================================================== delete an empty plan
create or replace function public.delete_empty_plan(p_plan uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid;
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  me := private.my_player_id(v.group_id);
  if not (private.is_group_organiser(v.group_id) or (v.proposed and v.created_by is not null and v.created_by = me)) then
    raise exception 'Only an organiser can delete a trip';
  end if;
  if not private.plan_is_empty(p_plan) then
    raise exception 'This trip has replies, votes or jobs on it — call it off instead (it keeps everything)';
  end if;
  perform set_config('app.delete_empty_plan', p_plan::text, true);
  delete from public.plans where id = p_plan;
  perform set_config('app.delete_empty_plan', '', true);
end $$;
revoke all on function public.delete_empty_plan(uuid) from public, anon;
grant execute on function public.delete_empty_plan(uuid) to authenticated;

-- =================================================================================================== the safety net
-- Runs as the person deleting (not security definer), so it can tell an app user from a database function.
create or replace function private.plans_delete_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Only deletes made directly by app users; database functions, the service key and cascades from deleting a whole
  -- group run as other roles.
  if current_user not in ('authenticated', 'anon') then return old; end if;
  if coalesce(current_setting('app.delete_empty_plan', true), '') = old.id::text then return old; end if;
  if not private.plan_is_empty(old.id) then
    raise exception 'This trip has replies, votes or jobs on it — call it off instead (it keeps everything)'
      using errcode = 'P0001';
  end if;
  return old;
end $$;
create or replace trigger plans_delete_guard before delete on public.plans
  for each row execute function private.plans_delete_guard();
