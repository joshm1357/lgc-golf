-- 050b — Ryder Cup fixes before the first event (21 Oct 2026). Additive; run after 050.
-- From the independent review of 049/050:
--  1. Someone already in the group (joined by PIN or player link) who opens a team link now goes on that team
--     (their player too, not only their membership). A team never changes by link: the first one sticks.
--  2. invite_info for a team link says which team you're already on (my_team).
--  3. A match's players are only re-checked when the match is made or its players change, so scoring a hole
--     never fails because of an unrelated player change.
--  4. trips.cup_points: the points in the whole cup (e.g. 28), so "to win" is right before day 2's matches exist.

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
             -- The team they're already on (a team never changes by link), so the app can say so.
             'my_team', (select ms.name from public.group_members m
                           left join public.players p on p.id = m.player_id
                           join public.cup_sides ms on ms.id = coalesce(p.cup_side, m.cup_side)
                          where m.group_id = g.id and m.user_id = auth.uid()),
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
declare v_g uuid; v_role text; o public.organiser_invites%rowtype; t public.team_invites%rowtype; m public.group_members%rowtype;
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
    on conflict (group_id, user_id) do update set cup_side = coalesce(public.group_members.cup_side, excluded.cup_side)
    returning * into m;
    -- Already in with a name: put that player on the team too (if they're not on one yet), approved.
    if m.player_id is not null then
      perform set_config('lgc.cup_side', 'on', true);
      update public.players set cup_side = m.cup_side, approved = true
       where id = m.player_id and group_id = t.group_id and cup_side is null;
      perform set_config('lgc.cup_side', '', true);
    end if;
    return t.group_id;
  end if;
  select group_id, role into v_g, v_role from public.group_invites where token = upper(trim(p_token)) and revoked_at is null;
  if v_g is null then perform private.pin_fail('invite'); return null; end if;
  insert into public.group_members (group_id, user_id, role) values (v_g, auth.uid(), v_role) on conflict do nothing;
  return v_g;
end $$;
revoke all on function public.invite_info(text), public.join_by_invite(text) from public, anon;
grant execute on function public.invite_info(text), public.join_by_invite(text) to authenticated;

create or replace function private.cup_match_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.a_players is distinct from old.a_players or new.b_players is distinct from old.b_players)
     and exists (select 1 from unnest(new.a_players || new.b_players) p
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

alter table public.trips add column if not exists cup_points numeric check (cup_points is null or (cup_points > 0 and cup_points <= 200));
