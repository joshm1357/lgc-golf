-- 043 — Stage 11: premium planning, ready but off. Additive. Every group is 'free' and every feature is 'free', so
-- nothing changes for anyone. No payments.
-- Also: Josh's numbers count group booking enquiries and booking-link taps.

alter table public.groups add column if not exists group_plan text not null default 'free';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'groups_group_plan_check') then
    alter table public.groups add constraint groups_group_plan_check check (group_plan in ('free', 'premium'));
  end if;
end $$;

-- Only Josh (or the database itself) can change a group's plan — never an organiser through the app.
create or replace function private.guard_group_plan() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.group_plan is distinct from old.group_plan and current_user in ('authenticated', 'anon') and not private.is_platform_admin() then
    raise exception 'Only Josh can change a group''s plan';
  end if;
  return new;
end $$;
create or replace trigger ab_groups_plan_guard before update on public.groups
  for each row execute function private.guard_group_plan();

-- The tier check feature_on already calls: a 'free' feature is on for everyone; a 'premium' one only for premium groups.
create or replace function private.tier_allows(p_group uuid, p_tier text)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(p_tier, 'free') = 'free'
      or (p_tier = 'premium' and coalesce((select group_plan from public.groups where id = p_group), 'free') = 'premium');
$$;

-- Josh sets a group's plan (for later; nobody pays for anything yet).
create or replace function public.admin_set_group_plan(p_group uuid, p_plan text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Only Josh can do that'; end if;
  if p_plan not in ('free', 'premium') then raise exception 'Plan is free or premium'; end if;
  update public.groups set group_plan = p_plan where id = p_group;
end $$;
revoke all on function public.admin_set_group_plan(uuid, text) from public, anon;
grant execute on function public.admin_set_group_plan(uuid, text) to authenticated;

-- Josh's numbers: plus enquiries and booking-link taps.
create or replace function public.admin_booking_numbers(p_days int default 90)
returns json language sql stable security definer set search_path = '' as $$
  with since as (select now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 3650)) as t)
  select json_build_object(
    'enquiries', (select coalesce(json_agg(x order by x.n desc), '[]'::json) from
                   (select c.name, c.ref, count(*) as n from public.booking_enquiries e join public.clubs c on c.id = e.club_id
                    where e.created_at > (select t from since) group by c.name, c.ref) x),
    'link_taps', (select coalesce(json_object_agg(kind, n), '{}'::json) from
                   (select kind, count(*) n from public.booking_clicks where created_at > (select t from since) group by kind) y))
  where private.is_platform_admin();
$$;
revoke all on function public.admin_booking_numbers(int) from public, anon;
grant execute on function public.admin_booking_numbers(int) to authenticated;
