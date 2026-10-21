-- 050 — Team match play, Ryder Cup style (21 Oct 2026). Additive only: new tables, new columns, new functions;
-- invite_info and join_by_invite (049) learn team links. Behind the feature switch 'cup' (off by default).
--
-- How it fits together:
--  * A group has two sides (cup_sides), e.g. "Team Blue" and "Team Gold". A player is on one side (players.cup_side).
--  * Each side has its own invite link (team_invites). Opening it joins the group as a player on that side, approved
--    straight away (the organiser vouched for everyone by sending the link).
--  * Matches (cup_matches) belong to a round (for the day and the course's stroke index). Each match is Ambrose pairs
--    or singles, with one or two players a side, a match handicap per side, and points (e.g. 2 for a pairs match).
--  * Anyone in the group records hole results ('a', 'b' or 'h' for halved) through set_cup_hole. Only organisers
--    create, change or delete matches and sides. The app works out "2 UP thru 7", "won 3&2" and the points.

insert into public.feature_catalogue (key, default_on, parent, tier) values ('cup', false, null, 'free')
on conflict (key) do nothing;

-- ------------------------------------------------------------------ Sides
create table if not exists public.cup_sides (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 30),
  colour text not null default '#1F4B9E' check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  sort smallint not null check (sort in (1, 2)),
  created_at timestamptz not null default now(),
  unique (group_id, sort)
);
alter table public.cup_sides enable row level security;
create policy "members read" on public.cup_sides for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.cup_sides for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.cup_sides as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: cup (add)" on public.cup_sides as restrictive for insert with check (public.feature_on(group_id, 'cup'));
create policy "feature on: cup (change)" on public.cup_sides as restrictive for update using (public.feature_on(group_id, 'cup')) with check (public.feature_on(group_id, 'cup'));
revoke all on public.cup_sides from anon;
grant select, insert, update, delete on public.cup_sides to authenticated;
create trigger aa_fill_group_id before insert or update on public.cup_sides
  for each row execute function private.fill_group_id();

-- A player's side. Only an organiser (or the server, e.g. a team link) changes it.
alter table public.players add column if not exists cup_side uuid references public.cup_sides(id) on delete set null;
create index if not exists players_cup_side_idx on public.players (cup_side);
create or replace function private.players_cup_side_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.cup_side is distinct from old.cup_side
     and coalesce(nullif(current_setting('role', true), 'none'), 'postgres') in ('authenticated', 'anon')
     and coalesce(current_setting('lgc.cup_side', true), '') <> 'on'
     and not private.is_group_organiser(new.group_id) then
    new.cup_side := old.cup_side;
  end if;
  if new.cup_side is not null and not exists (select 1 from public.cup_sides s where s.id = new.cup_side and s.group_id = new.group_id) then
    raise exception 'That team belongs to another group';
  end if;
  return new;
end $$;
revoke all on function private.players_cup_side_guard() from public, anon, authenticated;
create or replace trigger ad_players_cup_side before insert or update on public.players
  for each row execute function private.players_cup_side_guard();

