-- 013: The Planner — organise any number of future trips and one-day rounds,
-- plus phone notifications. Additive only: new tables, and the draws table can now
-- belong to a plan (rooms & cars) instead of a round.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'trip' check (kind in ('trip','round')),
  name text not null,
  status text not null default 'planning' check (status in ('planning','confirmed','done','cancelled')),
  start_date date,
  end_date date,
  location_name text,
  address text,
  link text,
  brief text,                                   -- the details: accommodation, check-in, meeting point…
  rsvp_locked boolean not null default false,   -- "the list is locked": only admin can change who's coming
  rsvp_deadline date,
  kitty_note text,                              -- how to pay (bank details, PayID…)
  trip_id uuid references public.trips(id) on delete set null,
  created_by uuid references public.players(id) on delete set null default public.my_player_id(),
  created_at timestamptz not null default now()
);

create table public.plan_polls (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  kind text not null default 'other' check (kind in ('dates','location','other')),
  question text not null,
  status text not null default 'open' check (status in ('open','closed')),
  closes_on date,
  winner_option_id uuid,
  created_by uuid references public.players(id) on delete set null default public.my_player_id(),
  created_at timestamptz not null default now()
);

create table public.plan_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.plan_polls(id) on delete cascade,
  label text not null,
  start_date date,
  end_date date,
  address text,
  link text,
  cost_pp numeric(10,2),
  notes text,
  created_by uuid references public.players(id) on delete set null default public.my_player_id(),
  created_at timestamptz not null default now()
);
alter table public.plan_polls add constraint plan_polls_winner_fk
  foreign key (winner_option_id) references public.plan_options(id) on delete set null;

