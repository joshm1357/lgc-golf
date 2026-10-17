-- 006: trophies awarded by the group (e.g. the Noodle Cup), plus a description per trophy.
alter table public.trophies drop constraint trophies_type_check;
alter table public.trophies add constraint trophies_type_check check (type in ('stableford_total','ambrose','manual'));
alter table public.trophies add column description text;