-- ------------------------------------------------------------------ Team links
create table if not exists public.team_invites (
  token text primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  cup_side uuid not null references public.cup_sides(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists team_invites_live_idx on public.team_invites (cup_side) where revoked_at is null;
create index if not exists team_invites_group_idx on public.team_invites (group_id);
create index if not exists team_invites_created_by_idx on public.team_invites (created_by);
alter table public.team_invites enable row level security;   -- only the functions below touch it
revoke all on public.team_invites from anon, authenticated;

-- Which side someone joined through, so the player they set up (or pick) lands on that side.
alter table public.group_members add column if not exists cup_side uuid references public.cup_sides(id) on delete set null;
create index if not exists group_members_cup_side_idx on public.group_members (cup_side);

-- The link for a side (made the first time it's asked for); p_new makes a fresh one and stops the old one.
create or replace function public.team_invite(p_side uuid, p_new boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.cup_sides%rowtype; v_token text;
begin
  select * into s from public.cup_sides where id = p_side;
  if s.id is null then raise exception 'No such team'; end if;
  if auth.uid() is not null and not (private.is_group_organiser(s.group_id) or private.is_platform_admin()) then
    raise exception 'Only an organiser can make team links';
  end if;
  if p_new then update public.team_invites set revoked_at = now() where cup_side = p_side and revoked_at is null; end if;
  select token into v_token from public.team_invites where cup_side = p_side and revoked_at is null;
  if v_token is null then
    loop
      v_token := private.random_code(12);
      exit when not exists (select 1 from public.team_invites where token = v_token)
            and not exists (select 1 from public.group_invites where token = v_token)
            and not exists (select 1 from public.organiser_invites where token = v_token)
            and not exists (select 1 from public.player_links where token = v_token);
    end loop;
    insert into public.team_invites (token, group_id, cup_side) values (v_token, s.group_id, p_side);
  end if;
  return v_token;
end $$;
revoke all on function public.team_invite(uuid, boolean) from public, anon;
grant execute on function public.team_invite(uuid, boolean) to authenticated;

-- A player set up (or picked) by someone who joined through a team link: on that side, and approved.
create or replace function private.cup_side_from_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_side uuid;
begin
  if tg_table_name = 'players' then
    select cup_side into v_side from public.group_members
     where group_id = new.group_id and user_id = auth.uid() and cup_side is not null and role <> 'organiser';
    if v_side is not null then
      new.approved := true;
      if new.cup_side is null then new.cup_side := v_side; end if;
    end if;
    return new;
  end if;
  -- group_members: a name picked (or set up) after joining through a team link.
  if new.cup_side is not null and new.player_id is not null
     and (tg_op = 'INSERT' or new.player_id is distinct from old.player_id) then
    perform set_config('lgc.cup_side', 'on', true);
    update public.players set cup_side = new.cup_side, approved = true
     where id = new.player_id and group_id = new.group_id and cup_side is null;
    perform set_config('lgc.cup_side', '', true);
  end if;
  return new;
end $$;
revoke all on function private.cup_side_from_link() from public, anon, authenticated;
create or replace trigger ab_players_cup_side_from_link before insert on public.players
  for each row execute function private.cup_side_from_link();
create or replace trigger cup_side_from_link after insert or update of player_id on public.group_members
  for each row execute function private.cup_side_from_link();

-- The approval guard (022) stops anyone but an organiser approving: the team link's approval is the server's.
create or replace function public.players_approval_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approved is distinct from old.approved and not private.is_group_organiser(new.group_id)
     and coalesce(current_setting('lgc.cup_side', true), '') <> 'on' then
    raise exception 'Only the admin can approve players';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ Links: invite_info and join_by_invite (049 + team links)
create or replace function public.invite_info(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare v json; o public.organiser_invites%rowtype; t public.team_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select * into o from public.organiser_invites where token = upper(trim(p_token));
  if o.token is not null then
    if o.used_by is distinct from auth.uid() and (o.used_at is not null or o.expires_at <= now()) then
      return null;
    end if;
    select json_build_object('group_id', g.id, 'group_name', g.name, 'role', 'organiser',
             'already_in', exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid() and m.role = 'organiser'),
             'look', json_build_object('short_name', g.short_name, 'crest_url', g.crest_url, 'primary', g.colour_primary,
                                       'accent', g.colour_accent, 'font', g.font, 'name', g.name))
      into v from public.groups g where g.id = o.group_id;
    return v;
  end if;
  select * into t from public.team_invites where token = upper(trim(p_token)) and revoked_at is null;
  if t.token is not null then
    select json_build_object('group_id', g.id, 'group_name', g.name, 'role', 'player', 'team', s.name, 'team_colour', s.colour,
             'already_in', exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid()),
             'look', json_build_object('short_name', g.short_name, 'crest_url', g.crest_url, 'primary', g.colour_primary,
                                       'accent', g.colour_accent, 'font', g.font, 'name', g.name))
      into v from public.groups g join public.cup_sides s on s.id = t.cup_side where g.id = t.group_id;
    return v;
  end if;
  select json_build_object('group_id', g.id, 'group_name', g.name, 'role', i.role,
           'already_in', exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid()),
           'look', json_build_object('short_name', g.short_name, 'crest_url', g.crest_url, 'primary', g.colour_primary,
                                     'accent', g.colour_accent, 'font', g.font, 'name', g.name))
    into v
  from public.group_invites i join public.groups g on g.id = i.group_id
  where i.token = upper(trim(p_token)) and i.revoked_at is null;
  if v is null then perform private.pin_fail('invite'); end if;
  return v;
end $$;

create or replace function public.join_by_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid; v_role text; o public.organiser_invites%rowtype; t public.team_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select * into o from public.organiser_invites where token = upper(trim(p_token)) for update;
  if o.token is not null then
    if o.used_by = auth.uid() then return o.group_id; end if;
    if o.used_at is not null or o.expires_at <= now() then return null; end if;
    insert into public.group_members (group_id, user_id, role) values (o.group_id, auth.uid(), 'organiser')
    on conflict (group_id, user_id) do update set role = 'organiser';
    update public.organiser_invites set used_at = now(), used_by = auth.uid() where token = o.token;
    return o.group_id;
  end if;
  select * into t from public.team_invites where token = upper(trim(p_token)) and revoked_at is null;
  if t.token is not null then
    insert into public.group_members (group_id, user_id, role, cup_side) values (t.group_id, auth.uid(), 'player', t.cup_side)
    on conflict (group_id, user_id) do update set cup_side = coalesce(public.group_members.cup_side, excluded.cup_side);
    return t.group_id;
  end if;
  select group_id, role into v_g, v_role from public.group_invites where token = upper(trim(p_token)) and revoked_at is null;
  if v_g is null then perform private.pin_fail('invite'); return null; end if;
  insert into public.group_members (group_id, user_id, role) values (v_g, auth.uid(), v_role) on conflict do nothing;
  return v_g;
end $$;
revoke all on function public.invite_info(text), public.join_by_invite(text) from public, anon;
grant execute on function public.invite_info(text), public.join_by_invite(text) to authenticated;

-- ------------------------------------------------------------------ Matches
create table if not exists public.cup_matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  sort smallint not null default 0,
  format text not null default 'singles' check (format in ('singles', 'ambrose')),
  a_players uuid[] not null default '{}' check (cardinality(a_players) between 1 and 4),
  b_players uuid[] not null default '{}' check (cardinality(b_players) between 1 and 4),
  a_hcp numeric not null default 0 check (a_hcp between -10 and 54),
  b_hcp numeric not null default 0 check (b_hcp between -10 and 54),
  points numeric not null default 1 check (points > 0 and points <= 10),
  holes jsonb not null default '{}'::jsonb,   -- { "1": "a" | "b" | "h", ... }
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists cup_matches_round_idx on public.cup_matches (round_id, sort);
create index if not exists cup_matches_group_idx on public.cup_matches (group_id);
alter table public.cup_matches enable row level security;
create policy "members read" on public.cup_matches for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers change" on public.cup_matches for all
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.cup_matches as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: cup (add)" on public.cup_matches as restrictive for insert with check (public.feature_on(group_id, 'cup'));
create policy "feature on: cup (change)" on public.cup_matches as restrictive for update using (public.feature_on(group_id, 'cup')) with check (public.feature_on(group_id, 'cup'));
revoke all on public.cup_matches from anon;
grant select, insert, update, delete on public.cup_matches to authenticated;
create trigger aa_fill_group_id before insert or update on public.cup_matches
  for each row execute function private.fill_group_id('rounds:round_id');

-- Every player in a match is in the group, and nobody plays on both sides.
create or replace function private.cup_match_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.a_players || new.b_players) p
             where not exists (select 1 from public.players x where x.id = p and x.group_id = new.group_id)) then
    raise exception 'A player in that match isn''t in this group';
  end if;
  if new.a_players && new.b_players then raise exception 'Someone is on both sides of that match'; end if;
  if jsonb_typeof(new.holes) <> 'object'
     or exists (select 1 from jsonb_each_text(new.holes) h where h.key !~ '^([1-9]|1[0-8])$' or h.value not in ('a', 'b', 'h')) then
    raise exception 'Hole results are a, b or h for holes 1 to 18';
  end if;
  return new;
