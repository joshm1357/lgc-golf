-- 110 — Voting on the dates makes you In (Josh, 27 Oct 2026).
-- Josh: "If they voted they are in." The vote for a trip's weekend is the real "who's in" for a group like L.G.C — a
-- Messenger-style poll where you tick the weekends you can do. So a ✓ on any option of a trip's dates question
-- puts you In on that trip, unless you've already answered "Are you in?" yourself (an explicit Maybe / Out stands).
--
-- ADDITIVE ONLY: one function and one trigger on plan_votes. No tables, columns, checks or policies change.
-- Runs as the table owner (security definer) so the RSVP row can be written for the voter, including email votes
-- (which come in through the server with no signed-in user). Only ever inserts the voter's own row.
-- Old app versions: unaffected (they just see the person as In).

create or replace function private.vote_means_in() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_plan uuid; v_kind text; v_plan_kind text;
begin
  if new.response <> 'yes' then return new; end if;
  select po.plan_id, po.kind into v_plan, v_kind from public.plan_polls po where po.id = new.poll_id;
  if v_plan is null or v_kind <> 'dates' then return new; end if;
  select pl.kind into v_plan_kind from public.plans pl where pl.id = v_plan;
  if v_plan_kind is distinct from 'trip' then return new; end if;
  insert into public.plan_rsvps (plan_id, player_id, status, group_id, updated_at, first_in_at)
  values (v_plan, new.player_id, 'in', new.group_id, now(), now())
  on conflict (plan_id, player_id) do nothing;
  return new;
end $$;

drop trigger if exists zz_vote_means_in on public.plan_votes;
create trigger zz_vote_means_in after insert or update of response on public.plan_votes
  for each row execute function private.vote_means_in();
revoke all on function private.vote_means_in() from public, anon, authenticated;
