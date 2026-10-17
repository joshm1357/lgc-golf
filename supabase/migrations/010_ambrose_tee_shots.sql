-- 010: Ambrose — whose drive was used on each hole, plus per-round rules.
alter table public.scores add column tee_shot_player uuid references public.players(id) on delete set null;
alter table public.rounds add column min_drives int;
alter table public.rounds add column rules text;
