-- 052 — Stroke play rounds (21 Oct 2026). Additive: a round's format can now be 'stroke' as well as 'ambrose' and
-- 'stableford'. Stroke play is individual (round_players, like Stableford) and ranked on net to par; the maths is
-- in the app (src/lib/scoring.js strokeStatus). A pick-up counts as net double bogey (the usual social rule).
alter table public.rounds drop constraint if exists rounds_format_check;
alter table public.rounds add constraint rounds_format_check check (format in ('ambrose', 'stableford', 'stroke'));
