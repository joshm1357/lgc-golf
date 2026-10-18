-- 027 — Stage 2 (the parts that need no new sign-in setting): invite links, roles, name claiming, admin PIN fallback.
-- Additive: a new table and new functions; existing functions replaced with the same names and arguments.
--
-- Roles per group: organiser (runs the group), player, guest (a ring-in: plays, scores, posts and chats, but doesn't
-- vote on rules or in the Tribunal). Joining is by invite link; L.G.C's group PIN keeps working.

-- ------------------------------------------------------------------ Invite links
-- One live link per group and role (player / guest). Only the server reads this table.
create table if not exists public.group_invites (
  token text primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  role text not null default 'player' check (role in ('player', 'guest')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists group_invites_live_idx on public.group_invites (group_id, role) where revoked_at is null;
alter table public.group_invites enable row level security;
revoke all on public.group_invites from anon, authenticated;

-- The organiser's link (made the first time it's asked for).
create or replace function public.group_invite(p_role text default 'player')
returns text language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_token text;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can invite people'; end if;
  if p_role not in ('player', 'guest') then raise exception 'Unknown role'; end if;
  select token into v_token from public.group_invites where group_id = v_g and role = p_role and revoked_at is null;
  if v_token is null then
    loop
      v_token := private.random_code(12);
      exit when not exists (select 1 from public.group_invites where token = v_token);
    end loop;
    insert into public.group_invites (token, group_id, role) values (v_token, v_g, p_role);
  end if;
  return v_token;
end $$;

-- A new link; the old one stops working.
create or replace function public.reset_group_invite(p_role text default 'player')
returns text language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  update public.group_invites set revoked_at = now() where group_id = v_g and role = p_role and revoked_at is null;
  return public.group_invite(p_role);
end $$;

-- What a link is for, so the join screen can say "Join L.G.C". Counts as a try for the wrong-PIN limit if it's wrong.
create or replace function public.invite_info(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare v json;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select json_build_object('group_id', g.id, 'group_name', g.name, 'role', i.role,
           'already_in', exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid()))
    into v
  from public.group_invites i join public.groups g on g.id = i.group_id
  where i.token = upper(trim(p_token)) and i.revoked_at is null;
  if v is null then perform private.pin_fail('invite'); end if;
  return v;
end $$;

-- Join by link. Someone already in the group keeps their role (a guest link never demotes a player).
create or replace function public.join_by_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid; v_role text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select group_id, role into v_g, v_role from public.group_invites where token = upper(trim(p_token)) and revoked_at is null;
  if v_g is null then perform private.pin_fail('invite'); return null; end if;
  insert into public.group_members (group_id, user_id, role) values (v_g, auth.uid(), v_role) on conflict do nothing;
  return v_g;
end $$;

revoke all on function public.group_invite(text), public.reset_group_invite(text), public.invite_info(text), public.join_by_invite(text) from public, anon;
grant execute on function public.group_invite(text), public.reset_group_invite(text), public.invite_info(text), public.join_by_invite(text) to authenticated;

-- ------------------------------------------------------------------ Roles
create or replace function private.is_group_guest(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = auth.uid() and role = 'guest')
$$;
revoke all on function private.is_group_guest(uuid) from public, anon;
grant execute on function private.is_group_guest(uuid) to authenticated;

-- Organisers change someone's role. The group always keeps at least one organiser.
create or replace function public.set_member_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can change roles'; end if;
  if p_role not in ('organiser', 'player', 'guest') then raise exception 'Unknown role'; end if;
  if not exists (select 1 from public.group_members where group_id = v_g and user_id = p_user) then raise exception 'Not in this group'; end if;
  if p_role <> 'organiser'
     and (select role from public.group_members where group_id = v_g and user_id = p_user) = 'organiser'
     and (select count(*) from public.group_members where group_id = v_g and role = 'organiser') <= 1 then
    raise exception 'The group needs at least one organiser — make someone else one first';
  end if;
  update public.group_members set role = p_role where group_id = v_g and user_id = p_user;
end $$;

-- Organisers take someone out of the group (their scores and posts stay; their player is freed for someone else).
create or replace function public.remove_member(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  if (select role from public.group_members where group_id = v_g and user_id = p_user) = 'organiser'
     and (select count(*) from public.group_members where group_id = v_g and role = 'organiser') <= 1 then
    raise exception 'The group needs at least one organiser';
  end if;
  delete from public.group_members where group_id = v_g and user_id = p_user;
end $$;

-- Organisers free a player's name so whoever it really is can pick it (e.g. a new phone before proper sign-in).
create or replace function public.release_player(p_player uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  update public.group_members set player_id = null where group_id = v_g and player_id = p_player;
end $$;

revoke all on function public.set_member_role(uuid, text), public.remove_member(uuid), public.release_player(uuid) from public, anon;
grant execute on function public.set_member_role(uuid, text), public.remove_member(uuid), public.release_player(uuid) to authenticated;

-- ------------------------------------------------------------------ Picking your name: only a name nobody has
-- (Before: any member could link themselves to any player in their group and act as them.) Organisers can still
-- pick any name for themselves, and free a name with release_player().
create or replace function public.claim_player(p_player_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid := private.current_group();
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  if not exists (select 1 from public.players where id = p_player_id and group_id = v_g) then raise exception 'No such player'; end if;
  if not private.is_group_organiser(v_g) and exists (
    select 1 from public.group_members where group_id = v_g and player_id = p_player_id and user_id <> auth.uid()
  ) then
    raise exception 'Someone has already picked that name — ask an organiser to free it if it''s you';
  end if;
  update public.group_members set player_id = p_player_id where group_id = v_g and user_id = auth.uid();
end $$;

-- ------------------------------------------------------------------ Admin PIN: L.G.C only, until everyone signs in
-- New groups make organisers in Group members. L.G.C's admin PIN works while any L.G.C member still uses a
-- phone-only (anonymous) sign-in.
create or replace function public.claim_admin(p_pin text)
returns boolean language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid := private.current_group();
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  if not (select legacy from public.groups where id = v_g) then
    raise exception 'This group doesn''t use an admin PIN — ask an organiser to make you one';
  end if;
  if not exists (select 1 from public.group_members m join auth.users u on u.id = m.user_id
                 where m.group_id = v_g and coalesce(u.is_anonymous, false)) then
    raise exception 'Everyone has signed in properly, so the admin PIN is off — ask an organiser';
  end if;
  perform private.pin_check();
  if not exists (select 1 from public.groups where id = v_g and admin_pin = trim(p_pin)) then
    perform private.pin_fail('admin');
    return false;
  end if;
  update public.group_members set role = 'organiser' where group_id = v_g and user_id = auth.uid();
  return true;
end $$;

-- ------------------------------------------------------------------ Guests don't vote on rules or in the Tribunal
create policy "guests don't vote" on public.rule_votes as restrictive for insert
  with check (not private.is_group_guest(group_id));
create policy "guests don't change votes" on public.rule_votes as restrictive for update
  using (not private.is_group_guest(group_id));
create policy "guests don't propose rules" on public.rules as restrictive for insert
  with check (not private.is_group_guest(group_id));

create or replace function public.cast_vote(p_case uuid, p_vote text, p_comment text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare c public.tribunal_cases%rowtype; v_me uuid; v_eligible int; v_votes int;
begin
  select * into c from public.tribunal_cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  if c.status <> 'open' then raise exception 'This case is closed'; end if;
  if private.is_group_guest(c.group_id) then raise exception 'Guests don''t vote in the Tribunal'; end if;
  v_me := private.my_player_id(c.group_id);
  if v_me is null then raise exception 'Set up your profile first'; end if;
  if c.accused_id = v_me then raise exception 'The accused can''t vote on their own case'; end if;
  insert into public.tribunal_votes (group_id, case_id, voter_id, vote, comment)
  values (c.group_id, p_case, v_me, p_vote, nullif(trim(coalesce(p_comment,'')), ''))
  on conflict (case_id, voter_id) do update set vote = excluded.vote, comment = excluded.comment, created_at = now();
  select count(distinct gm.player_id) into v_eligible from public.group_members gm
    where gm.group_id = c.group_id and gm.player_id is not null and gm.player_id <> c.accused_id and gm.role <> 'guest';
  select count(*) into v_votes from public.tribunal_votes where case_id = p_case;
  if v_eligible > 0 and v_votes >= v_eligible then
    perform public.finalise_case(p_case, null, null);
  end if;
end $$;

create or replace function public.lodge_case(p_accused uuid, p_change numeric, p_text text, p_exhibit_url text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid := private.current_group(); v_me uuid; v_id uuid; v_name text;
begin
  if private.is_group_guest(v_g) then raise exception 'Guests can''t lodge Tribunal cases'; end if;
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

-- ------------------------------------------------------------------ my_status: also says how this person is signed in
create or replace function public.my_status()
returns json language sql stable security definer set search_path = 'public' as $$
  with g as (select private.current_group() as id)
  select json_build_object(
    'is_member', (select id from g) is not null,
    'is_admin', coalesce(private.is_group_organiser((select id from g)), false),
    'player_id', private.my_player_id((select id from g)),
    'group_name', (select name from public.groups where id = (select id from g)),
    'group_id', (select id from g),
    'legacy', (select legacy from public.groups where id = (select id from g)),
    'role', (select role from public.group_members where group_id = (select id from g) and user_id = auth.uid()),
    'signed_in', not coalesce((select is_anonymous from auth.users where id = auth.uid()), true),
    'groups', coalesce((select json_agg(json_build_object('id', gr.id, 'name', gr.name, 'slug', gr.slug, 'role', gm.role) order by gm.created_at)
                        from public.group_members gm join public.groups gr on gr.id = gm.group_id
                        where gm.user_id = auth.uid()), '[]'::json)
  );
$$;
