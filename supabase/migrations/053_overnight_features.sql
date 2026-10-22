-- 053 — Feature switches for the overnight build (21 Oct 2026). Additive. Each feature's own tables come in its own
-- migration (054 award moments, 055 games, 056 tee groups, 057 connector learning loop, 058 in-jokes, 059 AI helper).
-- Defaults: everything off for existing groups except the round replay (a button on a finished round) and the AI
-- helper (core, to test whether people want it — Josh, 21 Oct; capped per group).
insert into public.feature_catalogue (key, default_on, parent, tier) values ('awards', false, null, 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('games', false, null, 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('tee_groups', false, null, 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('replay', true, null, 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('in_jokes', false, null, 'free') on conflict (key) do nothing;
insert into public.feature_catalogue (key, default_on, parent, tier) values ('ai_helper', true, null, 'free') on conflict (key) do nothing;
