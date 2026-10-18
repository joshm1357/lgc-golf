-- 032b — Stage 5 review fixes. Replaces one function (additive).
--  1. Two taps (or two organisers) at once can't both add a starter: the group is locked while the check and the
--     inserts run.
--  2. The Ambrose starter asks for 4 drives each, not 6 — a team of four on 18 holes can't all have 6 (24 > 18).
--     (The app also never asks for more than the round allows.)
create or replace function public.use_starter_rulebook(p_starter text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); n int;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  perform pg_advisory_xact_lock(hashtext('starter_rulebook:' || v_g::text));
  if exists (select 1 from public.rules where group_id = v_g and status in ('active', 'proposed')) then
    raise exception 'Your Rulebook already has rules — edit them instead';
  end if;
  insert into public.rules (group_id, title, detail, category, applies_to, value, status, proposed_by, decided_at, sort)
  select v_g, r.title, r.detail, r.category, r.applies_to, r.value, 'active', null, now(), r.sort
  from (values
    -- Social Stableford weekend
    ('social_stableford', 'Stableford, full handicap', 'Points from every round of the weekend are added up. Most points wins.', 'format', '{stableford}'::text[], null::text, 1),
    ('social_stableford', 'Pick up when you can''t score', 'No points left on a hole? Pick up and move on — it keeps the group moving.', 'format', '{stableford}', null, 2),
    ('social_stableford', 'Handicaps', 'Each player''s handicap is set by the organiser before the weekend. Changes apply from the next round.', 'handicap', '{all}', null, 3),
    ('social_stableford', 'Ready golf', 'Play when you''re ready, not strictly by honours. Be on the first tee ten minutes early.', 'etiquette', '{all}', null, 4),
    -- Ambrose and Stableford (a trip with both)
    ('ambrose_stableford', 'Stableford counts for the trip trophy', 'Raw Stableford points from every Stableford round on the trip are added up. Most points wins.', 'format', '{stableford}', null, 1),
    ('ambrose_stableford', 'Ambrose net = gross minus team handicap', 'Straight strokes, not Stableford points. Lowest net wins. Ties go to countback.', 'format', '{ambrose}', null, 2),
    ('ambrose_stableford', 'Team handicap', 'For drawn teams: combined handicaps ÷ (2 × team size) — pairs ÷ 4, threes ÷ 6, fours ÷ 8. The organiser can set a team handicap directly instead.', 'handicap', '{ambrose}', null, 3),
    ('ambrose_stableford', 'Minimum drives', 'Every player must have at least 4 of their tee shots used in an 18-hole Ambrose round (fewer on 9 holes — the app works it out).', 'format', '{ambrose}', '4 drives each', 4),
    ('ambrose_stableford', 'Closest to pin', 'On the nominated holes. The organiser confirms the winner; a confirmed call beats any measured distance. (Strokes come off only if side comp bonus strokes are switched on.)', 'side_comp', '{ambrose}', '−2 strokes', 5),
    ('ambrose_stableford', 'Longest drive', 'On the nominated hole. The organiser confirms the winner. (Strokes come off only if side comp bonus strokes are switched on.)', 'side_comp', '{ambrose}', '−2 strokes', 6),
    ('ambrose_stableford', 'Handicap changes', 'Only an organiser — or a Tribunal verdict, if you use the Tribunal — changes a handicap. Every change is logged and applies from the next round.', 'handicap', '{all}', null, 7),
    -- Just scoring
    ('just_scoring', 'The round sets the format', 'Each round is Stableford or Ambrose, as the organiser sets it up. The app does the maths.', 'format', '{all}', null, 1),
    ('just_scoring', 'Handicaps', 'Set by the organiser. Changes apply from the next round.', 'handicap', '{all}', null, 2)
  ) as r(starter, title, detail, category, applies_to, value, sort)
  where r.starter = p_starter;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Unknown starter rulebook'; end if;
  return n;
end $$;
