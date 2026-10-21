-- 049 — One-time organiser link (21 Oct 2026). Additive only: one new table, one new function, two replaced.
-- Lets Josh set a group up for a mate and hand it over: the mate opens the link, signs in, and is that group's
-- organiser. Each link works once, lasts 14 days, and is made only by a platform admin or an organiser of the group.
-- invite_info and join_by_invite (from 031b and 027) learn the new link; player and guest links work as before.

create table if not exists public.organiser_invites (
  token text primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);
create index if not exists organiser_invites_group_idx on public.organiser_invites (group_id);
create index if not exists organiser_invites_created_by_idx on public.organiser_invites (created_by);
create index if not exists organiser_invites_used_by_idx on public.organiser_invites (used_by);
alter table public.organiser_invites enable row level security;   -- no rules: only the functions below touch it
revoke all on public.organiser_invites from anon, authenticated;

-- A new one-time organiser link for a group.
create or replace function public.make_organiser_link(p_group uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  -- The SQL editor and migrations (no signed-in user) can make one too: that's how Josh sets a group up for someone.
  if auth.uid() is not null and not (private.is_platform_admin() or private.is_group_organiser(p_group)) then
    raise exception 'Only an organiser can make an organiser link';
  end if;
  if not exists (select 1 from public.groups where id = p_group) then raise exception 'No such group'; end if;
  loop
    v_token := private.random_code(12);
    exit when not exists (select 1 from public.organiser_invites where token = v_token)
          and not exists (select 1 from public.group_invites where token = v_token)
          and not exists (select 1 from public.player_links where token = v_token);
  end loop;
  insert into public.organiser_invites (token, group_id) values (v_token, p_group);
  return v_token;
end $$;
revoke all on function public.make_organiser_link(uuid) from public, anon;
grant execute on function public.make_organiser_link(uuid) to authenticated;

-- What a link is for (031b's version, plus organiser links). A used or expired organiser link says so.
create or replace function public.invite_info(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare v json; o public.organiser_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select * into o from public.organiser_invites where token = upper(trim(p_token));
  if o.token is not null then
    if o.used_by is distinct from auth.uid() and (o.used_at is not null or o.expires_at <= now()) then
      return null;   -- the app says "that link has stopped working — ask for a new one"
    end if;
    select json_build_object('group_id', g.id, 'group_name', g.name, 'role', 'organiser',
             'already_in', exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid() and m.role = 'organiser'),
             'look', json_build_object('short_name', g.short_name, 'crest_url', g.crest_url, 'primary', g.colour_primary,
                                       'accent', g.colour_accent, 'font', g.font, 'name', g.name))
      into v from public.groups g where g.id = o.group_id;
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

-- Join by link (027's version, plus organiser links). An organiser link makes you the organiser even if you'd
-- already joined as a player, and then stops working.
create or replace function public.join_by_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g uuid; v_role text; o public.organiser_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select * into o from public.organiser_invites where token = upper(trim(p_token)) for update;
  if o.token is not null then
    if o.used_by = auth.uid() then return o.group_id; end if;          -- tapped twice
    if o.used_at is not null or o.expires_at <= now() then return null; end if;
    insert into public.group_members (group_id, user_id, role) values (o.group_id, auth.uid(), 'organiser')
    on conflict (group_id, user_id) do update set role = 'organiser';
    update public.organiser_invites set used_at = now(), used_by = auth.uid() where token = o.token;
    return o.group_id;
  end if;
  select group_id, role into v_g, v_role from public.group_invites where token = upper(trim(p_token)) and revoked_at is null;
  if v_g is null then perform private.pin_fail('invite'); return null; end if;
  insert into public.group_members (group_id, user_id, role) values (v_g, auth.uid(), v_role) on conflict do nothing;
  return v_g;
end $$;
revoke all on function public.invite_info(text), public.join_by_invite(text) from public, anon;
grant execute on function public.invite_info(text), public.join_by_invite(text) to authenticated;
