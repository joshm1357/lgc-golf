-- 060 — Feature switches for the second overnight wave (21 Oct 2026). Additive. Each feature's tables come in its
-- own migration (061 governance, 062 stats, 063 trip finder, 064 trip extras, 065 AI helper v2).
insert into public.feature_catalogue (key, default_on, parent, tier) values ('rule_challenges', true, 'tribunal', 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('other_cases', true, 'tribunal', 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('committees', false, 'tribunal', 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('stats', true, null, 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('trip_finder', false, 'planner', 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('weather', true, 'planner', 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('dinner_awards', false, null, 'free') on conflict (key) do nothing;
-- The AI helper is core (on by default) — 053 already says so for a fresh database; this covers one where 053 ran first.
update public.feature_catalogue set default_on = true where key = 'ai_helper';
