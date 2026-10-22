-- 078 — The trip plan (22 Oct 2026): jobs you can allocate, the job formula, the accommodation shortlist vote,
-- the trip plan (a tick-list budget) and the deposit. Additive only: new columns, two new tables, one function.
-- Works with or without 077 (the trip builder): anything of 077's is looked up first.
--
-- Money: no new money tracking. A deposit is a payment into the kitty (plan_transfers with to_id null, as today:
-- "I've paid" → the organiser ticks it off). The organiser's PayID / bank details stay in plans.kitty_note.
-- The trip plan (plan_budget_items) is the estimate the deposit is worked out from, not money spent — real costs
-- stay in plan_costs on the Kitty tab.

-- ------------------------------------------------------------------ Jobs: stage, note, cost, allocate, unlock order
alter table public.plan_items add column if not exists stage text not null default 'todo'
  check (stage in ('todo', 'asked', 'done'));
alter table public.plan_items add column if not exists note text check (note is null or length(note) <= 500);
alter table public.plan_items add column if not exists amount numeric(10,2) check (amount is null or (amount >= 0 and amount < 1000000));
alter table public.plan_items add column if not exists after_item uuid references public.plan_items(id) on delete set null;
alter table public.plan_items add column if not exists unlocks text check (unlocks is null or length(unlocks) <= 60);
alter table public.plan_items add column if not exists formula_key text check (formula_key is null or formula_key ~ '^[a-z_]{2,30}$');
alter table public.plan_items add column if not exists handed_by uuid references public.players(id) on delete set null;
create index if not exists plan_items_after_item_idx on public.plan_items (after_item);
create index if not exists plan_items_handed_by_idx on public.plan_items (handed_by);
-- One of each formula job per trip, so running the formula twice can't double up.
create unique index if not exists plan_items_formula_once on public.plan_items (plan_id, formula_key) where formula_key is not null;

-- Jobs already ticked off are Done.
alter table public.plan_items disable trigger user;
update public.plan_items set stage = 'done' where done and stage <> 'done';
alter table public.plan_items enable trigger user;

-- Keeps `done` and `stage` in step (older app versions only know `done`), records who handed a job on (so the
-- "new job" notification can come from them), and stops anyone but an organiser re-wiring the formula links.
-- Named to run after plan_items_guard (triggers run in name order).
create or replace function private.plan_items_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.done then new.stage := 'done'; elsif new.stage = 'done' then new.done := true; end if;
    new.handed_by := case when new.owner_id is not null then coalesce(private.my_player_id(new.group_id), new.created_by) end;
    if auth.uid() is not null and not private.is_group_organiser(new.group_id) then
      new.formula_key := null;
      new.after_item := null;
    end if;
    if new.after_item is not null and not exists (select 1 from public.plan_items i where i.id = new.after_item and i.plan_id = new.plan_id) then
      raise exception 'A job can only wait for another job on the same trip';
    end if;
    return new;
  end if;
  if new.stage is distinct from old.stage then
    new.done := new.stage = 'done';
  elsif new.done is distinct from old.done then
    new.stage := case when new.done then 'done' else 'todo' end;
  end if;
  if new.owner_id is distinct from old.owner_id then
    new.handed_by := case when new.owner_id is null then null else private.my_player_id(new.group_id) end;
  elsif auth.uid() is not null then
    new.handed_by := old.handed_by;
  end if;
  if auth.uid() is not null and not private.is_group_organiser(new.group_id) then
    new.formula_key := old.formula_key;
    new.after_item := old.after_item;
  end if;
  if new.after_item is not null and not exists (select 1 from public.plan_items i where i.id = new.after_item and i.plan_id = new.plan_id and i.id <> new.id) then
    raise exception 'A job can only wait for another job on the same trip';
  end if;
  return new;
end $$;
revoke all on function private.plan_items_stage() from public, anon, authenticated;
create or replace trigger plan_items_stage before insert or update on public.plan_items
  for each row execute function private.plan_items_stage();

-- ------------------------------------------------------------------ Plans: the deposit
alter table public.plans add column if not exists deposit_pp numeric(10,2) check (deposit_pp is null or (deposit_pp >= 0 and deposit_pp < 100000));
alter table public.plans add column if not exists deposit_asked_at timestamptz;

-- ------------------------------------------------------------------ Votes: what a vote is for
alter table public.plan_polls add column if not exists purpose text check (purpose is null or purpose in ('stay'));

