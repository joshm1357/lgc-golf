-- 026 — fixes from the independent Stage 1b (Trips) review. Additive: one new column, functions replaced.

-- Trips made by lock-in are marked, so an empty one can be tidied away if an old phone links its own trip instead.
alter table public.trips add column if not exists made_by_lock_in boolean not null default false;

create or replace function private.plans_trip_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
-- The server (edge functions with the service key, the scheduler, migrations) is trusted; people signed in to the
-- app aren't. The request's role (set by the API for every call, and kept inside security-definer functions) says which.
declare v_trusted boolean := coalesce(nullif(current_setting('role', true), 'none'), 'postgres') not in ('authenticated', 'anon');
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

  -- Lock-in makes the trip — only when the plan has never had one (a deleted trip doesn't come back by itself).
  if new.status = 'confirmed' and new.trip_id is null and new.start_date is not null and not new.proposed
     and (tg_op = 'INSERT' or old.trip_id is null) then
    insert into public.trips (name, start_date, end_date, status, group_id, made_by_lock_in)
    values (new.name, new.start_date, coalesce(new.end_date, new.start_date), 'locked', new.group_id, true)
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

-- An old phone's "Set it up in the app" makes its own trip and links it: tidy away the empty one lock-in made.
-- Runs after the plan has moved to the new trip (doing it during the change clashes with the trip link's
-- "set to empty on delete").
create or replace function private.plans_tidy_old_trip()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.trips t
  where t.id = old.trip_id and t.made_by_lock_in
    and not exists (select 1 from public.rounds r where r.trip_id = t.id)
    and not exists (select 1 from public.trophies x where x.trip_id = t.id)
    and not exists (select 1 from public.posts p where p.trip_id = t.id)
    and not exists (select 1 from public.plans p where p.trip_id = t.id);
  return null;
end $$;
revoke all on function private.plans_tidy_old_trip() from public, anon, authenticated;
create or replace trigger plans_tidy_old_trip after update of trip_id on public.plans
  for each row when (old.trip_id is not null and new.trip_id is not null and new.trip_id is distinct from old.trip_id)
  execute function private.plans_tidy_old_trip();

-- Trips start on their own — but never in the middle of another trip that's on, and a missed day is caught up.
create or replace function private.trips_daily()
returns void language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Australia/Sydney')::date; r record;
begin
  for r in
    select t.id, t.group_id from public.trips t
    join public.plans p on p.trip_id = t.id and p.status = 'confirmed'
    where t.status = 'locked' and t.start_date <= v_today and coalesce(t.end_date, t.start_date) >= v_today
    order by t.start_date
  loop
    -- Another trip that's on right now (its dates cover today) stays the current one; e.g. a one-day round
    -- inside a long weekend doesn't take over.
    continue when exists (
      select 1 from public.trips c
      where c.group_id = r.group_id and c.status = 'active' and c.id <> r.id
        and c.start_date is not null and c.start_date <= v_today and coalesce(c.end_date, c.start_date) >= v_today
    );
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

-- The hourly digest job was made from the daily one's text; make sure it really asks for the digest.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'lgc-hourly-digest' and command like '%"type":"digest"%') then
    raise exception 'The hourly digest job is missing or would run the daily reminders — check cron.job';
  end if;
end $$;
