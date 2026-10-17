-- 002: Tribunal close fix (overruled was null when no chair override) + scores_touch search_path.
-- The corrected function is also folded into 001_core.sql for fresh setups.
alter function public.scores_touch() set search_path = public;
-- (finalise_case body: see 001_core.sql — identical)
