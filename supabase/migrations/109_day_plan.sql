-- 109 — The day plan: a note on one day of a trip (ov40, Josh 25 Oct 2026).
-- RUNS AFTER 108 (ov39's trip ideas / plan_wishes; nothing here touches it). Not applied to any Supabase project yet.
--
-- Josh: "people can input like 'it would be great to have the morning free on the Sat to chill, then midday play'.
-- They could comment on that day." The trip's chat (plan_comments, 025) already does comments with the right access
-- rules, so a day note is a plan_comments row with a day on it — no new table.
--
-- ADDITIVE ONLY. Nothing is dropped or renamed; no check is dropped or re-added. No policy changes: the existing
-- "members read" / "comment as me" / "delete own comment" / "same group only" rules on plan_comments cover day notes.
--   * plan_comments.day_date (date, nullable): the trip day the note is about. Null = the trip's chat, as before.
--   * plan_comments.day_pref (text, nullable): an optional simple wish for that day — morning_free | early | midday |
--     late | home_by (the same words as plan_wishes.day_prefs in 108, plus home_by).
--   * plan_comments.home_by (text 'HH:MM', nullable): with day_pref = 'home_by'.
--   * A wish needs a day (a chat message can't carry one), and home_by only goes with day_pref = 'home_by'.
-- Old app versions: they don't send the new columns (null — a normal chat message) and they show day notes in the
-- trip's chat as plain messages, which reads fine ("Keep Saturday morning free, play midday").
-- What the organiser picks per day (a course and a time window, "about") lives in trip_builds.state.dayPlan — the
-- builder's own saved state, organisers / co-organisers only (077 / 104) — so nothing else is needed here.

alter table public.plan_comments add column if not exists day_date date;
alter table public.plan_comments add column if not exists day_pref text;
alter table public.plan_comments add column if not exists home_by text;

do $$ begin
  alter table public.plan_comments add constraint plan_comments_day_pref_check
    check (day_pref is null or day_pref in ('morning_free', 'early', 'midday', 'late', 'home_by'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_comments add constraint plan_comments_home_by_check
    check (home_by is null or (home_by ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and day_pref = 'home_by'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_comments add constraint plan_comments_day_wish_check
    check (day_pref is null or day_date is not null);
exception when duplicate_object then null; end $$;
-- A day can't be years away from today (stops typos like 2207).
do $$ begin
  alter table public.plan_comments add constraint plan_comments_day_date_check
    check (day_date is null or day_date between date '2020-01-01' and date '2100-01-01');
exception when duplicate_object then null; end $$;

create index if not exists plan_comments_day_idx on public.plan_comments (plan_id, day_date) where day_date is not null;
