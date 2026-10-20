-- 048 — 7-day undo on deleting a group (agreed with Josh 20 Oct; Stage 2, before other groups join). Additive.
-- Deleting a group now hides it straight away for everyone (it's no longer anyone's current group, it's gone from
-- Your groups, and nobody can join it). For 7 days an organiser can bring it back from Your groups. After 7 days the
-- daily clean-up removes it for good, exactly as delete_group used to straight away.
-- Old app versions calling delete_group get the same hiding, so nothing is lost by them either.
-- Split in two: 048 (this file) hides and restores; 048b (the nightly purge after 7 days, and account deletion
-- ignoring deleted groups) contains DELETE statements, so it waits for Josh's approval.
-- Not covered: photo files of a purged group stay in storage until a photo clean-up job exists (as before, 041b).

alter table public.groups add column if not exists deleted_at timestamptz;
alter table public.groups add column if not exists deleted_by uuid references auth.users(id) on delete set null;
create index if not exists groups_deleted_at on public.groups (deleted_at) where deleted_at is not null;
create index if not exists groups_deleted_by on public.groups (deleted_by);

-- 2. Delete = hide, with 7 days to undo. Same checks as before.
create or replace function public.delete_group(p_group uuid, p_confirm_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  if p_group is null or not private.is_group_organiser(p_group) then raise exception 'Only an organiser can do that'; end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), true) then
    raise exception 'Add a sign-in first (Group & invites) — then you can delete the group';
  end if;
  select * into g from public.groups where id = p_group for update;
  if g.legacy then raise exception 'L.G.C can''t be deleted from the app'; end if;
  if g.deleted_at is not null then raise exception 'That group is already deleted'; end if;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(g.name)) then raise exception 'Type the group''s name exactly to delete it'; end if;
  update public.groups set deleted_at = now(), deleted_by = auth.uid() where id = p_group;
end $$;
revoke all on function public.delete_group(uuid, text) from public, anon;
grant execute on function public.delete_group(uuid, text) to authenticated;

-- 3. Undo, within 7 days, by any organiser of the group who is signed in properly.
create or replace function public.undo_delete_group(p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  if auth.uid() is null or not exists (select 1 from public.group_members
                                       where group_id = p_group and user_id = auth.uid() and role = 'organiser') then
    raise exception 'Only an organiser of that group can bring it back';
  end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), true) then
    raise exception 'Add a sign-in first — then you can bring the group back';
  end if;
  select * into g from public.groups where id = p_group for update;
  if g.deleted_at is null then raise exception 'That group isn''t deleted'; end if;
  if g.deleted_at < now() - interval '7 days' then raise exception 'It''s more than 7 days since that group was deleted'; end if;
  update public.groups set deleted_at = null, deleted_by = null where id = p_group;
end $$;
revoke all on function public.undo_delete_group(uuid) from public, anon;
grant execute on function public.undo_delete_group(uuid) to authenticated;

-- Groups I deleted (or could bring back as an organiser), for Your groups.
create or replace function public.my_deleted_groups()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', g.id, 'name', g.name, 'crest_url', g.crest_url, 'deleted_at', g.deleted_at,
                                             'undo_until', g.deleted_at + interval '7 days') order by g.deleted_at desc), '[]'::json)
  from public.groups g join public.group_members gm on gm.group_id = g.id and gm.user_id = auth.uid() and gm.role = 'organiser'
  where g.deleted_at is not null and g.deleted_at > now() - interval '7 days';
$$;
revoke all on function public.my_deleted_groups() from public, anon;
grant execute on function public.my_deleted_groups() to authenticated;

-- 4. Hidden straight away: a deleted group is never anyone's current group, so every access rule refuses its rows.
create or replace function private.current_group() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_hdr text; v_g uuid;
begin
  begin
    v_hdr := current_setting('request.headers', true)::json ->> 'x-group-id';
  exception when others then v_hdr := null;
  end;
  if v_hdr ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select gm.group_id into v_g from public.group_members gm join public.groups g on g.id = gm.group_id
     where gm.user_id = auth.uid() and gm.group_id = v_hdr::uuid and g.deleted_at is null;
    if v_g is not null then return v_g; end if;
  end if;
  select gm.group_id into v_g from public.group_members gm join public.groups g on g.id = gm.group_id
   where gm.user_id = auth.uid() and g.deleted_at is null order by gm.created_at, gm.group_id limit 1;
  return v_g;
end $$;

-- Your groups leaves deleted ones out (045's my_status, with that one filter).
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
    'quick', (select quick from public.groups where id = (select id from g)),
    'role', (select role from public.group_members where group_id = (select id from g) and user_id = auth.uid()),
    'signed_in', not coalesce((select is_anonymous from auth.users where id = auth.uid()), true),
    'look', (select json_build_object('short_name', short_name, 'crest_url', crest_url, 'primary', colour_primary,
                                      'accent', colour_accent, 'font', font)
             from public.groups where id = (select id from g)),
    'groups', coalesce((select json_agg(json_build_object('id', gr.id, 'name', gr.name, 'slug', gr.slug, 'role', gm.role,
                                                          'crest_url', gr.crest_url, 'legacy', gr.legacy, 'quick', gr.quick)
                                        order by gm.created_at)
                        from public.group_members gm join public.groups gr on gr.id = gm.group_id
                        where gm.user_id = auth.uid() and gr.deleted_at is null), '[]'::json)
  );
$$;
revoke all on function public.my_status() from public, anon;
grant execute on function public.my_status() to authenticated;

-- Nobody joins a deleted group (invite link, PIN or personal link all add a member row).
create or replace function private.no_joining_deleted_groups() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.groups where id = new.group_id and deleted_at is not null) then
    raise exception 'That group has been deleted';
  end if;
  return new;
end $$;
revoke all on function private.no_joining_deleted_groups() from public, anon, authenticated;
create or replace trigger group_members_not_deleted before insert on public.group_members
  for each row execute function private.no_joining_deleted_groups();


-- The access rules' own membership helpers (022) leave deleted groups out too, so nobody reads or changes a deleted
-- group's rows directly while it waits out its 7 days (found by supabase/tests/delete_undo.sql).
create or replace function private.my_group_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(gm.group_id), '{}') from public.group_members gm join public.groups g on g.id = gm.group_id
  where gm.user_id = auth.uid() and g.deleted_at is null;
$$;
create or replace function private.my_organiser_group_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(gm.group_id), '{}') from public.group_members gm join public.groups g on g.id = gm.group_id
  where gm.user_id = auth.uid() and gm.role = 'organiser' and g.deleted_at is null;
$$;
create or replace function private.is_group_member(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members gm join public.groups gr on gr.id = gm.group_id
                 where gm.group_id = g and gm.user_id = auth.uid() and gr.deleted_at is null);
$$;
create or replace function private.is_group_organiser(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members gm join public.groups gr on gr.id = gm.group_id
                 where gm.group_id = g and gm.user_id = auth.uid() and gm.role = 'organiser' and gr.deleted_at is null);
$$;
