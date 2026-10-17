-- 009: draw room (lobby) before the draw starts.
alter table public.draws drop constraint draws_status_check;
alter table public.draws add constraint draws_status_check check (status in ('lobby','running','done','locked','cancelled'));