-- ------------------------------------------------------------------ The accommodation shortlist
create table if not exists public.plan_stays (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  link text check (link is null or (length(link) <= 600 and link ~* '^https?://')),
  total_cost numeric(10,2) check (total_cost is null or (total_cost >= 0 and total_cost < 1000000)),
  sleeps int check (sleeps is null or sleeps between 1 and 200),
  distance_note text check (distance_note is null or length(distance_note) <= 120),
  option_id uuid references public.plan_options(id) on delete set null,
  chosen boolean not null default false,
  created_by uuid references public.players(id) on delete set null default public.my_player_id(),
  created_at timestamptz not null default now()
);
create index if not exists plan_stays_plan_idx on public.plan_stays (plan_id);
create index if not exists plan_stays_group_idx on public.plan_stays (group_id);
create index if not exists plan_stays_option_idx on public.plan_stays (option_id);
create index if not exists plan_stays_created_by_idx on public.plan_stays (created_by);
alter table public.plan_stays enable row level security;
create policy "members read" on public.plan_stays for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
-- Anyone in the group adds a place (as themselves); the organiser can add for anyone.
create policy "members add" on public.plan_stays for insert
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[])
              or (group_id = any ((select private.my_group_ids())::uuid[]) and created_by = private.my_player_id(group_id)));
create policy "own or organiser change" on public.plan_stays for update
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]) or created_by = private.my_player_id(group_id))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]) or created_by = private.my_player_id(group_id));
create policy "own or organiser remove" on public.plan_stays for delete
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]) or created_by = private.my_player_id(group_id));
create policy "same group only" on public.plan_stays as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: planner_tasks (add)" on public.plan_stays as restrictive for insert with check (public.feature_on(group_id, 'planner_tasks'));
create policy "feature on: planner_tasks (change)" on public.plan_stays as restrictive for update using (public.feature_on(group_id, 'planner_tasks')) with check (public.feature_on(group_id, 'planner_tasks'));
create policy "feature on: planner_tasks (remove)" on public.plan_stays as restrictive for delete using (public.feature_on(group_id, 'planner_tasks'));
revoke all on public.plan_stays from anon;
grant select, insert, update, delete on public.plan_stays to authenticated;
create trigger aa_fill_group_id before insert or update on public.plan_stays
  for each row execute function private.fill_group_id('plans:plan_id');
-- Only an organiser picks the place ("chosen"); nobody moves a place to another trip.
create or replace function private.plan_stays_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_group_organiser(new.group_id) then return new; end if;
  if tg_op = 'INSERT' then new.chosen := false; new.option_id := null; return new; end if;
  new.chosen := old.chosen; new.plan_id := old.plan_id; new.created_by := old.created_by;
  if coalesce(current_setting('app.stay_vote', true), '') <> 'on' then new.option_id := old.option_id; end if;
  return new;
end $$;
revoke all on function private.plan_stays_guard() from public, anon, authenticated;
create trigger ac_guard before insert or update on public.plan_stays for each row execute function private.plan_stays_guard();

-- ------------------------------------------------------------------ The trip plan (a tick-list budget)
create table if not exists public.plan_budget_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  kind text not null check (kind in ('accommodation', 'green_fees', 'trophy', 'shirts', 'food', 'drinks', 'transport', 'other')),
  label text not null check (length(btrim(label)) between 1 and 80),
  amount numeric(10,2) check (amount is null or (amount >= 0 and amount < 1000000)),  -- a total, or $ per person if per_person
  per_person boolean not null default false,
  upfront boolean not null default false,       -- paid before the trip, so it's in the deposit
  ticked boolean not null default true,         -- in the plan (counts towards the total)
  lines jsonb not null default '[]'::jsonb       -- food plan / green fees: [{ "label": "Fri dinner — BBQ at the house", "pp": 25 }]
    check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 30 and length(lines::text) <= 6000),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists plan_budget_items_plan_idx on public.plan_budget_items (plan_id);
create index if not exists plan_budget_items_group_idx on public.plan_budget_items (group_id);
alter table public.plan_budget_items enable row level security;
create policy "members read" on public.plan_budget_items for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.plan_budget_items for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.plan_budget_items as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: planner_costs (add)" on public.plan_budget_items as restrictive for insert with check (public.feature_on(group_id, 'planner_costs'));
create policy "feature on: planner_costs (change)" on public.plan_budget_items as restrictive for update using (public.feature_on(group_id, 'planner_costs')) with check (public.feature_on(group_id, 'planner_costs'));
create policy "feature on: planner_costs (remove)" on public.plan_budget_items as restrictive for delete using (public.feature_on(group_id, 'planner_costs'));
revoke all on public.plan_budget_items from anon;
grant select, insert, update, delete on public.plan_budget_items to authenticated;
create trigger aa_fill_group_id before insert or update on public.plan_budget_items
  for each row execute function private.fill_group_id('plans:plan_id');