create table public.plan_votes (
  option_id uuid not null references public.plan_options(id) on delete cascade,
  poll_id uuid not null references public.plan_polls(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  response text not null check (response in ('yes','maybe','no')),
  updated_at timestamptz not null default now(),
  primary key (option_id, player_id)
);

create table public.plan_rsvps (
  plan_id uuid not null references public.plans(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null check (status in ('in','maybe','out')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (plan_id, player_id)
);

-- Day-by-day plan, info, jobs and the bring list all live here.
create table public.plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  kind text not null check (kind in ('day','info','job','bring')),
  day date,
  time text,
  title text not null,
  body text,
  address text,
  link text,
  owner_id uuid references public.players(id) on delete set null,
  due date,
  done boolean not null default false,
  sort int not null default 0,
  created_by uuid references public.players(id) on delete set null default public.my_player_id(),
  created_at timestamptz not null default now()
);

-- The kitty: costs, and what each person has paid in.
create table public.plan_costs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  title text not null,
  amount numeric(10,2) not null check (amount >= 0),
  per_head boolean not null default false,       -- true = amount is per person, false = total split between those in
  paid_by uuid references public.players(id) on delete set null,  -- who fronted it (null = paid from the kitty)
  created_at timestamptz not null default now()
);
create table public.plan_payments (
  plan_id uuid not null references public.plans(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  paid numeric(10,2) not null default 0,
  note text,
  updated_at timestamptz not null default now(),
  primary key (plan_id, player_id)
);

-- Rooms and cars.
create table public.plan_groups (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  kind text not null check (kind in ('room','car')),
  name text not null,
  capacity int not null default 2 check (capacity between 1 and 12),
  note text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create table public.plan_group_members (
  group_id uuid not null references public.plan_groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (group_id, player_id)
);

-- Phone notifications (Web Push). One row per phone/browser.
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid(),
  player_id uuid references public.players(id) on delete cascade default public.my_player_id(),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
-- Stops the daily reminders sending the same thing twice. Server-only (no policies).
create table public.notify_log (
  key text primary key,
  sent_at timestamptz not null default now()
);

-- The draw can now be for a plan's rooms or cars.
alter table public.draws add column plan_id uuid references public.plans(id) on delete cascade;
alter table public.draws alter column round_id drop not null;

-- ---------- Security ----------
do $$
declare t text;
begin
  foreach t in array array['plans','plan_polls','plan_options','plan_votes','plan_rsvps','plan_items',
    'plan_costs','plan_payments','plan_groups','plan_group_members','push_subscriptions','notify_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['plans','plan_polls','plan_options','plan_votes','plan_rsvps','plan_items',
    'plan_costs','plan_payments','plan_groups','plan_group_members']
  loop
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
  -- Admin decides: plans, polls, kitty, rooms & cars.
  foreach t in array array['plans','plan_polls','plan_costs','plan_payments','plan_groups','plan_group_members']
  loop
    execute format('create policy "admin insert" on public.%I for insert to authenticated with check (public.is_admin())', t);
    execute format('create policy "admin update" on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('create policy "admin delete" on public.%I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Anyone suggests an option while the vote is open; edit/remove your own (admin any).
create policy "suggest option" on public.plan_options for insert to authenticated
  with check (public.is_member() and (public.is_admin() or (created_by = public.my_player_id()
    and exists (select 1 from public.plan_polls p where p.id = poll_id and p.status = 'open'))));
create policy "edit own option" on public.plan_options for update to authenticated
  using (created_by = public.my_player_id() or public.is_admin())
  with check (created_by = public.my_player_id() or public.is_admin());
create policy "remove own option" on public.plan_options for delete to authenticated
  using (created_by = public.my_player_id() or public.is_admin());

-- Vote as yourself, only while the vote is open, only on an option in that poll.
create policy "vote as me" on public.plan_votes for insert to authenticated
  with check (player_id = public.my_player_id()
    and exists (select 1 from public.plan_options o join public.plan_polls p on p.id = o.poll_id
                where o.id = option_id and p.id = poll_id and p.status = 'open'));
create policy "change my vote" on public.plan_votes for update to authenticated
  using (player_id = public.my_player_id())
  with check (player_id = public.my_player_id()
    and exists (select 1 from public.plan_polls p where p.id = poll_id and p.status = 'open'));
create policy "clear my vote" on public.plan_votes for delete to authenticated
  using (player_id = public.my_player_id()
    and exists (select 1 from public.plan_polls p where p.id = poll_id and p.status = 'open'));

-- RSVP as yourself until the admin locks the list; admin can always set anyone.
create policy "rsvp" on public.plan_rsvps for insert to authenticated
  with check (public.is_admin() or (player_id = public.my_player_id()
    and exists (select 1 from public.plans p where p.id = plan_id and not p.rsvp_locked)));
create policy "change rsvp" on public.plan_rsvps for update to authenticated
  using (public.is_admin() or player_id = public.my_player_id())
  with check (public.is_admin() or (player_id = public.my_player_id()
    and exists (select 1 from public.plans p where p.id = plan_id and not p.rsvp_locked)));
create policy "remove rsvp" on public.plan_rsvps for delete to authenticated
  using (public.is_admin() or (player_id = public.my_player_id()
    and exists (select 1 from public.plans p where p.id = plan_id and not p.rsvp_locked)));

-- Items: anyone adds; the creator, the job's owner or admin can edit; creator or admin removes.
create policy "add item" on public.plan_items for insert to authenticated
  with check (public.is_member() and (created_by = public.my_player_id() or public.is_admin()));
create policy "edit item" on public.plan_items for update to authenticated
  using (created_by = public.my_player_id() or owner_id = public.my_player_id() or public.is_admin())
  with check (public.is_member());
create policy "remove item" on public.plan_items for delete to authenticated
  using (created_by = public.my_player_id() or public.is_admin());

-- Push subscriptions: only your own.
create policy "own subs read" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "own subs add" on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid() and public.is_member());
create policy "own subs update" on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own subs remove" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

create index on public.plan_polls (plan_id);
create index on public.plan_options (poll_id);
create index on public.plan_votes (poll_id);
create index on public.plan_items (plan_id);
create index on public.plan_costs (plan_id);
create index on public.plan_groups (plan_id);
create index on public.push_subscriptions (player_id);
create index on public.draws (plan_id);

alter publication supabase_realtime add table
  public.plans, public.plan_polls, public.plan_options, public.plan_votes, public.plan_rsvps,
  public.plan_items, public.plan_costs, public.plan_payments, public.plan_groups, public.plan_group_members;
