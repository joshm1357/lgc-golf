-- 048b — the second half of the 7-day undo (048). It has DELETE statements (inside functions), so it needs Josh's
-- approval: on staging, then live with the release. Until it runs, a deleted group simply stays hidden (and
-- restorable) instead of being removed after 7 days.

-- 1. The real removal (what delete_group did before), now run by the clean-up after 7 days.
create or replace function private.purge_group(p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; v_left int; v_pass int := 0;
begin
  if p_group is null or not exists (select 1 from public.groups where id = p_group and deleted_at is not null and not legacy) then
    raise exception 'Only a deleted group can be purged';
  end if;
  -- Child tables first: go round until every table with this group's rows is empty (rows that other rows still point
  -- at are tried again next time round). If anything is left, nothing is deleted.
  loop
    v_pass := v_pass + 1;
    v_left := 0;
    for t in
      select c.table_name from information_schema.columns c join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'group_id'
        and c.table_name not in ('client_errors', 'plan_group_members')  -- plan_group_members.group_id is its room/car
    loop
      begin
        execute format('delete from public.%I where group_id = $1', t.table_name) using p_group;
      exception when foreign_key_violation then
        v_left := v_left + 1;
      end;
    end loop;
    exit when v_left = 0 or v_pass >= 12;
  end loop;
  if v_left > 0 then raise exception 'Couldn''t delete everything in the group — nothing was deleted'; end if;
  update public.course_library set source_group_id = null where source_group_id = p_group;
  update public.client_errors set group_id = null where group_id = p_group;
  delete from public.groups where id = p_group;
end $$;
revoke all on function private.purge_group(uuid) from public, anon, authenticated;

-- 5. Deleting your account: a group you deleted (waiting out its 7 days) doesn't block you.
create or replace function public.delete_my_account(p_remove_name boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); m record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  for m in select gm.group_id, gm.player_id, gm.role, g.legacy, g.name from public.group_members gm join public.groups g on g.id = gm.group_id
           where gm.user_id = v_uid and g.deleted_at is null loop
    if (select count(*) from public.group_members where group_id = m.group_id) = 1 then
      raise exception 'You''re the only one in % — delete that group first (Group & invites → Your data)', m.name;
    end if;
    if m.role = 'organiser' and (select count(*) from public.group_members where group_id = m.group_id and role = 'organiser') = 1 then
      raise exception 'You''re the only organiser of % — make someone else an organiser first, or delete that group', m.name;
    end if;
    if m.legacy and m.role = 'organiser' then raise exception 'L.G.C organisers can''t delete their account from here — ask Josh'; end if;
  end loop;
  for m in select player_id from public.group_members where user_id = v_uid and player_id is not null loop
    delete from public.location_pings where player_id = m.player_id;
    delete from public.push_subscriptions where player_id = m.player_id;
    update public.players set pay_details = null where id = m.player_id;
    if p_remove_name then perform private.forget_player_name(m.player_id); end if;
  end loop;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from public.notify_prefs where user_id = v_uid;
  delete from public.club_members where user_id = v_uid;
  delete from public.group_members where user_id = v_uid;
  update public.club_claims set decided_by = null where decided_by = v_uid;
  if to_regclass('public.booking_enquiries') is not null then
    execute 'update public.booking_enquiries set user_id = null where user_id = $1' using v_uid;
  end if;
  delete from auth.users where id = v_uid;
end $$;
revoke all on function public.delete_my_account(boolean) from public, anon;
grant execute on function public.delete_my_account(boolean) to authenticated;

-- 6. The daily clean-up also removes groups deleted more than 7 days ago. One that can't be removed is left for the
--    next night (and shows up in the database log), without stopping the rest of the clean-up.
create or replace function private.daily_cleanup() returns void language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  delete from private.pin_attempts where at < now() - interval '30 days';
  delete from public.client_errors where created_at < now() - interval '90 days';
  delete from public.scan_log where created_at < now() - interval '2 years';
  delete from public.location_pings where updated_at < now() - interval '1 day';
  for g in select id from public.groups where deleted_at < now() - interval '7 days' and not legacy loop
    begin
      perform private.purge_group(g.id);
    exception when others then
      raise warning 'daily_cleanup: could not purge group %: %', g.id, sqlerrm;
    end;
  end loop;
end $$;
revoke all on function private.daily_cleanup() from public, anon, authenticated;
