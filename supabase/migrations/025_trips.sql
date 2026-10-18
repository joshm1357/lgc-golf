-- 025 — Stage 1b: Trips (one trip from idea → votes → locked in → on the trip → done) and notification choices.
-- Additive only: new columns, tables, functions, triggers, policies. Old phones keep working:
--   * a plan set to "Locked in" (old Edit sheet or new button) now also gets its trip in the app, once;
--   * the old "Set it up in the app" sheet still works (it links its own trip, so no second one is made).
-- (024 is kept for the Stage 1 review fixes.)

-- ------------------------------------------------------------------ Group setting: who decides votes
alter table public.groups add column if not exists vote_decider text not null default 'admin'
  check (vote_decider in ('admin', 'admin_or_organiser'));
grant select (vote_decider) on public.groups to authenticated;

create or replace function public.set_vote_decider(p_group uuid, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_group_organiser(p_group) then raise exception 'Only the admin can change that'; end if;
  if p_value not in ('admin', 'admin_or_organiser') then raise exception 'Unknown setting'; end if;
  update public.groups set vote_decider = p_value where id = p_group;
end $$;
revoke all on function public.set_vote_decider(uuid, text) from public, anon;
grant execute on function public.set_vote_decider(uuid, text) to authenticated;

-- ------------------------------------------------------------------ Plans: an organiser and a rough budget
alter table public.plans add column if not exists organiser_id uuid references public.players(id) on delete set null;
alter table public.plans add column if not exists budget_pp numeric check (budget_pp is null or budget_pp >= 0);
create index if not exists plans_organiser_id_idx on public.plans (organiser_id);
alter table public.plans disable trigger user;
update public.plans set organiser_id = created_by where organiser_id is null and created_by is not null;
alter table public.plans enable trigger user;

-- Past trips with no plan (e.g. the 2026 South Coast trip) get one, so every trip sits in one list.
alter table public.plans disable trigger user;
insert into public.plans (kind, name, status, start_date, end_date, trip_id, created_by, proposed, group_id)
select 'trip', t.name,
       -- still to come or on now → Locked in; finished → Done. A trip with no dates counts as on now if it's the current one.
       case when coalesce(t.end_date, t.start_date) >= (now() at time zone 'Australia/Sydney')::date
              or (t.start_date is null and t.status = 'active') then 'confirmed' else 'done' end,
       t.start_date, t.end_date, t.id, null, false, t.group_id
from public.trips t
where not exists (select 1 from public.plans p where p.trip_id = t.id);
alter table public.plans enable trigger user;

-- Guard + lock-in. Runs after aa_fill_group_id (triggers fire in name order), so group_id is set.
--  * Only the admin changes who organises, who made it, or which trip it's linked to.
--  * When a plan is Locked in and has dates, its trip in the app is made (once — the link is set on the same row).
--  * Dates changed after that are copied to the trip.
create or replace function private.plans_trip_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_trusted boolean := auth.uid() is null;  -- the server (edge functions, scheduler, migrations)
begin
  if tg_op = 'INSERT' then
    if not v_trusted and not private.is_group_organiser(new.group_id) then
      new.organiser_id := new.created_by;
      new.trip_id := null;
    else
      new.organiser_id := coalesce(new.organiser_id, new.created_by);
    end if;
  elsif not v_trusted and not private.is_group_organiser(new.group_id) then
    new.organiser_id := old.organiser_id;
    new.created_by := old.created_by;
    new.trip_id := old.trip_id;
  end if;

  if new.status = 'confirmed' and new.trip_id is null and new.start_date is not null and not new.proposed then
    insert into public.trips (name, start_date, end_date, status, group_id)
    values (new.name, new.start_date, coalesce(new.end_date, new.start_date), 'locked', new.group_id)
    returning id into new.trip_id;
  elsif tg_op = 'UPDATE' and new.trip_id is not null and new.trip_id is not distinct from old.trip_id
        and new.start_date is not null
        and (new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date) then
    update public.trips set start_date = new.start_date, end_date = coalesce(new.end_date, new.start_date)
    where id = new.trip_id and group_id = new.group_id;
  end if;
  return new;
end $$;
revoke all on function private.plans_trip_guard() from public, anon, authenticated;
create trigger plans_trip_guard before insert or update on public.plans
  for each row execute function private.plans_trip_guard();

-- ------------------------------------------------------------------ A suggestion opens its own dates and place votes
-- Whoever suggested the trip (or its organiser, or the admin) can open the FIRST dates vote and the FIRST place
-- vote, with the options they suggested. After that, anyone can add options (existing rule), and only the admin
-- (or the organiser, if the group allows) picks winners.
--   p_dates:  [{ "start_date": "2027-03-12", "end_date": "2027-03-15" } | { "label": "Sometime in March" }, …]
--   p_places: [{ "label": "Port Macquarie", "address": "...", "link": "...", "cost_pp": 450 }, …]
create or replace function public.start_trip_votes(p_plan uuid, p_dates jsonb, p_places jsonb, p_closes_on date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid; n int := 0; v_poll uuid; o jsonb; v_label text; v_s date; v_e date;
begin
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  me := private.my_player_id(v.group_id);
  if not (private.is_group_organiser(v.group_id) or (me is not null and me in (v.created_by, v.organiser_id))) then
    raise exception 'Only whoever suggested it (or the admin) can open its votes';
  end if;
  if v.status <> 'planning' then raise exception 'This one is past voting'; end if;
  if p_closes_on is not null and p_closes_on < (now() at time zone 'Australia/Sydney')::date then
    raise exception 'The closing date has passed';
  end if;

  if jsonb_typeof(p_dates) = 'array' and jsonb_array_length(p_dates) > 0
     and not exists (select 1 from public.plan_polls where plan_id = p_plan and kind = 'dates') then
    insert into public.plan_polls (plan_id, group_id, kind, question, closes_on, created_by)
    values (p_plan, v.group_id, 'dates', 'Which weekend works?', p_closes_on, me) returning id into v_poll;
    for o in select value from jsonb_array_elements(p_dates) limit 6 loop
      v_s := nullif(o ->> 'start_date', '')::date;
      v_e := coalesce(nullif(o ->> 'end_date', '')::date, v_s);
      if v_e < v_s then v_e := v_s; end if;
      v_label := coalesce(nullif(btrim(o ->> 'label'), ''), case when v_s is not null then to_char(v_s, 'DD Mon YYYY') end);
      continue when v_label is null;
      insert into public.plan_options (poll_id, group_id, label, start_date, end_date, created_by)
      values (v_poll, v.group_id, left(v_label, 120), v_s, v_e, me);
    end loop;
    n := n + 1;
  end if;

  if jsonb_typeof(p_places) = 'array' and jsonb_array_length(p_places) > 0
     and not exists (select 1 from public.plan_polls where plan_id = p_plan and kind = 'location') then
    insert into public.plan_polls (plan_id, group_id, kind, question, closes_on, created_by)
    values (p_plan, v.group_id, 'location', 'Where should we go?', p_closes_on, me) returning id into v_poll;
    for o in select value from jsonb_array_elements(p_places) limit 6 loop
      v_label := nullif(btrim(o ->> 'label'), '');
      continue when v_label is null;
      insert into public.plan_options (poll_id, group_id, label, address, link, cost_pp, created_by)
      values (v_poll, v.group_id, left(v_label, 120), nullif(btrim(o ->> 'address'), ''), nullif(btrim(o ->> 'link'), ''),
              nullif(o ->> 'cost_pp', '')::numeric, me);
    end loop;
    n := n + 1;
  end if;
  return n;
end $$;
revoke all on function public.start_trip_votes(uuid, jsonb, jsonb, date) from public, anon;
grant execute on function public.start_trip_votes(uuid, jsonb, jsonb, date) to authenticated;

-- ------------------------------------------------------------------ Picking a winner
-- The admin always can; the trip's organiser can too when the group's setting is "admin or organiser".
create or replace function public.can_decide(p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans p join public.groups g on g.id = p.group_id
    where p.id = p_plan and private.is_group_member(p.group_id)
      and (private.is_group_organiser(p.group_id)
           or (g.vote_decider = 'admin_or_organiser' and p.organiser_id is not null
               and p.organiser_id = private.my_player_id(p.group_id)))
  )
$$;
revoke all on function public.can_decide(uuid) from public, anon;
grant execute on function public.can_decide(uuid) to authenticated;

create or replace function public.decide_poll(p_poll uuid, p_option uuid, p_apply boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v_poll public.plan_polls; v_opt public.plan_options; v_plan public.plans;
begin
  select * into v_poll from public.plan_polls where id = p_poll for update;
  if v_poll.id is null or not private.is_group_member(v_poll.group_id) then raise exception 'Vote not found'; end if;
  if not public.can_decide(v_poll.plan_id) then raise exception 'Only the admin can pick the winner of this vote'; end if;
  if v_poll.status <> 'open' then
    if v_poll.winner_option_id = p_option then return; end if;   -- a retry of the same pick
    raise exception 'That vote is already closed';
  end if;
  select * into v_opt from public.plan_options where id = p_option and poll_id = p_poll;
  if v_opt.id is null then raise exception 'That option isn''t in this vote'; end if;
  update public.plan_polls set status = 'closed', winner_option_id = p_option where id = p_poll;
  if not p_apply then return; end if;
  select * into v_plan from public.plans where id = v_poll.plan_id;
  if v_poll.kind = 'dates' and v_opt.start_date is not null then
    update public.plans set start_date = v_opt.start_date, end_date = coalesce(v_opt.end_date, v_opt.start_date)
    where id = v_plan.id;
  elsif v_poll.kind = 'location' then
    update public.plans set location_name = v_opt.label, address = coalesce(v_opt.address, v_plan.address),
      link = coalesce(v_opt.link, v_plan.link)
    where id = v_plan.id;
  end if;
end $$;
revoke all on function public.decide_poll(uuid, uuid, boolean) from public, anon;
grant execute on function public.decide_poll(uuid, uuid, boolean) to authenticated;

-- ------------------------------------------------------------------ Discussion on a trip
create table if not exists public.plan_comments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null default public.my_player_id() references public.players(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists plan_comments_plan_idx on public.plan_comments (plan_id, created_at);
create index if not exists plan_comments_group_idx on public.plan_comments (group_id);
create index if not exists plan_comments_player_idx on public.plan_comments (player_id);
create trigger aa_fill_group_id before insert or update on public.plan_comments
  for each row execute function private.fill_group_id('plans:plan_id');
alter table public.plan_comments enable row level security;
create policy "members read" on public.plan_comments for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "comment as me" on public.plan_comments for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[]) and player_id = private.my_player_id(group_id));
create policy "delete own comment" on public.plan_comments for delete
  using (player_id = private.my_player_id(group_id) or group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.plan_comments as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.plan_comments from anon;
grant select, insert, delete on public.plan_comments to authenticated;
alter publication supabase_realtime add table public.plan_comments;

-- ------------------------------------------------------------------ Notification choices (per person, per group)
create table if not exists public.notify_prefs (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mode text not null default 'instant' check (mode in ('instant', 'digest', 'important')),
  digest_hour smallint not null default 18 check (digest_hour between 0 and 23),
  tz text not null default 'Australia/Sydney' check (tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists notify_prefs_user_idx on public.notify_prefs (user_id);
create trigger aa_fill_group_id before insert or update on public.notify_prefs
  for each row execute function private.fill_group_id();
alter table public.notify_prefs enable row level security;
create policy "my settings" on public.notify_prefs for select
  using (user_id = (select auth.uid()));
create policy "set mine" on public.notify_prefs for insert
  with check (user_id = (select auth.uid()) and group_id = any ((select private.my_group_ids())::uuid[]));
create policy "change mine" on public.notify_prefs for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and group_id = any ((select private.my_group_ids())::uuid[]));
create policy "same group only" on public.notify_prefs as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.notify_prefs from anon;
grant select, insert, update on public.notify_prefs to authenticated;

-- Messages waiting for someone's daily digest. Only the server reads or writes this (no policies = no access).
create table if not exists public.notify_queue (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  url text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notify_queue_waiting_idx on public.notify_queue (group_id, user_id) where sent_at is null;
create index if not exists notify_queue_user_idx on public.notify_queue (user_id);
alter table public.notify_queue enable row level security;
revoke all on public.notify_queue from anon, authenticated;

-- ------------------------------------------------------------------ Trips start and finish on their own
-- On a trip's first day it becomes the current trip (the old one is closed, and any round still live in it).
-- A week after the last day a locked-in plan is marked Done. Runs just after midnight Sydney time.
create or replace function private.trips_daily()
returns void language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Australia/Sydney')::date; r record;
begin
  for r in
    select t.id, t.group_id from public.trips t
    join public.plans p on p.trip_id = t.id and p.status = 'confirmed'
    where t.status = 'locked' and t.start_date = v_today
  loop
    update public.rounds set status = 'locked'
      where group_id = r.group_id and status = 'live'
        and trip_id in (select id from public.trips where group_id = r.group_id and status = 'active' and id <> r.id);
    update public.trips set status = 'locked' where group_id = r.group_id and status = 'active' and id <> r.id;
    update public.trips set status = 'active' where id = r.id;
  end loop;
  update public.plans set status = 'done'
    where status = 'confirmed' and coalesce(end_date, start_date) < v_today - 7;
end $$;
revoke all on function private.trips_daily() from public, anon, authenticated;

select cron.schedule('lgc-trips-daily', '5 14 * * *', 'select private.trips_daily()');
-- Hourly digest: same call as the daily reminders, with type "digest" (so it points at this project's function).
select cron.schedule('lgc-hourly-digest', '3 * * * *', replace(command, '"type":"daily"', '"type":"digest"'))
from cron.job where jobname = 'lgc-daily-reminders';
