-- 008: The Draw — a live, shared team draw for an Ambrose round.
create table public.draws (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  status text not null default 'running' check (status in ('running','done','locked','cancelled')),
  payload jsonb not null, -- { teams: [{name, players, salary, handicap}], picks: [{player_id, team}], salaries, interval_ms }
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.draws enable row level security;
create policy "members read" on public.draws for select to authenticated using (public.is_member());
create policy "admin insert" on public.draws for insert to authenticated with check (public.is_admin());
create policy "admin update" on public.draws for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete" on public.draws for delete to authenticated using (public.is_admin());
alter publication supabase_realtime add table public.draws;
