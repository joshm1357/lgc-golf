-- 080 — Planning made clearer (22 Oct 2026, Josh tried the preview). Additive only.
--   * Places to stay are part of the start: an accommodation idea can be tagged with the area it's for
--     (plan_stays.area), so each area option in the trip builder has its own "Where to stay" ideas.
--   * "Call the vote": the organiser ticks which places go on the ballot. put_stays_to_vote gets a version that
--     takes the ticked places (p_only); the two-argument version is unchanged (older app versions keep working).
--   * Tee times over the whole window (available / ranges / capacity / price per course per day), the group's usual
--     social golf times per course (new table course_social_times), and shared accommodation list links.
-- plan_stays keeps its policies (members add, own-or-organiser change, feature 'planner_tasks').

alter table public.plan_stays add column if not exists area text check (area is null or length(btrim(area)) between 1 and 60);

create or replace function public.put_stays_to_vote(p_plan uuid, p_closes_on date, p_only uuid[])
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
  if p_only is not null and coalesce(array_length(p_only, 1), 0) > 30 then raise exception 'Too many places'; end if;
  select count(*) into n from public.plan_stays where plan_id = p_plan and option_id is null and (p_only is null or id = any (p_only));
  if n < 1 then raise exception 'Tick at least one place for the ballot'; end if;
  if p_closes_on is not null and p_closes_on < (now() at time zone 'Australia/Sydney')::date then raise exception 'The closing date has passed'; end if;
  select count(*) into v_keen from public.plan_rsvps where plan_id = p_plan and status in ('in', 'maybe');

  select id into v_poll from public.plan_polls where plan_id = p_plan and purpose = 'stay' and status = 'open' order by created_at desc limit 1;
  if v_poll is null then
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
    v_joined := true;
  end if;

  perform set_config('app.stay_vote', 'on', true);
  for s in select * from public.plan_stays where plan_id = p_plan and option_id is null and (p_only is null or id = any (p_only)) order by created_at loop
    insert into public.plan_options (poll_id, group_id, label, link, cost_pp, notes, created_by)
    values (v_poll, v.group_id, left(s.name, 120), s.link,
            case when s.total_cost is not null and v_keen > 0 then round(s.total_cost / v_keen) end,
            nullif(concat_ws(' · ',
              s.area,
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
revoke all on function public.put_stays_to_vote(uuid, date, uuid[]) from public, anon;
grant execute on function public.put_stays_to_vote(uuid, date, uuid[]) to authenticated;

-- ------------------------------------------------------------------ Tee times: availability over the whole window
-- (Josh, 22 Oct: "update the availability for the trip over the full weekend, as the day shouldn't be confirmed yet
-- early, so then the best times can be selected per day".) Each trip_tee_options row is one course on one date:
-- available yes / no / unknown ("ask again?"), time ranges on offer ("07:30-09:00"), how many players they can hold,
-- price each, plus the slots (times) and note it already had. Same rights as before: organisers, or the caller.
alter table public.trip_tee_options add column if not exists available text check (available is null or available in ('yes', 'no', 'unknown'));
alter table public.trip_tee_options add column if not exists ranges text[] not null default '{}'
  check (cardinality(ranges) <= 8 and array_to_string(ranges, ',') ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9](,|$))*$');
alter table public.trip_tee_options add column if not exists capacity int check (capacity is null or capacity between 1 and 400);
alter table public.trip_tee_options add column if not exists price numeric(8,2) check (price is null or (price >= 0 and price < 10000));

-- ------------------------------------------------------------------ Usual social golf times (the group's course knowledge)
-- "Weekdays after 11, Sat after 2, $65, walk-in groups of 4 OK" — kept for the group so next trip it's already
-- there. Members read; organisers, or whoever's ringing courses, add and change (any member, as themselves — a
-- friends' app); the trip finder switch must be on.
create table if not exists public.course_social_times (
  group_id uuid not null references public.groups(id) on delete cascade,
  course_id uuid not null references public.course_library(id) on delete cascade,
  weekdays text check (weekdays is null or length(weekdays) <= 120),
  weekends text check (weekends is null or length(weekends) <= 120),
  price text check (price is null or length(price) <= 60),
  group_size text check (group_size is null or length(group_size) <= 80),
  notes text check (notes is null or length(notes) <= 300),
  updated_by uuid references public.players(id) on delete set null default public.my_player_id(),
  updated_at timestamptz not null default now(),
  primary key (group_id, course_id)
);
create index if not exists course_social_times_course_idx on public.course_social_times (course_id);
create index if not exists course_social_times_updated_by_idx on public.course_social_times (updated_by);
alter table public.course_social_times enable row level security;
create policy "members read" on public.course_social_times for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "members add" on public.course_social_times for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[]) and updated_by = private.my_player_id(group_id));
create policy "members change" on public.course_social_times for update
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]) and updated_by = private.my_player_id(group_id));
create policy "organisers remove" on public.course_social_times for delete
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.course_social_times as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: trip_finder (add)" on public.course_social_times as restrictive for insert with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (change)" on public.course_social_times as restrictive for update using (public.feature_on(group_id, 'trip_finder')) with check (public.feature_on(group_id, 'trip_finder'));
create policy "feature on: trip_finder (remove)" on public.course_social_times as restrictive for delete using (public.feature_on(group_id, 'trip_finder'));
revoke all on public.course_social_times from anon;
grant select, insert, update, delete on public.course_social_times to authenticated;
create trigger aa_fill_group_id before insert or update on public.course_social_times
  for each row execute function private.fill_group_id();
create trigger ab_touch before update on public.course_social_times for each row execute function private.touch_updated_at();

do $$ begin
  alter publication supabase_realtime add table public.course_social_times;
exception when others then null; end $$;

-- ------------------------------------------------------------------ A shared list (Airbnb wishlist, Stayz board)
-- "Remind people to create a list in Airbnb and then share the list": a plan_stays row can be a whole shortlist link
-- for an area rather than one place. Links only — nothing is fetched from those sites.
alter table public.plan_stays add column if not exists is_list boolean not null default false;

select private.add_same_group_checks();
