-- 011: strokes taken off an Ambrose team's score for each side comp its player wins.
alter table public.rounds add column comp_bonus int not null default 0;
