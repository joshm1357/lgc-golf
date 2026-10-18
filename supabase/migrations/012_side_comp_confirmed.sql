-- 012: admin can confirm the winner of a side comp (even without a measured distance).
alter table public.side_entries add column confirmed boolean not null default false;
