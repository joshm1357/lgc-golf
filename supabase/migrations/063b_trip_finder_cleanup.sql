-- 063b — Trip finder privacy clean-up (Stage 16.1). Additive: one function and one daily job of its own, so the
-- existing daily clean-up (041b) isn't touched. Kept apart from 063 because it removes rows: Josh applies it.
--
-- A trip's starting points (areas and headcounts) are removed 30 days after the trip: after its last day (or the
-- finder's day, if the trip has no dates yet). Starting points on a trip with no date at all go after a year.
-- Players' own home suburbs are theirs to keep or remove on their profile; they aren't touched here.
create or replace function private.trip_finder_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.trip_start_points sp
   using public.plans p
   left join public.trip_finds f on f.plan_id = p.id
   where p.id = sp.plan_id
     and (coalesce(p.end_date, p.start_date, f.day) < (now() at time zone 'Australia/Sydney')::date - 30
          or (coalesce(p.end_date, p.start_date, f.day) is null and sp.created_at < now() - interval '1 year'));
end $$;
revoke all on function private.trip_finder_cleanup() from public, anon, authenticated;

-- About 2:25 am Sydney, just after the main clean-up.
select cron.schedule('lgc-trip-finder-cleanup', '25 15 * * *', 'select private.trip_finder_cleanup()');
