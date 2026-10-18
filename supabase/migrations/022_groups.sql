-- 022: Groups — one database, many golf groups. L.G.C becomes group number one.
-- Additive only, and safe for phones still running v1.5:
--   * new tables `groups` and `group_members`; L.G.C copied from `settings` and `members`;
--   * a `group_id` on every data table, filled in for L.G.C, then filled in automatically on every new
--     row from its parent (a score from its round, a post from its round/trip/player…) or, failing
--     that, from the person's current group — so an old app that never sends a group still works;
--   * every access rule now checks the row's own group (members, organisers, "my" player in that group),
--     plus one extra "same group only" rule per table as a second lock;
--   * the old function names (join_group, my_status, is_admin…) keep working, answering for the
--     person's current group: the group the new app names in the x-group-id header, else their first.
-- No DROP statements. The planner's plan_groups / plan_group_members are rooms and cars — not groups.
-- plan_group_members already has a column called group_id (its room/car), so it takes its group
-- through its room/car instead of a column of its own.

-- ---------- Groups ----------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  group_pin text unique,
  admin_pin text,
  legacy boolean not null default false,   -- true only for L.G.C: the group the v1.x app belongs to
  created_at timestamptz not null default now()
);
create unique index groups_one_legacy on public.groups (legacy) where legacy;
insert into public.groups (slug, name, group_pin, admin_pin, legacy)
select 'lgc', group_name, group_pin, admin_pin, true from public.settings where id = 1;

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  role text not null default 'player' check (role in ('organiser', 'player', 'guest')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_id_idx on public.group_members (user_id);
create index group_members_player_id_idx on public.group_members (player_id);
insert into public.group_members (group_id, user_id, player_id, role, created_at)
select (select id from public.groups where legacy), m.user_id, m.player_id,
       case when m.is_admin then 'organiser' else 'player' end, m.created_at
from public.members m;

-- ---------- Helpers (not callable from the app; used by access rules and functions) ----------
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- Every group I'm in / organise. Used as (select private.my_group_ids())::uuid[] so it runs once per query.
create or replace function private.my_group_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(group_id), '{}') from public.group_members where user_id = auth.uid();
$$;
create or replace function private.my_organiser_group_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(group_id), '{}') from public.group_members where user_id = auth.uid() and role = 'organiser';
$$;
create or replace function private.is_group_member(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid());
$$;
create or replace function private.is_group_organiser(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid() and role = 'organiser');
$$;
-- My player in a given group.
create or replace function private.my_player_id(g uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select player_id from public.group_members where group_id = g and user_id = auth.uid();
$$;
-- The group I'm working in: the one the app names (x-group-id header) if I'm in it, else my first.
create or replace function private.current_group() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_hdr text; v_g uuid;
begin
  begin
    v_hdr := current_setting('request.headers', true)::json ->> 'x-group-id';
  exception when others then v_hdr := null;
  end;
  if v_hdr ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select group_id into v_g from public.group_members where user_id = auth.uid() and group_id = v_hdr::uuid;
    if v_g is not null then return v_g; end if;
  end if;
  select group_id into v_g from public.group_members where user_id = auth.uid() order by created_at, group_id limit 1;
  return v_g;
end $$;
create or replace function private.legacy_group() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.groups where legacy;
$$;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------- group_id on every data table ----------
do $$
declare t text;
  lgc uuid := (select id from public.groups where legacy);
begin
  foreach t in array array['players','trips','courses','honour_board','rules','tribunal_cases','tribunal_votes',
    'location_pings','handicap_history','trophies','rounds','teams','team_players','round_players','scores',
    'quick_results','side_entries','round_pins','draws','posts','comments','reactions','plans','plan_polls',
    'plan_options','plan_votes','plan_rsvps','plan_items','plan_costs','plan_payments','plan_groups',
    'plan_transfers','rule_votes']
  loop
    execute format('alter table public.%I add column group_id uuid references public.groups(id)', t);
    -- Fill in L.G.C without firing the table's own triggers (e.g. scores' "last changed" time).
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I set group_id = %L', t, lgc);
    execute format('alter table public.%I enable trigger user', t);
    execute format('alter table public.%I alter column group_id set not null', t);
    execute format('create index %I on public.%I (group_id)', t || '_group_id_idx', t);
  end loop;
