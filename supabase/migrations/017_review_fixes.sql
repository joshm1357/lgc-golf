-- 017: Fixes from the second review. Additive: policies tightened in place, guards widened.

-- Payments: a member can't record their own payment as already confirmed.
alter policy "record a payment" on public.plan_transfers
  with check (public.is_member() and created_by = public.my_player_id()
    and (public.is_admin() or from_id = public.my_player_id() or to_id = public.my_player_id())
    and (not confirmed or public.is_admin() or to_id = public.my_player_id()));

-- A passed (cancelled) suggestion can't be revived by editing it.
alter policy "edit own proposal" on public.plans
  using (created_by = public.my_player_id() and proposed and status = 'planning');

-- Row guards for non-admins:
--  * jobs: someone who isn't the job's creator or owner can only claim it (owner = me), nothing else;
--  * items, options, costs: can't be moved to another plan/poll or change who made them;
--  * payments: the receiver can only tick "confirmed".
create or replace function public.plan_rows_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_player_id();
begin
  if public.is_admin() then return new; end if;
  if tg_table_name = 'plan_items' then
    if old.created_by is distinct from me and old.owner_id is distinct from me then
      new := old;
      new.owner_id := me;            -- the only change allowed: "I'll do it"
      return new;
    end if;
    new.plan_id := old.plan_id; new.created_by := old.created_by; new.kind := old.kind;
  elsif tg_table_name = 'plan_options' then
    new.poll_id := old.poll_id; new.created_by := old.created_by;
  elsif tg_table_name = 'plan_costs' then
    new.plan_id := old.plan_id; new.created_by := old.created_by;
  elsif tg_table_name = 'plan_transfers' then
    new.plan_id := old.plan_id; new.from_id := old.from_id; new.to_id := old.to_id;
    new.amount := old.amount; new.created_by := old.created_by; new.note := old.note;
  end if;
  return new;
end $$;
create trigger plan_costs_guard before update on public.plan_costs for each row execute function public.plan_rows_guard();
create trigger plan_transfers_guard before update on public.plan_transfers for each row execute function public.plan_rows_guard();
