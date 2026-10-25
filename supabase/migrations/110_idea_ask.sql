-- 110 — The link preview says what's asked and by when (ov42, Josh 26 Oct 2026).
-- RUNS AFTER 109. Not applied to any Supabase project yet.
--
-- Josh (on the WhatsApp preview of a shared trip idea): "There is an icon but nothing about what is requested. Why not
-- 'Hunter trip vote' or something, 'closes x'." So the preview (and the share picture) now say, by stage:
--   collecting  "💡 <name>: have your say by Thu 6pm"   — <n> of <m> have answered
--   vote        "🗳️ <name>: vote by Thu"               — When? and Where? are open · <n> of <m> voted
--   decided     "✅ It's on: <where>, <dates>"          — <n> in so far
--
-- ADDITIVE ONLY. Nothing is dropped or renamed; no check is dropped or re-added. One new column, two new functions,
-- one new pg_cron job, and idea_preview (108) replaced with the SAME signature (still anyone-callable, still no names:
-- counts only). Old app versions never read the new column.
--
--   * plans.idea_answer_by (timestamptz, nullable): "Have your say by" — set in 📣 Share it (the app's default is 4
--     days from now at 6pm Sydney; the organiser can change it). plans.idea_nudged_at: when the evening-before nudge
--     went out (once per deadline; moving the deadline clears it).
--   * idea_set_answer_by(plan, at): whoever can share the idea (the proposer, organisers — as share_idea). null clears it.
--   * private.idea_answer_tick: the evening before (deadline within 24 h), one buzz to each person in the group who
--     hasn't answered yet (no 4-tap answers and no In / Maybe / Can't). pg_cron 'lgc-idea-answer-nudge', every 15 min.
--   * idea_preview(token): the old fields, plus stage, answer_by, answered, people, group_people, rsvpd, vote_open
--     (['dates','location'] — the open When? / Where?), vote_closes (date), voted, decided_where, decided_start,
--     decided_end, in_count.

alter table public.plans add column if not exists idea_answer_by timestamptz;
alter table public.plans add column if not exists idea_nudged_at timestamptz;

-- ------------------------------------------------------------------ "Have your say by"
create or replace function public.idea_set_answer_by(p_plan uuid, p_at timestamptz) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v public.plans; me uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v from public.plans where id = p_plan for update;
  if v.id is null or not private.is_group_member(v.group_id) then raise exception 'Trip not found'; end if;
  if not v.idea then raise exception 'Only a trip idea has a "have your say by"'; end if;
  if v.status <> 'planning' then raise exception 'This trip isn''t being planned any more'; end if;
  me := private.my_player_id(v.group_id);
  if not (me is not null and me = v.created_by) and not private.idea_can_tidy(v.id) then
    raise exception 'Only whoever proposed it, or an organiser, can set that';
  end if;
  if p_at is not null and (p_at < now() - interval '1 hour' or p_at > now() + interval '90 days') then
    raise exception 'Pick a time in the next few weeks';
  end if;
  update public.plans set idea_answer_by = p_at,
         idea_nudged_at = case when p_at is distinct from v.idea_answer_by then null else idea_nudged_at end
   where id = v.id;
  return p_at;
end $$;
revoke all on function public.idea_set_answer_by(uuid, timestamptz) from public, anon;
grant execute on function public.idea_set_answer_by(uuid, timestamptz) to authenticated;

