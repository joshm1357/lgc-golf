-- 092 — Votes with optional detail (ov23, 23 Oct 2026). ADDITIVE ONLY: two new columns on plan_polls. Nothing is
-- dropped or renamed; old app versions keep working (they just show the detail questions like any other question).
--
-- Josh: "You can choose how deep, but the people voting can also just choose to vote area and weekends, or also go
-- into the detail." A start vote with 2+ areas can carry, under each area, its courses and places to stay. Those
-- questions are OPTIONAL: a voter who answers the area and the weekends has answered; the detail is a bonus, and
-- nobody is nudged for skipping it.
--   * optional — true for the detail questions (the app and the reminders skip them when working out who's still to
--     answer).
--   * area     — which area the detail belongs to ("Hunter Valley"), so the ballot groups it under that area.

alter table public.plan_polls add column if not exists optional boolean not null default false;
alter table public.plan_polls add column if not exists area text check (area is null or length(area) <= 80);

comment on column public.plan_polls.optional is 'ov23: an optional detail question (an area''s courses / places to stay). Skipping it still counts as answered.';
comment on column public.plan_polls.area is 'ov23: the area an optional detail question belongs to (groups it on the ballot).';
