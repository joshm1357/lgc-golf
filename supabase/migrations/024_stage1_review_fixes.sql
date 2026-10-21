-- 024 — fixes from the independent Stage 1 review. Additive: changes functions, rules and permissions; no data changes.
-- Run after 023 (and before or after 025 — it doesn't matter; 025 calls private.add_same_group_checks() again).

-- ------------------------------------------------------------------ MUST 1: the old members table is L.G.C's only
-- public.is_admin() now follows the group header, so an organiser of ANY group passed these rules.
alter policy "read own membership" on public.members
  using (user_id = (select auth.uid()) or private.is_group_organiser(private.legacy_group()));
alter policy "admin manages members" on public.members
  using (private.is_group_organiser(private.legacy_group()))
  with check (private.is_group_organiser(private.legacy_group()));
-- No app version writes to it (it's kept in step from group_members by the server), so take writing away altogether.
revoke insert, update, delete on public.members from authenticated, anon;
-- Same second lock for group_members: only the server's functions add or change people.
revoke insert, update, delete on public.group_members from authenticated, anon;

-- ------------------------------------------------------------------ MUST 2: a score can't name another group's player
create or replace function public.scores_autopost()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare
  v_par int; v_trip uuid; v_name text; v_word text; v_diff int;
begin
  if new.strokes is null or new.picked_up then return new; end if;
  if tg_op = 'UPDATE' and old.strokes is not distinct from new.strokes then return new; end if;
  select (h->>'par')::int, r.trip_id into v_par, v_trip
  from public.rounds r join public.courses c on c.id = r.course_id,
       jsonb_array_elements(c.holes) h
  where r.id = new.round_id and (h->>'n')::int = new.hole;
  if v_par is null then return new; end if;
  v_diff := new.strokes - v_par;
  if new.strokes = 1 then v_word := 'a HOLE IN ONE';
  elsif v_diff <= -3 then v_word := 'an albatross';
  elsif v_diff = -2 then v_word := 'an eagle';
  elsif v_diff = -1 then v_word := 'birdie';
  else return new; end if;
  if new.subject_type = 'team' then
    select name into v_name from public.teams where id = new.subject_id and group_id = new.group_id;
  else
    select coalesce(nickname, name) into v_name from public.players where id = new.subject_id and group_id = new.group_id;
  end if;
  insert into public.posts (trip_id, round_id, kind, body, hole, group_id)
  values (v_trip, new.round_id, 'auto', coalesce(v_name, 'Someone') || ' made ' || v_word || ' on ' || new.hole || '.', new.hole, new.group_id);
  return new;
end $$;

-- And refuse the score in the first place: its player or team must be in the same group.
create or replace function private.scores_subject_group()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_g uuid;
begin
  if tg_op = 'UPDATE' and new.subject_id is not distinct from old.subject_id and new.subject_type is not distinct from old.subject_type then
    return new;
  end if;
  if new.subject_type = 'team' then
    select group_id into v_g from public.teams where id = new.subject_id;
  else
    select group_id into v_g from public.players where id = new.subject_id;
  end if;
  if v_g is not null and v_g <> new.group_id then raise exception 'That belongs to another group'; end if;
  return new;
end $$;
revoke all on function private.scores_subject_group() from public, anon, authenticated;
create or replace trigger ab_scores_subject_group before insert or update on public.scores
  for each row execute function private.scores_subject_group();

-- ------------------------------------------------------------------ SHOULD 1: every parent must agree, not just the first
create or replace function private.fill_group_id()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_parent uuid; v_found uuid; v_id uuid; i int; v_tbl text; v_col text;
begin
  if tg_op = 'UPDATE' and new.group_id is distinct from old.group_id then
    raise exception 'A % row can''t be moved to another group', tg_table_name;
  end if;
  for i in 0 .. coalesce(tg_nargs, 0) - 1 loop
    v_tbl := split_part(tg_argv[i], ':', 1);
    v_col := split_part(tg_argv[i], ':', 2);
    v_id := (to_jsonb(new) ->> v_col)::uuid;
    if v_id is not null then
      v_found := null;
      execute format('select group_id from public.%I where id = $1', v_tbl) into v_found using v_id;
      if v_found is not null then
        if v_parent is null then v_parent := v_found;
        elsif v_found <> v_parent then raise exception 'That belongs to another group';
        end if;
      end if;
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

-- ------------------------------------------------------------------ SHOULD 2: every link to another row stays in the group
-- e.g. a round's course, a job's owner, a vote's option, a cost's payer. Checked when the row is added or the link changes.
create or replace function private.same_group_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
declare i int; v_tbl text; v_col text; v_id uuid; v_found uuid;
begin
  for i in 0 .. coalesce(tg_nargs, 0) - 1 loop
    v_tbl := split_part(tg_argv[i], ':', 1);
    v_col := split_part(tg_argv[i], ':', 2);
    v_id := (to_jsonb(new) ->> v_col)::uuid;
    continue when v_id is null;
    continue when tg_op = 'UPDATE' and v_id is not distinct from (to_jsonb(old) ->> v_col)::uuid;
    v_found := null;
    execute format('select group_id from public.%I where id = $1', v_tbl) into v_found using v_id;
    if v_found is not null and v_found <> new.group_id then
      raise exception 'That belongs to another group';
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.same_group_refs() from public, anon, authenticated;

-- Rooms and cars: their people must be in the plan's group (plan_group_members.group_id is a room/car id).
create or replace function private.plan_group_members_same_group()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_room uuid; v_player uuid;
begin
  select group_id into v_room from public.plan_groups where id = new.group_id;
  select group_id into v_player from public.players where id = new.player_id;
  if v_room is not null and v_player is not null and v_room <> v_player then raise exception 'That belongs to another group'; end if;
  return new;
end $$;
revoke all on function private.plan_group_members_same_group() from public, anon, authenticated;
create or replace trigger ab_same_group before insert or update on public.plan_group_members
  for each row execute function private.plan_group_members_same_group();

-- Builds (or rebuilds) one "ab_same_group" trigger per group table, listing every link to another group table.
-- Called again by later migrations that add tables or links.
create or replace function private.add_same_group_checks()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    with gt as (
      select c.table_name from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'group_id'
        and c.table_name not in ('group_members', 'connector_keys', 'notify_prefs', 'notify_queue', 'plan_group_members')
    )
    select t.relname::text as tbl,
           string_agg(quote_literal(f.relname || ':' || a.attname), ', ' order by a.attname) as args
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid and t.relnamespace = 'public'::regnamespace
    join pg_class f on f.oid = con.confrelid and f.relnamespace = 'public'::regnamespace
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.contype = 'f' and array_length(con.conkey, 1) = 1 and a.attname <> 'group_id'
      and t.relname in (select table_name from gt)
      and f.relname in (select table_name from gt)
    group by 1
  loop
    execute format('create or replace trigger ab_same_group before insert or update on public.%I '
                   'for each row execute function private.same_group_refs(%s)', r.tbl, r.args);
  end loop;
end $$;
revoke all on function private.add_same_group_checks() from public, anon, authenticated;
select private.add_same_group_checks();

-- ------------------------------------------------------------------ MUST 3: PINs can't be guessed
-- Wrong PINs are counted per sign-in and per internet address; 10 an hour per sign-in, 30 per address.
create table if not exists private.pin_attempts (
  id bigint generated always as identity primary key,
  user_id uuid,
  ip text,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists pin_attempts_user_idx on private.pin_attempts (user_id, at);
create index if not exists pin_attempts_ip_idx on private.pin_attempts (ip, at);

create or replace function private.request_ip()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  begin
    v := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  exception when others then v := null;
  end;
  return nullif(btrim(split_part(coalesce(v, ''), ',', 1)), '');
end $$;

create or replace function private.pin_check()
returns void language plpgsql security definer set search_path = '' as $$
declare v_ip text := private.request_ip();
begin
  if (select count(*) from private.pin_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10
     or (v_ip is not null and (select count(*) from private.pin_attempts where ip = v_ip and at > now() - interval '1 hour') >= 30) then
    raise exception 'Too many wrong PINs — wait an hour and try again';
  end if;
end $$;

create or replace function private.pin_fail(p_kind text)
returns void language sql security definer set search_path = '' as $$
  insert into private.pin_attempts (user_id, ip, kind) values (auth.uid(), private.request_ip(), p_kind);
$$;
-- (Only wrong tries are kept, so this stays small; old rows can be cleared by hand: delete … where at < now() - '1 day'.)
revoke all on function private.request_ip(), private.pin_check(), private.pin_fail(text) from public, anon, authenticated;

create or replace function public.join_group(p_pin text)
returns boolean language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select id into v_g from public.groups where group_pin = trim(p_pin);
  if v_g is null then perform private.pin_fail('join'); return false; end if;
  insert into public.group_members (group_id, user_id) values (v_g, auth.uid()) on conflict do nothing;
  return true;
end $$;

create or replace function public.join_group_id(p_pin text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select id into v_g from public.groups where group_pin = trim(p_pin);
  if v_g is null then perform private.pin_fail('join'); return null; end if;
  insert into public.group_members (group_id, user_id) values (v_g, auth.uid()) on conflict do nothing;
  return v_g;
end $$;

create or replace function public.claim_admin(p_pin text)
returns boolean language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid := private.current_group();
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  perform private.pin_check();
  if not exists (select 1 from public.groups where id = v_g and admin_pin = trim(p_pin)) then
    perform private.pin_fail('admin');
    return false;
  end if;
  update public.group_members set role = 'organiser' where group_id = v_g and user_id = auth.uid();
  return true;
end $$;

-- SHOULD 5 + the "taken" hint. Empty PINs are refused. A new group's joining code is made by the server
-- (10 random characters), so there's nothing to guess and no "that PIN is taken" to probe with; its organiser can
-- get a fresh one with reset_group_code(). L.G.C keeps choosing its own PIN as now.
create or replace function public.set_pins(p_group_pin text, p_admin_pin text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid := private.current_group(); v_legacy boolean; v_current text;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Admin only'; end if;
  select legacy, group_pin into v_legacy, v_current from public.groups where id = v_g;
  if coalesce(length(trim(p_admin_pin)), 0) < 4 then raise exception 'The admin PIN needs at least 4 characters'; end if;
  if not v_legacy then
    if nullif(trim(p_group_pin), '') is not null and trim(p_group_pin) is distinct from v_current then
      raise exception 'Your group''s joining code is made by the app — use "New code" to change it';
    end if;
    update public.groups set admin_pin = trim(p_admin_pin) where id = v_g;
    return;
  end if;
  if coalesce(length(trim(p_group_pin)), 0) < 4 then raise exception 'The group PIN needs at least 4 characters'; end if;
  if exists (select 1 from public.groups where group_pin = trim(p_group_pin) and id <> v_g) then
    raise exception 'Pick a different group PIN';
  end if;
  update public.groups set group_pin = trim(p_group_pin), admin_pin = trim(p_admin_pin) where id = v_g;
  update public.settings set group_pin = trim(p_group_pin), admin_pin = trim(p_admin_pin) where id = 1;
end $$;

create or replace function private.random_code(p_len int)
returns text language sql volatile set search_path = '' as $$
  -- No 0/O/1/I/L, so it reads back cleanly over the phone.
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + (get_byte(b, i) % 31), 1), '' order by i)
  from (select extensions.gen_random_bytes(p_len) as b) x, generate_series(0, p_len - 1) i
$$;
revoke all on function private.random_code(int) from public, anon, authenticated;

create or replace function public.reset_group_code()
returns text language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_code text;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Admin only'; end if;
  if (select legacy from public.groups where id = v_g) then raise exception 'L.G.C sets its own PIN in Admin'; end if;
  loop
    v_code := private.random_code(10);
    exit when not exists (select 1 from public.groups where group_pin = v_code);
  end loop;
  update public.groups set group_pin = v_code where id = v_g;
  return v_code;
end $$;
revoke all on function public.reset_group_code() from public, anon;
grant execute on function public.reset_group_code() to authenticated;

-- ------------------------------------------------------------------ Housekeeping from the advisor
create index if not exists connector_keys_group_idx on public.connector_keys (group_id);
create index if not exists connector_keys_player_idx on public.connector_keys (player_id);

-- ------------------------------------------------------------------ SHOULD 3: no screen listens to group_members, and its
-- delete events went to every phone in every group. (Applied on staging as its own step: 024b.)
alter publication supabase_realtime drop table public.group_members;