end $$;
revoke all on function private.cup_match_check() from public, anon, authenticated;
create or replace trigger ab_cup_match_check before insert or update on public.cup_matches
  for each row execute function private.cup_match_check();

-- Anyone in the group records a hole: 'a', 'b', 'h' (halved) or null to clear it.
create or replace function public.set_cup_hole(p_match uuid, p_hole int, p_result text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.cup_matches%rowtype;
begin
  select * into m from public.cup_matches where id = p_match for update;
  if m.id is null or not private.is_group_member(m.group_id) then raise exception 'Match not found'; end if;
  perform private.require_feature(m.group_id, 'cup');
  if p_hole is null or p_hole not between 1 and 18 then raise exception 'Hole 1 to 18'; end if;
  if p_result is not null and p_result not in ('a', 'b', 'h') then raise exception 'Pick a side or halved'; end if;
  update public.cup_matches
     set holes = case when p_result is null then holes - p_hole::text else holes || jsonb_build_object(p_hole::text, p_result) end,
         updated_at = now()
   where id = p_match
  returning holes into m.holes;
  return m.holes;
end $$;
revoke all on function public.set_cup_hole(uuid, int, text) from public, anon;
grant execute on function public.set_cup_hole(uuid, int, text) to authenticated;

alter publication supabase_realtime add table public.cup_matches, public.cup_sides;
select private.add_same_group_checks();
