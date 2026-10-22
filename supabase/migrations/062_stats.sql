-- 062 — Player stats and the season ladder (21 Oct 2026). Additive only. Feature 'stats' (060, on by default).
-- Every stat is worked out in the app from what's already stored (rounds, scores, round_players, teams, honour_board,
-- handicap_history, trips) — see src/lib/stats.js and src/lib/ladder.js. The only thing stored here is how the
-- group runs its season ladder (order of merit):
--   * mode 'year' (a calendar year — the default) or 'range' (a custom start and end date, e.g. a winter season);
--   * points for 1st, 2nd, 3rd… in each individual round (default 10-8-6-5-4-3-2-1; ties share the points);
--   * bonus points for each trophy won in the season (default 5).
-- One row per group. Everyone in the group reads it; organisers change it. Refused while the feature is switched off
-- (reads stay allowed so nothing is lost). No row = the defaults.

create table if not exists public.season_settings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null unique references public.groups(id) on delete cascade,
  name text check (name is null or length(btrim(name)) between 2 and 40),
  mode text not null default 'year' check (mode in ('year', 'range')),
  start_date date,
  end_date date,
  points jsonb not null default '[10, 8, 6, 5, 4, 3, 2, 1]'::jsonb,
  trophy_bonus int not null default 5 check (trophy_bonus between 0 and 100),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (mode = 'year' or (start_date is not null and end_date is not null and end_date >= start_date
                           and end_date - start_date <= 1100))
);

-- Points: a list of 1 to 30 whole numbers from 0 to 100, e.g. [10, 8, 6, 5, 4, 3, 2, 1].
create or replace function private.season_settings_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(new.points) <> 'array' or jsonb_array_length(new.points) not between 1 and 30 then
    raise exception 'Give points for 1 to 30 places';
  end if;
  if exists (select 1 from jsonb_array_elements(new.points) p
             where jsonb_typeof(p) <> 'number' or (p #>> '{}')::numeric not between 0 and 100
                or (p #>> '{}')::numeric <> trunc((p #>> '{}')::numeric)) then
    raise exception 'Points are whole numbers from 0 to 100';
  end if;
  new.name := nullif(btrim(new.name), '');
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  return new;
end $$;
revoke all on function private.season_settings_check() from public, anon, authenticated;

alter table public.season_settings enable row level security;
create policy "members read" on public.season_settings for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.season_settings for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.season_settings as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: stats (add)" on public.season_settings as restrictive for insert with check (public.feature_on(group_id, 'stats'));
create policy "feature on: stats (change)" on public.season_settings as restrictive for update using (public.feature_on(group_id, 'stats')) with check (public.feature_on(group_id, 'stats'));
create policy "feature on: stats (remove)" on public.season_settings as restrictive for delete using (public.feature_on(group_id, 'stats'));
revoke all on public.season_settings from anon;
grant select, insert, update, delete on public.season_settings to authenticated;
create trigger aa_fill_group_id before insert or update on public.season_settings
  for each row execute function private.fill_group_id();
create trigger ac_season_settings_check before insert or update on public.season_settings
  for each row execute function private.season_settings_check();

alter publication supabase_realtime add table public.season_settings;
select private.add_same_group_checks();