-- ------------------------------------------------------------------ Put the shortlist to the group
-- The organiser, the trip's organiser, or whoever has the "Shortlist accommodation" job. Makes one vote "Where
-- should we stay?" from the places on the shortlist (or adds new places to the one that's open). If the trip
-- builder's combined vote is still open (077's vote cards), the stay vote joins that card instead of being a vote
-- of its own. Ticks off the shortlist job. Returns { poll_id, joined } — joined = true means no new notification.
create or replace function public.put_stays_to_vote(p_plan uuid, p_closes_on date default null)
returns json language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; v_poll uuid; v_batch uuid; v_joined boolean := false; v_keen int; s record; v_opt uuid; n int;
begin
  select * into v from public.plans where id = p_plan;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  me := private.my_player_id(v.group_id);
  if not (private.is_group_organiser(v.group_id) or (me is not null and (me = v.organiser_id or exists (
      select 1 from public.plan_items i where i.plan_id = p_plan and i.formula_key = 'shortlist_stay' and i.owner_id = me)))) then
    raise exception 'Only the organiser or whoever has the shortlist job can put it to a vote';
  end if;
  if not public.feature_on(v.group_id, 'planner_tasks') then raise exception 'Votes are switched off for this group'; end if;
  if v.status in ('done', 'cancelled') then raise exception 'This trip is finished'; end if;
  select count(*) into n from public.plan_stays where plan_id = p_plan;
  if n < 2 then raise exception 'Add at least two places first'; end if;
  if p_closes_on is not null and p_closes_on < (now() at time zone 'Australia/Sydney')::date then raise exception 'The closing date has passed'; end if;
  select count(*) into v_keen from public.plan_rsvps where plan_id = p_plan and status in ('in', 'maybe');

  select id into v_poll from public.plan_polls where plan_id = p_plan and purpose = 'stay' and status = 'open' order by created_at desc limit 1;
  if v_poll is null then
    -- The trip builder's combined vote card, if 077 is here and one is open on this trip.
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plan_polls' and column_name = 'vote_batch') then
      execute 'select vote_batch from public.plan_polls where plan_id = $1 and status = ''open'' and vote_batch is not null order by created_at desc limit 1'
        into v_batch using p_plan;
    end if;
    insert into public.plan_polls (plan_id, group_id, kind, purpose, question, closes_on, created_by)
    values (p_plan, v.group_id, 'other', 'stay', 'Where should we stay?', p_closes_on, me) returning id into v_poll;
    if v_batch is not null then
      execute 'update public.plan_polls set vote_batch = $1 where id = $2' using v_batch, v_poll;
      v_joined := true;
    end if;
  else
    v_joined := true;  -- adding places to a vote that's already out
  end if;

  perform set_config('app.stay_vote', 'on', true);
  for s in select * from public.plan_stays where plan_id = p_plan and option_id is null order by created_at loop
    insert into public.plan_options (poll_id, group_id, label, link, cost_pp, notes, created_by)
    values (v_poll, v.group_id, left(s.name, 120), s.link,
            case when s.total_cost is not null and v_keen > 0 then round(s.total_cost / v_keen) end,
            nullif(concat_ws(' · ',
              case when s.total_cost is not null then '$' || to_char(s.total_cost, 'FM999,999,990') || ' total' end,
              case when s.sleeps is not null then 'sleeps ' || s.sleeps end,
              s.distance_note), ''),
            coalesce(s.created_by, me))
    returning id into v_opt;
    update public.plan_stays set option_id = v_opt where id = s.id;
  end loop;
  perform set_config('app.stay_vote', '', true);

  update public.plan_items set stage = 'done' where plan_id = p_plan and formula_key = 'shortlist_stay' and stage <> 'done';
  return json_build_object('poll_id', v_poll, 'joined', v_joined);
end $$;
revoke all on function public.put_stays_to_vote(uuid, date) from public, anon;
grant execute on function public.put_stays_to_vote(uuid, date) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.plan_stays, public.plan_budget_items;
exception when others then null; end $$;

select private.add_same_group_checks();
