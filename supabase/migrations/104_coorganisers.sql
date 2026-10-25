-- 104 — Co-organisers (ov35, Josh 23 Oct: "share a trip and ask people to contribute"). Additive only.
--
-- The organiser (a group organiser, or the trip's own organiser) names 1–3 players as co-organisers of ONE trip. On
-- that trip they can do everything an organiser can while it's being planned: change the trip builder, call and
-- close votes, jobs, money, rooms & cars, lock it in or call it off. Nothing outside that trip changes for them.
--
--   * New table plan_coorganisers (plan_id, player_id) with RLS like every other planner table.
--   * private.is_plan_coorganiser(plan) — "am I a co-organiser of this trip?" — and extra PERMISSIVE policies on the
--     trip's tables that let a co-organiser do what an organiser can. The existing restrictive policies (same group
--     only, feature switches) still apply on top. No existing policy is dropped or changed.
--   * The organiser checks INSIDE functions and guard triggers learn about co-organisers. Done the 029 way: the live
--     function body is read and only the check is changed (so nothing else in it can drift). Each patch is skipped if
--     already done (the migration re-runs cleanly) and fails loudly if the check isn't where it's expected.
--   * can_decide (who picks a vote's winner) — replaced: same as 025 plus co-organisers.
-- Nothing is dropped. Older app versions keep working (they just don't show the co-organiser bits).

-- ------------------------------------------------------------------ the table
create table if not exists public.plan_coorganisers (
  plan_id uuid not null references public.plans(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  added_by uuid references public.players(id) on delete set null default public.my_player_id(),
  created_at timestamptz not null default now(),
  primary key (plan_id, player_id)
);
create index if not exists plan_coorganisers_group_idx on public.plan_coorganisers (group_id);
create index if not exists plan_coorganisers_player_idx on public.plan_coorganisers (player_id);
create index if not exists plan_coorganisers_added_by_idx on public.plan_coorganisers (added_by);
alter table public.plan_coorganisers enable row level security;
revoke all on public.plan_coorganisers from anon;
grant select, insert, delete on public.plan_coorganisers to authenticated;

drop trigger if exists aa_fill_group_id on public.plan_coorganisers;
create trigger aa_fill_group_id before insert or update on public.plan_coorganisers
  for each row execute function private.fill_group_id('plans:plan_id');

-- Am I a co-organiser of this trip?
create or replace function private.is_plan_coorganiser(p_plan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_plan is not null and exists (
    select 1 from public.plan_coorganisers c
    where c.plan_id = p_plan and c.player_id = private.my_player_id(c.group_id)
  )
$$;
revoke all on function private.is_plan_coorganiser(uuid) from public, anon;
grant execute on function private.is_plan_coorganiser(uuid) to authenticated;

-- Can I name co-organisers for this trip? A group organiser, or the trip's own organiser.
create or replace function private.can_name_coorganisers(p_plan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans p
    where p.id = p_plan and private.is_group_member(p.group_id)
      and (private.is_group_organiser(p.group_id)
           or (p.organiser_id is not null and p.organiser_id = private.my_player_id(p.group_id)))
  )
$$;
revoke all on function private.can_name_coorganisers(uuid) from public, anon;
grant execute on function private.can_name_coorganisers(uuid) to authenticated;

drop policy if exists "members read" on public.plan_coorganisers;
create policy "members read" on public.plan_coorganisers for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
drop policy if exists "organisers add" on public.plan_coorganisers;
create policy "organisers add" on public.plan_coorganisers for insert
  with check (private.can_name_coorganisers(plan_id));
-- The organiser takes someone off, or a co-organiser steps down themselves.
drop policy if exists "organisers or themselves remove" on public.plan_coorganisers;
create policy "organisers or themselves remove" on public.plan_coorganisers for delete
  using (private.can_name_coorganisers(plan_id) or player_id = private.my_player_id(group_id));
drop policy if exists "same group only" on public.plan_coorganisers;
create policy "same group only" on public.plan_coorganisers as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
drop policy if exists "feature on: planner (add)" on public.plan_coorganisers;
create policy "feature on: planner (add)" on public.plan_coorganisers as restrictive for insert with check (public.feature_on(group_id, 'planner'));

-- Up to 3 per trip; a player (not a guest) in the trip's group; not on a finished or called-off trip.
create or replace function private.plan_coorganisers_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.plans;
begin
  select * into v from public.plans where id = new.plan_id;
  if v.id is null then raise exception 'Trip not found'; end if;
  if v.status in ('done', 'cancelled') then raise exception 'This trip is finished — no co-organisers needed'; end if;
  if not exists (select 1 from public.players where id = new.player_id and group_id = v.group_id) then
    raise exception 'That player isn''t in this group';
  end if;
  if exists (select 1 from public.group_members where group_id = v.group_id and player_id = new.player_id and role = 'guest') then
    raise exception 'A guest can''t be a co-organiser';
  end if;
  if (select count(*) from public.plan_coorganisers where plan_id = new.plan_id and player_id <> new.player_id) >= 3 then
    raise exception 'Up to 3 co-organisers a trip';
  end if;
  return new;
end $$;
revoke all on function private.plan_coorganisers_check() from public, anon, authenticated;
drop trigger if exists ac_check on public.plan_coorganisers;
create trigger ac_check before insert on public.plan_coorganisers
  for each row execute function private.plan_coorganisers_check();

select private.add_same_group_checks();
do $$ begin
  alter publication supabase_realtime add table public.plan_coorganisers;
exception when others then null; end $$;

-- ------------------------------------------------------------------ what a co-organiser can do on the trip's tables
-- Extra permissive policies, one set per table, keyed on the row's trip. (Organisers keep their existing policies.)
do $$
declare t text;
begin
  foreach t in array array['plan_polls', 'vote_batches', 'plan_rsvps', 'plan_items', 'plan_costs', 'plan_payments',
    'plan_transfers', 'plan_groups', 'plan_stays', 'plan_budget_items', 'trip_builds', 'trip_tee_options', 'trip_start_points']
  loop
    continue when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'plan_id');
    execute format('drop policy if exists "co-organisers add" on public.%I', t);
    execute format('create policy "co-organisers add" on public.%I for insert to authenticated with check (private.is_plan_coorganiser(plan_id))', t);
    execute format('drop policy if exists "co-organisers change" on public.%I', t);
    execute format('create policy "co-organisers change" on public.%I for update to authenticated using (private.is_plan_coorganiser(plan_id)) with check (private.is_plan_coorganiser(plan_id))', t);
    execute format('drop policy if exists "co-organisers remove" on public.%I', t);
    execute format('create policy "co-organisers remove" on public.%I for delete to authenticated using (private.is_plan_coorganiser(plan_id))', t);
  end loop;
end $$;

-- Options hang off a vote; room/car members hang off a room/car.
create or replace function private.coorganiser_of_poll(p_poll uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plan_polls p where p.id = p_poll and private.is_plan_coorganiser(p.plan_id))
$$;
revoke all on function private.coorganiser_of_poll(uuid) from public, anon;
grant execute on function private.coorganiser_of_poll(uuid) to authenticated;
create or replace function private.coorganiser_of_plan_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plan_groups g where g.id = p_group and private.is_plan_coorganiser(g.plan_id))
$$;
revoke all on function private.coorganiser_of_plan_group(uuid) from public, anon;
grant execute on function private.coorganiser_of_plan_group(uuid) to authenticated;

drop policy if exists "co-organisers add" on public.plan_options;
create policy "co-organisers add" on public.plan_options for insert to authenticated with check (private.coorganiser_of_poll(poll_id));
drop policy if exists "co-organisers change" on public.plan_options;
create policy "co-organisers change" on public.plan_options for update to authenticated using (private.coorganiser_of_poll(poll_id)) with check (private.coorganiser_of_poll(poll_id));
drop policy if exists "co-organisers remove" on public.plan_options;
create policy "co-organisers remove" on public.plan_options for delete to authenticated using (private.coorganiser_of_poll(poll_id));

drop policy if exists "co-organisers add" on public.plan_group_members;
create policy "co-organisers add" on public.plan_group_members for insert to authenticated with check (private.coorganiser_of_plan_group(group_id));
drop policy if exists "co-organisers change" on public.plan_group_members;
create policy "co-organisers change" on public.plan_group_members for update to authenticated using (private.coorganiser_of_plan_group(group_id)) with check (private.coorganiser_of_plan_group(group_id));
drop policy if exists "co-organisers remove" on public.plan_group_members;
create policy "co-organisers remove" on public.plan_group_members for delete to authenticated using (private.coorganiser_of_plan_group(group_id));

-- The trip itself (dates, place, lock in, the who's-in list). Who organises it and its link to the app's trip stay
-- the group organiser's (plans_trip_guard already holds those for everyone else).
drop policy if exists "co-organisers edit" on public.plans;
create policy "co-organisers edit" on public.plans for update to authenticated
  using (private.is_plan_coorganiser(id)) with check (private.is_plan_coorganiser(id));

-- ------------------------------------------------------------------ who picks a vote's winner
-- As 025, plus the trip's co-organisers.
create or replace function public.can_decide(p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans p join public.groups g on g.id = p.group_id
    where p.id = p_plan and private.is_group_member(p.group_id)
      and (private.is_group_organiser(p.group_id)
           or private.is_plan_coorganiser(p.id)
           or (g.vote_decider = 'admin_or_organiser' and p.organiser_id is not null
               and p.organiser_id = private.my_player_id(p.group_id)))
  )
$$;
revoke all on function public.can_decide(uuid) from public, anon;
grant execute on function public.can_decide(uuid) to authenticated;

-- ------------------------------------------------------------------ the checks inside functions and guards
-- For a guard row: which trip is it on? (plan_items / plan_costs / plan_transfers: plan_id; plan_options: its vote's
-- trip.) Used by plan_rows_guard so a co-organiser editing a job isn't treated as "claiming" it.
create or replace function private.coorganiser_of_row(p_table text, p_row jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_row ? 'plan_id' then return private.is_plan_coorganiser(nullif(p_row ->> 'plan_id', '')::uuid); end if;
  if p_table = 'plan_options' then return private.coorganiser_of_poll(nullif(p_row ->> 'poll_id', '')::uuid); end if;
  return false;
end $$;
revoke all on function private.coorganiser_of_row(text, jsonb) from public, anon;
grant execute on function private.coorganiser_of_row(text, jsonb) to authenticated;

-- Patch one function: replace `find` with `put` in its live body. Skipped when `done` is already in it; refuses when
-- `find` isn't there (so a function that changed elsewhere is noticed, not quietly left alone).
create or replace function private.ov35_patch(p_fn regprocedure, p_find text, p_put text, p_done text) returns text
language plpgsql set search_path = '' as $$
declare v_def text := pg_get_functiondef(p_fn); v_new text;
begin
  if position(p_done in v_def) > 0 then return 'already'; end if;
  if position(p_find in v_def) = 0 then raise exception '104: % has changed — its organiser check wasn''t found', p_fn; end if;
  v_new := replace(v_def, p_find, p_put);
  execute v_new;
  return 'patched';
end $$;
revoke all on function private.ov35_patch(regprocedure, text, text, text) from public, anon, authenticated;

do $$ begin
  -- 022: the planner row guard — organisers (and now co-organisers) may change anything on a row.
  perform private.ov35_patch('public.plan_rows_guard()'::regprocedure,
    'if private.is_group_organiser(v_g) then return new; end if;',
    'if private.is_group_organiser(v_g) or private.coorganiser_of_row(tg_table_name, to_jsonb(new)) then return new; end if;',
    'coorganiser_of_row');
  -- 078: a job's formula links.
  perform private.ov35_patch('private.plan_items_stage()'::regprocedure,
    'if auth.uid() is not null and not private.is_group_organiser(new.group_id) then',
    'if auth.uid() is not null and not private.is_group_organiser(new.group_id) and not private.is_plan_coorganiser(new.plan_id) then',
    'is_plan_coorganiser');
  -- 078: picking the place to stay.
  perform private.ov35_patch('private.plan_stays_guard()'::regprocedure,
    'if auth.uid() is null or private.is_group_organiser(new.group_id) then return new; end if;',
    'if auth.uid() is null or private.is_group_organiser(new.group_id) or private.is_plan_coorganiser(new.plan_id) then return new; end if;',
    'is_plan_coorganiser');
  -- 085: moving a late job's due date.
  perform private.ov35_patch('private.plan_items_late_guard()'::regprocedure,
    'and not private.is_group_organiser(new.group_id)',
    'and not private.is_group_organiser(new.group_id) and not private.is_plan_coorganiser(new.plan_id)',
    'is_plan_coorganiser');
  -- 064: "the same again next year" shape (picking a trip in the builder writes it).
  perform private.ov35_patch('private.plans_repeat_guard()'::regprocedure,
    'if auth.uid() is null or private.is_group_organiser(new.group_id) then return new; end if;',
    'if auth.uid() is null or private.is_group_organiser(new.group_id) or (tg_op = ''UPDATE'' and private.is_plan_coorganiser(new.id)) then return new; end if;',
    'is_plan_coorganiser');
  -- 091: call it off / bring it back.
  perform private.ov35_patch('public.call_off_plan(uuid, boolean)'::regprocedure,
    'if not (private.is_group_organiser(v.group_id)',
    'if not (private.is_group_organiser(v.group_id) or private.is_plan_coorganiser(v.id)',
    'is_plan_coorganiser');
  -- 078 / 080: put the places to stay to a vote.
  perform private.ov35_patch('public.put_stays_to_vote(uuid, date)'::regprocedure,
    'if not (private.is_group_organiser(v.group_id) or',
    'if not (private.is_group_organiser(v.group_id) or private.is_plan_coorganiser(v.id) or',
    'is_plan_coorganiser');
  perform private.ov35_patch('public.put_stays_to_vote(uuid, date, uuid[])'::regprocedure,
    'if not (private.is_group_organiser(v.group_id) or',
    'if not (private.is_group_organiser(v.group_id) or private.is_plan_coorganiser(v.id) or',
    'is_plan_coorganiser');
end $$;
