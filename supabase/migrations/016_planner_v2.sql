-- 016: Planner v2 — review fixes, proposals by anyone, the Rulebook, shared costs with
-- custom splits, payment details and who-pays-who. Additive only: new tables, columns and
-- policies, and tightened (altered in place) policies.

-- ---------- Review fixes ----------
-- (#2) Anyone can claim an unowned job ("I'll do it").
create policy "claim job" on public.plan_items for update to authenticated
  using (kind = 'job' and owner_id is null and public.is_member())
  with check (owner_id = public.my_player_id());

-- (#7, #6) Non-admins can't move items/options to another plan/poll or change who made them.
create or replace function public.plan_rows_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if tg_table_name = 'plan_items' then
    new.plan_id := old.plan_id; new.created_by := old.created_by; new.kind := old.kind;
  elsif tg_table_name = 'plan_options' then
    new.poll_id := old.poll_id; new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger plan_items_guard before update on public.plan_items for each row execute function public.plan_rows_guard();
create trigger plan_options_guard before update on public.plan_options for each row execute function public.plan_rows_guard();
revoke execute on function public.plan_rows_guard() from public, anon, authenticated;

-- (#6) Your own option can only be changed or removed while the vote is open.
alter policy "edit own option" on public.plan_options
  using (public.is_admin() or (created_by = public.my_player_id()
    and exists (select 1 from public.plan_polls p where p.id = poll_id and p.status = 'open')))
  with check (public.is_admin() or created_by = public.my_player_id());
alter policy "remove own option" on public.plan_options
  using (public.is_admin() or (created_by = public.my_player_id()
    and exists (select 1 from public.plan_polls p where p.id = poll_id and p.status = 'open')));

-- (#4) A phone can only be registered to yourself.
alter policy "own subs add" on public.push_subscriptions
  with check (user_id = auth.uid() and player_id = public.my_player_id() and public.is_member());
alter policy "own subs update" on public.push_subscriptions
  using (user_id = auth.uid()) with check (user_id = auth.uid() and player_id = public.my_player_id());

-- (#5) Save this phone for me, taking it over from an old sign-in on the same phone.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() or public.my_player_id() is null then raise exception 'Join the group first'; end if;
  insert into public.push_subscriptions (endpoint, user_id, player_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), public.my_player_id(), p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, player_id = excluded.player_id,
    p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, created_at = now();
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------- Anyone can propose a trip or round ----------
-- A proposal is a plan with proposed = true (status stays 'planning') until the admin approves it.
alter table public.plans add column proposed boolean not null default false;
create policy "propose plan" on public.plans for insert to authenticated
  with check (public.is_member() and proposed and status = 'planning' and created_by = public.my_player_id() and not rsvp_locked);
create policy "edit own proposal" on public.plans for update to authenticated
  using (created_by = public.my_player_id() and proposed)
  with check (created_by = public.my_player_id() and proposed and status = 'planning' and not rsvp_locked);
create policy "withdraw own proposal" on public.plans for delete to authenticated
  using (created_by = public.my_player_id() and proposed);

-- ---------- Shared costs: anyone logs what they paid, custom splits, who-pays-who ----------
alter table public.plan_costs add column split_between uuid[];  -- null = everyone who's in
alter table public.plan_costs add column note text;
alter table public.plan_costs add column created_by uuid references public.players(id) on delete set null default public.my_player_id();
create policy "log my cost" on public.plan_costs for insert to authenticated
  with check (public.is_member() and created_by = public.my_player_id() and paid_by = public.my_player_id());
create policy "edit my cost" on public.plan_costs for update to authenticated
  using (created_by = public.my_player_id())
  with check (created_by = public.my_player_id() and paid_by = public.my_player_id());
create policy "remove my cost" on public.plan_costs for delete to authenticated
  using (created_by = public.my_player_id());

alter table public.players add column pay_details text;  -- e.g. "PayID 04xx xxx xxx" or BSB/account — shown to the group

create table public.plan_transfers (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  from_id uuid not null references public.players(id) on delete cascade,
  to_id uuid references public.players(id) on delete cascade,   -- null = paid into the kitty
  amount numeric(10,2) not null check (amount > 0),
  confirmed boolean not null default false,                      -- the receiver (or admin) ticks it off
  note text,
  created_by uuid references public.players(id) on delete set null default public.my_player_id(),
  created_at timestamptz not null default now()
);
alter table public.plan_transfers enable row level security;
create policy "members read" on public.plan_transfers for select to authenticated using (public.is_member());
create policy "record a payment" on public.plan_transfers for insert to authenticated
  with check (public.is_member() and created_by = public.my_player_id()
    and (public.is_admin() or from_id = public.my_player_id() or to_id = public.my_player_id()));
create policy "confirm a payment" on public.plan_transfers for update to authenticated
  using (public.is_admin() or to_id = public.my_player_id())
  with check (public.is_admin() or to_id = public.my_player_id());
create policy "remove a payment" on public.plan_transfers for delete to authenticated
  using (public.is_admin() or created_by = public.my_player_id() or to_id = public.my_player_id());
create index on public.plan_transfers (plan_id);

-- ---------- The Rulebook ----------
create table public.rules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  detail text,
  category text not null default 'other' check (category in ('format','side_comp','bonus','handicap','etiquette','fines','other')),
  applies_to text[] not null default '{all}',   -- 'all', 'stableford', 'ambrose', 'trip'
  value text,                                    -- e.g. '−2 strokes', '6 drives', '$5'
  status text not null default 'proposed' check (status in ('proposed','active','rejected','retired')),
  proposed_by uuid references public.players(id) on delete set null default public.my_player_id(),
  decided_at timestamptz,
  decision_note text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create table public.rule_votes (
  rule_id uuid not null references public.rules(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  vote text not null check (vote in ('for','against','abstain')),
  comment text,
  updated_at timestamptz not null default now(),
  primary key (rule_id, player_id)
);
alter table public.rules enable row level security;
alter table public.rule_votes enable row level security;
create policy "members read" on public.rules for select to authenticated using (public.is_member());
create policy "members read" on public.rule_votes for select to authenticated using (public.is_member());
create policy "propose a rule" on public.rules for insert to authenticated
  with check (public.is_admin() or (public.is_member() and status = 'proposed' and proposed_by = public.my_player_id()));
create policy "edit rule" on public.rules for update to authenticated
  using (public.is_admin() or (proposed_by = public.my_player_id() and status = 'proposed'))
  with check (public.is_admin() or (proposed_by = public.my_player_id() and status = 'proposed'));
create policy "remove rule" on public.rules for delete to authenticated
  using (public.is_admin() or (proposed_by = public.my_player_id() and status = 'proposed'));
create policy "vote on rule" on public.rule_votes for insert to authenticated
  with check (player_id = public.my_player_id() and exists (select 1 from public.rules r where r.id = rule_id and r.status = 'proposed'));
create policy "change rule vote" on public.rule_votes for update to authenticated
  using (player_id = public.my_player_id())
  with check (player_id = public.my_player_id() and exists (select 1 from public.rules r where r.id = rule_id and r.status = 'proposed'));
create policy "clear rule vote" on public.rule_votes for delete to authenticated
  using (player_id = public.my_player_id() and exists (select 1 from public.rules r where r.id = rule_id and r.status = 'proposed'));

alter publication supabase_realtime add table public.plan_transfers, public.rules, public.rule_votes;

-- The rules as played on the South Coast trip, 2026.
insert into public.rules (title, detail, category, applies_to, value, status, proposed_by, decided_at, sort) values
 ('Stableford counts for the BD', 'Raw Stableford points from every Stableford round on the trip are added up. Most points wins the BD trophy.', 'format', '{stableford}', null, 'active', null, now(), 1),
 ('Ambrose net = gross minus team handicap', 'Straight strokes, not Stableford points. Lowest net wins Putt Buddies. Ties go to countback.', 'format', '{ambrose}', null, 'active', null, now(), 2),
 ('Team handicap', 'For drawn teams: combined handicaps ÷ (2 × team size) — pairs ÷ 4, threes ÷ 6, fours ÷ 8. The admin can set a team handicap directly instead (as for the 2026 Sunday pairs).', 'handicap', '{ambrose}', null, 'active', null, now(), 3),
 ('Minimum drives', 'Every player must have at least 6 of their tee shots used in an Ambrose round.', 'format', '{ambrose}', '6 drives each', 'active', null, now(), 4),
 ('Closest to pin', 'Winner''s team takes strokes off its Ambrose score. The admin confirms the winner; a confirmed call beats any measured distance.', 'side_comp', '{ambrose}', '−2 strokes', 'active', null, now(), 5),
 ('Longest drive', 'On the nominated hole. Winner''s team takes strokes off its Ambrose score. The admin confirms the winner.', 'side_comp', '{ambrose}', '−2 strokes', 'active', null, now(), 6),
 ('Handicap changes go through the Tribunal', 'Only the admin or a Tribunal verdict can change a handicap. Every change is logged. Changes apply from the next round.', 'handicap', '{all}', null, 'active', null, now(), 7);
