-- 018: Today's pin position per hole (for GPS distance to the pin). Anyone in the group can set it
-- while the round is live (stand next to the flag, tap once); the admin any time.
create table public.round_pins (
  round_id uuid not null references public.rounds(id) on delete cascade,
  hole int not null check (hole between 1 and 27),
  lat double precision not null,
  lng double precision not null,
  set_by uuid references public.players(id) on delete set null default public.my_player_id(),
  set_at timestamptz not null default now(),
  primary key (round_id, hole)
);
alter table public.round_pins enable row level security;
create policy "members read" on public.round_pins for select to authenticated using (public.is_member());
create policy "set pin" on public.round_pins for insert to authenticated
  with check (public.is_member() and set_by = public.my_player_id()
    and (public.is_admin() or exists (select 1 from public.rounds r where r.id = round_id and r.status = 'live')));
create policy "move pin" on public.round_pins for update to authenticated
  using (public.is_member() and (public.is_admin() or exists (select 1 from public.rounds r where r.id = round_id and r.status = 'live')))
  with check (public.is_member() and set_by = public.my_player_id());
alter publication supabase_realtime add table public.round_pins;
