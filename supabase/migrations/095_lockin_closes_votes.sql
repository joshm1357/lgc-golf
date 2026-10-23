-- 095 — Votes and the organiser's planning, from Josh's walkthrough review (ov26, 23 Oct 2026). ADDITIVE ONLY: two new
-- functions and two new triggers. No tables, no columns, nothing dropped or renamed; old app versions keep working
-- (and get the fixes too, because the database does them).
-- Needs 077 (plan_polls.vote_batch), 078 (plan_polls.purpose, plan_items.stage / formula_key) and 092 (plan_polls.optional).
--
--  * V1 — LOCKING IN CLOSES THE PLANNING VOTES. All four reviewers found "VOTE NOW: Which weekend?" under "Locked in ·
--    Nowra" the most confusing thing in the app. When a trip goes from planning to locked in (status 'planning' →
--    'confirmed'), every open vote about where and when closes: dates and place votes, where-to-stay votes, anything on
--    a trip builder vote card (areas, weekends, how long, courses, "Which trip?"), and the optional detail under an area.
--    Votes on anything else ("Anything else" votes the organiser called by hand) stay open. A vote closed this way has
--    no winner of its own; the app shows it as one line, "Decided: Fri 22 – Mon 25 Jan, Nowra".
--    It's a trigger, so every way of locking in does it: Lock it in, the Next step's Lock it in, "Set it up in the app",
--    "Lock in who's coming", an old phone, the connector.
--  * O7 — JOBS MOVE WITH THE DATES. When a trip's start date changes, its usual jobs (the job formula's, not done yet)
--    move by the same number of days, never past the start of the trip and never into the past (today in Sydney, or the
--    start if that's sooner). "Chase deposits" counts from when the deposit was asked for, so it only gets pulled back
--    to the start if it was after it. Jobs people added themselves are left alone.
--
-- Security: both functions are SECURITY DEFINER with an empty search_path, run only from their triggers (no one can call
-- them), and only ever touch rows of the plan being updated — which the person updating it was already allowed to update.

-- =================================================================================================== V1
create or replace function private.lockin_close_votes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.plan_polls
     set status = 'closed'
   where plan_id = new.id
     and status = 'open'
     and (kind in ('dates', 'location') or purpose = 'stay' or vote_batch is not null or coalesce(optional, false));
  return null;
end $$;
revoke all on function private.lockin_close_votes() from public, anon, authenticated;

create or replace trigger zz_lockin_close_votes after update of status on public.plans
  for each row when (old.status = 'planning' and new.status = 'confirmed')
  execute function private.lockin_close_votes();

-- =================================================================================================== O7
create or replace function private.redate_trip_jobs()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_shift int := new.start_date - old.start_date;
  v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  update public.plan_items i
     set due = case
           when i.due + v_shift > new.start_date then new.start_date
           when i.due + v_shift < v_today then least(v_today, new.start_date)
           else i.due + v_shift
         end
   where i.plan_id = new.id
     and i.kind = 'job'
     and i.formula_key is not null
     and i.formula_key <> 'chase_deposits'
     and i.due is not null
     and i.stage <> 'done' and not i.done;
  update public.plan_items i
     set due = new.start_date
   where i.plan_id = new.id
     and i.kind = 'job'
     and i.formula_key = 'chase_deposits'
     and i.due > new.start_date
     and i.stage <> 'done' and not i.done;
  return null;
end $$;
revoke all on function private.redate_trip_jobs() from public, anon, authenticated;

create or replace trigger zz_redate_trip_jobs after update of start_date on public.plans
  for each row when (old.start_date is not null and new.start_date is not null and old.start_date is distinct from new.start_date)
  execute function private.redate_trip_jobs();
