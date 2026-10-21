-- 052 — Stroke play and 4BBB rounds (21 Oct 2026). Additive: a round's format can now be 'stroke' or 'fourball' as
-- well as 'ambrose' and 'stableford'. 4BBB (four-ball better ball Stableford) uses teams of two (teams/team_players)
-- with each player's own score (scores.subject_type 'player'); the better points on each hole count. Stroke play is individual (round_players, like Stableford) and ranked on net to par; the maths is
-- in the app (src/lib/scoring.js strokeStatus). A pick-up counts as net double bogey (the usual social rule).
alter table public.rounds drop constraint if exists rounds_format_check;
alter table public.rounds add constraint rounds_format_check check (format in ('ambrose', 'stableford', 'stroke', 'fourball'));
