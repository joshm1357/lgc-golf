-- 020: Merge pairs of overlapping access rules (performance advisor: "multiple permissive policies").
-- Each pair is replaced by one rule that is the two old rules joined with OR — which is exactly how
-- Postgres already combined them, so the same people can do the same things as before.
-- Runs as one step: if any line fails, nothing changes.

-- plans: admin, or the person suggesting a trip/round.
drop policy "admin insert" on public.plans;
drop policy "propose plan" on public.plans;
create policy "add plan" on public.plans for insert to authenticated
  with check (public.is_admin()
    or (public.is_member() and proposed and status = 'planning' and created_by = public.my_player_id() and not rsvp_locked));
drop policy "admin update" on public.plans;
drop policy "edit own proposal" on public.plans;
create policy "edit plan" on public.plans for update to authenticated
  using (public.is_admin() or (created_by = public.my_player_id() and proposed and status = 'planning'))
  with check (public.is_admin()
    or (created_by = public.my_player_id() and proposed and status = 'planning' and not rsvp_locked));
drop policy "admin delete" on public.plans;
drop policy "withdraw own proposal" on public.plans;
create policy "remove plan" on public.plans for delete to authenticated
  using (public.is_admin() or (created_by = public.my_player_id() and proposed));

-- plan_costs: admin, or the person who paid it.
drop policy "admin insert" on public.plan_costs;
drop policy "log my cost" on public.plan_costs;
create policy "add cost" on public.plan_costs for insert to authenticated
  with check (public.is_admin()
    or (public.is_member() and created_by = public.my_player_id() and paid_by = public.my_player_id()));
drop policy "admin update" on public.plan_costs;
drop policy "edit my cost" on public.plan_costs;
create policy "edit cost" on public.plan_costs for update to authenticated
  using (public.is_admin() or created_by = public.my_player_id())
  with check (public.is_admin() or (created_by = public.my_player_id() and paid_by = public.my_player_id()));
drop policy "admin delete" on public.plan_costs;
drop policy "remove my cost" on public.plan_costs;
create policy "remove cost" on public.plan_costs for delete to authenticated
  using (public.is_admin() or created_by = public.my_player_id());

-- plan_items: creator, owner or admin edits; anyone can claim an unowned job.
-- (The plan_rows_guard trigger still limits a claim to "owner = me" and nothing else.)
drop policy "claim job" on public.plan_items;
drop policy "edit item" on public.plan_items;
create policy "edit item" on public.plan_items for update to authenticated
  using (created_by = public.my_player_id() or owner_id = public.my_player_id() or public.is_admin()
    or (kind = 'job' and owner_id is null and public.is_member()))
  with check (public.is_member() or owner_id = public.my_player_id());