end $$;

-- ---------- Fill group_id from the parent row (or the person's current group) ----------
-- Trigger arguments are 'parent_table:column' pairs, tried in order. If a parent is given, its group
-- always wins (a row can never point at another group's round/plan/post); a group sent by the app
-- that disagrees is refused. A row can't be moved to another group afterwards.
create or replace function private.fill_group_id() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_parent uuid; v_id uuid; i int; v_tbl text; v_col text;
begin
  if tg_op = 'UPDATE' and new.group_id is distinct from old.group_id then
    raise exception 'A % row can''t be moved to another group', tg_table_name;
  end if;
  for i in 0 .. coalesce(tg_nargs, 0) - 1 loop
    v_tbl := split_part(tg_argv[i], ':', 1);
    v_col := split_part(tg_argv[i], ':', 2);
    v_id := (to_jsonb(new) ->> v_col)::uuid;
    if v_id is not null then
      execute format('select group_id from public.%I where id = $1', v_tbl) into v_parent using v_id;
      if v_parent is not null then exit; end if;
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    if v_parent is not null and v_parent is distinct from old.group_id then
      raise exception 'That belongs to another group';
    end if;
    return new;
  end if;
  if v_parent is not null then
    if new.group_id is not null and new.group_id <> v_parent then raise exception 'That belongs to another group'; end if;
    new.group_id := v_parent;
  elsif new.group_id is null then
    new.group_id := private.current_group();
  end if;
  if new.group_id is null then raise exception 'Join a group first'; end if;
  return new;
end $$;
revoke all on function private.fill_group_id() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('players', ''), ('trips', ''), ('courses', ''), ('honour_board', ''),
    ('rules', 'players:proposed_by'),
    ('tribunal_cases', 'players:accused_id'), ('tribunal_votes', 'tribunal_cases:case_id'),
    ('location_pings', 'players:player_id'), ('handicap_history', 'players:player_id'),
    ('trophies', 'trips:trip_id'), ('rounds', 'trips:trip_id'),
    ('teams', 'rounds:round_id'), ('team_players', 'teams:team_id'), ('round_players', 'rounds:round_id'),
    ('scores', 'rounds:round_id'), ('quick_results', 'rounds:round_id'), ('side_entries', 'rounds:round_id'),
    ('round_pins', 'rounds:round_id'), ('draws', 'rounds:round_id,plans:plan_id'),
    ('posts', 'rounds:round_id,trips:trip_id,players:player_id'),
    ('comments', 'posts:post_id'), ('reactions', 'posts:post_id'),
    ('plans', 'trips:trip_id'), ('plan_polls', 'plans:plan_id'), ('plan_options', 'plan_polls:poll_id'),
    ('plan_votes', 'plan_polls:poll_id'), ('plan_rsvps', 'plans:plan_id'), ('plan_items', 'plans:plan_id'),
    ('plan_costs', 'plans:plan_id'), ('plan_payments', 'plans:plan_id'), ('plan_groups', 'plans:plan_id'),
    ('plan_transfers', 'plans:plan_id'), ('rule_votes', 'rules:rule_id')
  ) as x(t, parents)
  loop
    execute format('create trigger aa_fill_group_id before insert or update on public.%I for each row execute function private.fill_group_id(%s)',
      r.t, (select coalesce(string_agg(quote_literal(p), ','), '') from unnest(string_to_array(nullif(r.parents, ''), ',')) p));
  end loop;
end $$;

-- ---------- Access rules: every rule checks the row's own group ----------
-- Today's rules say is_member() / is_admin() / my_player_id() — meaning "of the one group". Each is
-- rewritten in place to mean "of THIS row's group", keeping exactly what each rule allows.
do $$
declare p record; v_g text; v_q text; v_c text; v_sql text;
begin
  for p in select pol.tablename, pol.policyname, pol.qual, pol.with_check
           from pg_policies pol
           where pol.schemaname = 'public'
             and pol.tablename not in ('members', 'push_subscriptions', 'groups', 'group_members', 'settings', 'server_secrets', 'notify_log')
  loop
    v_g := case when p.tablename = 'plan_group_members'
      then '(select pg.group_id from public.plan_groups pg where pg.id = plan_group_members.group_id)'
      else format('%I.group_id', p.tablename) end;
    v_q := p.qual; v_c := p.with_check;
    v_q := regexp_replace(v_q, '(public\.)?is_admin\(\)', format('(%s = any ((select private.my_organiser_group_ids())::uuid[]))', v_g), 'g');
    v_q := regexp_replace(v_q, '(public\.)?is_member\(\)', format('(%s = any ((select private.my_group_ids())::uuid[]))', v_g), 'g');
    v_q := regexp_replace(v_q, '(public\.)?my_player_id\(\)', format('private.my_player_id(%s)', v_g), 'g');
    v_c := regexp_replace(v_c, '(public\.)?is_admin\(\)', format('(%s = any ((select private.my_organiser_group_ids())::uuid[]))', v_g), 'g');
    v_c := regexp_replace(v_c, '(public\.)?is_member\(\)', format('(%s = any ((select private.my_group_ids())::uuid[]))', v_g), 'g');
    v_c := regexp_replace(v_c, '(public\.)?my_player_id\(\)', format('private.my_player_id(%s)', v_g), 'g');
    v_sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if v_q is not null then v_sql := v_sql || format(' using (%s)', v_q); end if;
    if v_c is not null then v_sql := v_sql || format(' with check (%s)', v_c); end if;
    if v_q is not null or v_c is not null then execute v_sql; end if;
  end loop;
end $$;

-- Second lock: a restrictive rule per table — whatever else a rule allows, only rows of my groups.
do $$
declare t text;
begin
  foreach t in array array['players','trips','courses','honour_board','rules','tribunal_cases','tribunal_votes',
    'location_pings','handicap_history','trophies','rounds','teams','team_players','round_players','scores',
    'quick_results','side_entries','round_pins','draws','posts','comments','reactions','plans','plan_polls',
    'plan_options','plan_votes','plan_rsvps','plan_items','plan_costs','plan_payments','plan_groups',
    'plan_transfers','rule_votes']
  loop
    execute format('create policy "same group only" on public.%I as restrictive for all to authenticated
      using (%I.group_id = any ((select private.my_group_ids())::uuid[]))
      with check (%I.group_id = any ((select private.my_group_ids())::uuid[]))', t, t, t);
  end loop;
end $$;
create policy "same group only" on public.plan_group_members as restrictive for all to authenticated
  using (exists (select 1 from public.plan_groups pg where pg.id = plan_group_members.group_id
                 and pg.group_id = any ((select private.my_group_ids())::uuid[])))
  with check (exists (select 1 from public.plan_groups pg where pg.id = plan_group_members.group_id
                 and pg.group_id = any ((select private.my_group_ids())::uuid[])));

-- groups: members read their own group's name and slug — never the PINs.
alter table public.groups enable row level security;
revoke all on public.groups from anon, authenticated;
grant select (id, slug, name, legacy, created_at) on public.groups to authenticated;
create policy "my groups" on public.groups for select to authenticated
  using (id = any ((select private.my_group_ids())::uuid[]));
-- group_members: see who's in your groups. Changes only through the functions below.
alter table public.group_members enable row level security;
revoke all on public.group_members from anon;
create policy "my groups' members" on public.group_members for select to authenticated
  using (group_id = any ((select private.my_group_ids())::uuid[]));

-- ---------- The old function names, now per group ----------
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select private.current_group() is not null;
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(private.is_group_organiser(private.current_group()), false);
$$;
create or replace function public.my_player_id() returns uuid
language sql stable security definer set search_path = public as $$
  select private.my_player_id(private.current_group());
$$;
-- Old fields unchanged (is_member, is_admin, player_id, group_name); new: group_id, role, groups.
create or replace function public.my_status() returns json
language sql stable security definer set search_path = public as $$
  with g as (select private.current_group() as id)
  select json_build_object(
    'is_member', (select id from g) is not null,
    'is_admin', coalesce(private.is_group_organiser((select id from g)), false),
    'player_id', private.my_player_id((select id from g)),
    'group_name', (select name from public.groups where id = (select id from g)),
    'group_id', (select id from g),
    'role', (select role from public.group_members where group_id = (select id from g) and user_id = auth.uid()),
    'groups', coalesce((select json_agg(json_build_object('id', gr.id, 'name', gr.name, 'slug', gr.slug, 'role', gm.role) order by gm.created_at)
                        from public.group_members gm join public.groups gr on gr.id = gm.group_id
                        where gm.user_id = auth.uid()), '[]'::json)
  );
$$;

create or replace function public.join_group(p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_g uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into v_g from public.groups where group_pin = trim(p_pin);
  if v_g is null then return false; end if;
  insert into public.group_members (group_id, user_id) values (v_g, auth.uid()) on conflict do nothing;
  return true;
end $$;

create or replace function public.claim_admin(p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_g uuid := private.current_group();
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  if not exists (select 1 from public.groups where id = v_g and admin_pin = trim(p_pin)) then return false; end if;
  update public.group_members set role = 'organiser' where group_id = v_g and user_id = auth.uid();
  return true;
end $$;

create or replace function public.set_pins(p_group_pin text, p_admin_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Admin only'; end if;
  if length(trim(p_group_pin)) < 4 or length(trim(p_admin_pin)) < 4 then
    raise exception 'PINs need at least 4 characters';
  end if;
  if exists (select 1 from public.groups where group_pin = trim(p_group_pin) and id <> v_g) then
    raise exception 'That group PIN is taken — pick another';
  end if;
  update public.groups set group_pin = trim(p_group_pin), admin_pin = trim(p_admin_pin) where id = v_g;
  -- Keep the old settings row in step for L.G.C (only used if v1.5 functions are ever restored).
  if (select legacy from public.groups where id = v_g) then
    update public.settings set group_pin = trim(p_group_pin), admin_pin = trim(p_admin_pin) where id = 1;
  end if;
end $$;

create or replace function public.create_my_player(p_name text, p_nickname text, p_handicap numeric, p_avatar_url text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_g uuid := private.current_group(); v_admin boolean;
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  v_admin := private.is_group_organiser(v_g);
  insert into public.players (group_id, name, nickname, handicap, avatar_url, approved)
  values (v_g, trim(p_name), nullif(trim(coalesce(p_nickname,'')), ''), coalesce(p_handicap, 18), p_avatar_url, v_admin)
  returning id into v_id;
  insert into public.handicap_history (group_id, player_id, old_handicap, new_handicap, reason)
  values (v_g, v_id, null, coalesce(p_handicap, 18), 'Starting handicap');
  update public.group_members set player_id = v_id where group_id = v_g and user_id = auth.uid();
  if not v_admin then
    insert into public.posts (group_id, kind, body, link)
    values (v_g, 'auto', trim(p_name) || ' wants to join — admin, approve them in More → Admin.', '/admin');
  end if;
  return v_id;
end $$;

create or replace function public.claim_player(p_player_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_g uuid := private.current_group();
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  if not exists (select 1 from public.players where id = p_player_id and group_id = v_g) then raise exception 'No such player'; end if;
  update public.group_members set player_id = p_player_id where group_id = v_g and user_id = auth.uid();
end $$;

create or replace function public.admin_create_player(p_name text, p_nickname text, p_handicap numeric, p_avatar_url text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Admin only'; end if;
  insert into public.players (group_id, name, nickname, handicap, avatar_url)
  values (v_g, trim(p_name), nullif(trim(coalesce(p_nickname,'')), ''), coalesce(p_handicap, 18), p_avatar_url)
  returning id into v_id;
  insert into public.handicap_history (group_id, player_id, old_handicap, new_handicap, reason)
  values (v_g, v_id, null, coalesce(p_handicap, 18), 'Starting handicap');
  return v_id;
end $$;

-- Handicap guard and approval guard: the organiser of the PLAYER's group.
create or replace function public.players_handicap_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.handicap is distinct from old.handicap then
    if not private.is_group_organiser(new.group_id) and coalesce(current_setting('app.allow_handicap', true), '') <> 'on' then
      raise exception 'Handicap changes go through the admin or the Tribunal';
    end if;
    insert into public.handicap_history (group_id, player_id, old_handicap, new_handicap, reason, case_id)
    values (new.group_id, new.id, old.handicap, new.handicap,
      coalesce(nullif(current_setting('app.handicap_reason', true), ''), 'Admin change'),
      nullif(current_setting('app.case_id', true), '')::uuid);
  end if;
  return new;
end $$;
create or replace function public.players_approval_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approved is distinct from old.approved and not private.is_group_organiser(new.group_id) then
    raise exception 'Only the admin can approve players';
  end if;
  return new;
end $$;

-- Tribunal: the accused must be in my current group; votes counted within the case's group.
create or replace function public.lodge_case(p_accused uuid, p_change numeric, p_text text, p_exhibit_url text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_g uuid := private.current_group(); v_me uuid; v_id uuid; v_name text;
begin
  v_me := private.my_player_id(v_g);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if not exists (select 1 from public.players where id = p_accused and group_id = v_g) then raise exception 'No such player'; end if;
  if p_change = 0 then raise exception 'Propose a change'; end if;
  if exists (select 1 from public.tribunal_cases where accused_id = p_accused and status = 'open') then
    raise exception 'There is already an open case against this player';
  end if;
  insert into public.tribunal_cases (group_id, accused_id, lodged_by, proposed_change, case_text, exhibit_url)
  values (v_g, p_accused, v_me, p_change, trim(p_text), p_exhibit_url) returning id into v_id;
  select coalesce(nickname, name) into v_name from public.players where id = p_accused;
  insert into public.posts (group_id, kind, body, player_id, link, photo_url)
  values (v_g, 'tribunal', 'Case lodged: The Lads v ' || v_name || ' (proposed ' ||
    case when p_change > 0 then '+' else '' end || trim(to_char(p_change, 'FM990.0')) || ')', v_me,
    '/tribunal/' || v_id, p_exhibit_url);
  return v_id;
end $$;

create or replace function public.set_defence(p_case uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tribunal_cases c where c.id = p_case and c.status = 'open'
                 and c.accused_id = private.my_player_id(c.group_id)) then
    raise exception 'Only the accused can write the defence, while the case is open';
  end if;
  update public.tribunal_cases set defence = trim(p_text) where id = p_case;
end $$;

create or replace function public.cast_vote(p_case uuid, p_vote text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.tribunal_cases%rowtype; v_me uuid; v_eligible int; v_votes int;
begin
  select * into c from public.tribunal_cases where id = p_case;
  if c.id is null or c.status <> 'open' then raise exception 'This case is closed'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if c.accused_id = v_me then raise exception 'The accused can''t vote on their own case'; end if;
  insert into public.tribunal_votes (group_id, case_id, voter_id, vote, comment)
  values (c.group_id, p_case, v_me, p_vote, nullif(trim(coalesce(p_comment,'')), ''))
  on conflict (case_id, voter_id) do update set vote = excluded.vote, comment = excluded.comment, created_at = now();
  -- Close automatically once every other player in this group who has the app has voted.
  select count(distinct gm.player_id) into v_eligible from public.group_members gm
    where gm.group_id = c.group_id and gm.player_id is not null and gm.player_id <> c.accused_id;
  select count(*) into v_votes from public.tribunal_votes where case_id = p_case;
  if v_eligible > 0 and v_votes >= v_eligible then
    perform public.finalise_case(p_case, null, null);
  end if;
end $$;

create or replace function public.chair_close_case(p_case uuid, p_override text, p_ruling text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tribunal_cases c where c.id = p_case and private.is_group_organiser(c.group_id)) then
    raise exception 'Only the chair (admin) can close a case';
  end if;
  perform public.finalise_case(p_case, p_override, p_ruling);
end $$;

create or replace function public.finalise_case(p_case uuid, p_override text, p_ruling text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.tribunal_cases%rowtype;
  g int; ng int; v_verdict text; v_old numeric; v_new numeric; v_name text;
begin
  select * into c from public.tribunal_cases where id = p_case for update;
  if c.id is null or c.status <> 'open' then return; end if;
  select count(*) filter (where vote = 'guilty'), count(*) filter (where vote = 'not_guilty')
    into g, ng from public.tribunal_votes where case_id = p_case;
  v_verdict := case when g > ng then 'upheld' else 'dismissed' end;
  if p_override in ('upheld','dismissed') then v_verdict := p_override; end if;
  select handicap, coalesce(nickname, name) into v_old, v_name from public.players where id = c.accused_id;
  v_new := v_old;
  if v_verdict = 'upheld' then
    v_new := greatest(-10, least(54, v_old + c.proposed_change));
    perform set_config('app.allow_handicap', 'on', true);
    perform set_config('app.handicap_reason', 'Tribunal verdict', true);
    perform set_config('app.case_id', p_case::text, true);
    update public.players set handicap = v_new where id = c.accused_id;
    perform set_config('app.allow_handicap', '', true);
    perform set_config('app.handicap_reason', '', true);
    perform set_config('app.case_id', '', true);
  end if;
  update public.tribunal_cases set status = 'closed', verdict = v_verdict, guilty_votes = g, not_guilty_votes = ng,
    chair_ruling = nullif(trim(coalesce(p_ruling,'')), ''),
    overruled = coalesce(p_override in ('upheld','dismissed') and p_override <> case when g > ng then 'upheld' else 'dismissed' end, false),
    old_handicap = v_old, new_handicap = v_new, closed_at = now()
  where id = p_case;
  insert into public.posts (group_id, kind, body, link)
  values (c.group_id, 'tribunal',
    'Verdict: ' || case when v_verdict = 'upheld' then 'GUILTY' else 'NOT GUILTY' end || ' ' || g || '–' || ng || '. ' ||
    case when v_verdict = 'upheld'
      then v_name || ' goes from ' || trim(to_char(v_old, 'FM990.0')) || ' to ' || trim(to_char(v_new, 'FM990.0')) || '.'
      else v_name || ' stays on ' || trim(to_char(v_old, 'FM990.0')) || '.' end ||
    case when p_override in ('upheld','dismissed') then ' (Chair''s ruling)' else '' end,
    '/tribunal/' || p_case);
end $$;

-- Planner row guard: organiser / "me" of the ROW's group.
create or replace function public.plan_rows_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_g uuid; me uuid;
begin
  v_g := case when tg_table_name = 'plan_group_members' then null else new.group_id end;
  if private.is_group_organiser(v_g) then return new; end if;
  me := private.my_player_id(v_g);
  if tg_table_name = 'plan_items' then
    if old.created_by is distinct from me and old.owner_id is distinct from me then
      new := old;
      new.owner_id := me;
      return new;
    end if;
    new.plan_id := old.plan_id; new.created_by := old.created_by; new.kind := old.kind;
  elsif tg_table_name = 'plan_options' then
    new.poll_id := old.poll_id; new.created_by := old.created_by;
  elsif tg_table_name = 'plan_costs' then
    new.plan_id := old.plan_id; new.created_by := old.created_by;
  elsif tg_table_name = 'plan_transfers' then
    new.plan_id := old.plan_id; new.from_id := old.from_id; new.to_id := old.to_id;
    new.amount := old.amount; new.created_by := old.created_by; new.note := old.note;
  end if;
  return new;
end $$;

-- Phones: saved for me; my player in my current group (one phone serves all my groups — notify
-- picks phones by who is in the group, not by this player link).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
declare v_p uuid := public.my_player_id();
begin
  if private.current_group() is null or v_p is null then raise exception 'Join the group first'; end if;
  insert into public.push_subscriptions (endpoint, user_id, player_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), v_p, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, player_id = excluded.player_id,
    p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, created_at = now();
end $$;

revoke execute on function public.finalise_case(uuid, text, text), public.plan_rows_guard(),
  public.players_approval_guard(), public.players_handicap_guard() from public, anon, authenticated;
revoke execute on function public.is_member(), public.is_admin(), public.my_player_id(), public.my_status(),
  public.join_group(text), public.claim_admin(text), public.set_pins(text, text),
  public.create_my_player(text, text, numeric, text), public.claim_player(uuid),
  public.admin_create_player(text, text, numeric, text), public.lodge_case(uuid, numeric, text, text),
  public.set_defence(uuid, text), public.cast_vote(uuid, text, text), public.chair_close_case(uuid, text, text),
  public.save_push_subscription(text, text, text, text) from public, anon;

-- ---------- Keep the old members table in step for L.G.C ----------
-- Only the v1.x notify function and the old "members" rules read it. L.G.C rows only.
create or replace function private.sync_legacy_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.group_id = private.legacy_group() then delete from public.members where user_id = old.user_id; end if;
    return old;
  end if;
  if new.group_id = private.legacy_group() then
    insert into public.members (user_id, player_id, is_admin) values (new.user_id, new.player_id, new.role = 'organiser')
    on conflict (user_id) do update set player_id = excluded.player_id, is_admin = excluded.is_admin;
  end if;
  return new;
end $$;
revoke all on function private.sync_legacy_member() from public, anon, authenticated;
create trigger sync_legacy_member after insert or update or delete on public.group_members
  for each row execute function private.sync_legacy_member();

-- ---------- Photos: per group ----------
-- New uploads go to <group id>/<folder>/…; old phones keep using avatars|feed|comps|tribunal/…,
-- which only L.G.C members may write to. Extra (restrictive) rules on top of the existing ones.
create or replace function private.photo_path_ok(p_name text, p_organiser boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_first text := split_part(p_name, '/', 1); v_g uuid;
begin
  if v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_g := v_first::uuid;
  elsif v_first in ('avatars', 'feed', 'comps', 'tribunal') then
    v_g := private.legacy_group();
  else
    return false;
  end if;
  return case when p_organiser then private.is_group_organiser(v_g) else private.is_group_member(v_g) end;
end $$;
revoke all on function private.photo_path_ok(text, boolean) from public, anon;
grant execute on function private.photo_path_ok(text, boolean) to authenticated;
create policy "photos: my groups' folders" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'photos' or private.photo_path_ok(name, false));
create policy "photos: organiser of that group removes" on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'photos' or private.photo_path_ok(name, true));

-- ---------- Claude connector keys, one per group ----------
-- The key is stored as a SHA-256 hash; L.G.C keeps its current key (copied from server_secrets).
create table public.connector_keys (
  key_hash text primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.connector_keys enable row level security;
revoke all on public.connector_keys from anon, authenticated;
insert into public.connector_keys (key_hash, group_id, player_id)
select encode(extensions.digest(k.value, 'sha256'), 'hex'), private.legacy_group(),
       (select value::uuid from public.server_secrets where name = 'mcp_player_id')
from public.server_secrets k where k.name = 'mcp_key';

alter publication supabase_realtime add table public.group_members;