-- ------------------------------------------------------------------ The evening-before nudge
create or replace function private.idea_answer_tick(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select * from public.plans where idea and status = 'planning' and shared_at is not null and not idea_pool
             and idea_sent_at is null and idea_nudged_at is null and idea_answer_by > p_now
             and idea_answer_by <= p_now + interval '24 hours' loop
    insert into public.notify_queue (group_id, user_id, kind, title, body, url)
    select r.group_id, gm.user_id, 'idea_shared', '💡 ' || left(r.name, 50) || ': have your say',
           'Answers close ' || to_char(r.idea_answer_by at time zone 'Australia/Sydney', 'Dy FMHH12am') || ' — 4 quick taps.', '#/idea/' || r.id
    from public.group_members gm join public.players pl on pl.id = gm.player_id
    where gm.group_id = r.group_id and gm.user_id is not null and gm.role <> 'guest' and pl.approved
      and not exists (select 1 from public.plan_wishes w where w.plan_id = r.id and w.player_id = gm.player_id)
      and not exists (select 1 from public.plan_rsvps x where x.plan_id = r.id and x.player_id = gm.player_id);
    update public.plans set idea_nudged_at = p_now where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.idea_answer_tick(timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'lgc-idea-answer-nudge') then perform cron.unschedule('lgc-idea-answer-nudge'); end if;
    perform cron.schedule('lgc-idea-answer-nudge', '*/15 * * * *', 'select private.idea_answer_tick()');
  end if;
end $$;

-- ------------------------------------------------------------------ The link preview, by stage (counts only, never names)
-- people: the group's approved non-guest players — or, once anyone has said In / Maybe, those people (rsvpd).
-- Decided: locked in (status 'confirmed'), or sent to the vote with nothing left open and a winner called.
create or replace function public.idea_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.plans; gname text;
  n_group int; n_rsvpd int; n_answered int; n_voted int; n_in int;
  open_kinds text[]; closes date; closed_winners int;
  w_where text; w_start date; w_end date; stage text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,40}$' then return null; end if;
  select * into p from public.plans where share_token = p_token and idea and shared_at is not null and status in ('planning', 'confirmed');
  if p.id is null then return null; end if;
  select name into gname from public.groups where id = p.group_id;

  select count(*) into n_group from public.players pl
   where pl.group_id = p.group_id and pl.approved
     and not exists (select 1 from public.group_members gm where gm.player_id = pl.id and gm.role = 'guest');
  select count(*) filter (where status in ('in', 'maybe')), count(*) filter (where status = 'in') into n_rsvpd, n_in
    from public.plan_rsvps where plan_id = p.id;
  select count(*) into n_answered from (
    select player_id from public.plan_wishes where plan_id = p.id
    union select player_id from public.plan_rsvps where plan_id = p.id) a;

  select array_agg(distinct kind order by kind), min(closes_on) into open_kinds, closes
    from public.plan_polls where plan_id = p.id and kind in ('dates', 'location') and status = 'open';
  select count(distinct v.player_id) into n_voted
    from public.plan_votes v join public.plan_polls q on q.id = v.poll_id
   where q.plan_id = p.id and q.kind in ('dates', 'location') and q.status = 'open';
  select count(*) into closed_winners from public.plan_polls
   where plan_id = p.id and kind in ('dates', 'location') and status = 'closed' and winner_option_id is not null;

  stage := case
    when p.status = 'confirmed' then 'decided'
    when open_kinds is not null then 'vote'
    when p.idea_sent_at is not null and closed_winners > 0 then 'decided'
    else 'collecting' end;

  if stage = 'decided' then
    select o.label into w_where from public.plan_polls q join public.plan_options o on o.id = q.winner_option_id
     where q.plan_id = p.id and q.kind = 'location' and q.status = 'closed' order by q.created_at desc limit 1;
    select o.start_date, o.end_date into w_start, w_end from public.plan_polls q join public.plan_options o on o.id = q.winner_option_id
     where q.plan_id = p.id and q.kind = 'dates' and q.status = 'closed' order by q.created_at desc limit 1;
    w_where := coalesce(nullif(btrim(p.location_name), ''), w_where, p.idea_fixed->>'area', p.idea_where);
    if p.start_date is not null then w_start := p.start_date; w_end := p.end_date; end if;
  end if;

  return jsonb_build_object(
    'name', p.name, 'when', p.idea_when, 'fixed', p.idea_fixed, 'where', p.idea_where, 'travel', p.idea_travel, 'card_url', p.card_url,
    'by', private.callout_first(p.created_by), 'group', gname, 'plan_id', p.id,
    'stage', stage, 'answer_by', p.idea_answer_by, 'answered', n_answered,
    'people', case when n_rsvpd > 0 then n_rsvpd else n_group end, 'group_people', n_group, 'rsvpd', n_rsvpd,
    'vote_open', to_jsonb(coalesce(open_kinds, '{}'::text[])), 'vote_closes', closes, 'voted', n_voted,
    'decided_where', w_where, 'decided_start', w_start, 'decided_end', w_end, 'in_count', n_in);
end $$;
revoke all on function public.idea_preview(text) from public;
grant execute on function public.idea_preview(text) to anon, authenticated;
