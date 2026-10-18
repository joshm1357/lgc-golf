-- 041b — Stage 9: leave a group, delete my account, delete a group. FOR JOSH TO APPLY (it removes rows, so the build
-- tools can't run it). Apply on STAGING first, then run supabase/tests/stage9_delete.sql there (it rolls back).
-- Nothing here runs by itself: each function only acts when a person taps the button and confirms.
--
-- Photos: the files of a deleted group (and a deleted person's selfie) stay in storage until a clean-up job removes
-- them (Stage 9 follow-up). Their links are removed from the database straight away, so nobody can find them in the app.

-- Leave the group you're in. Your name stays on the group's past scores and honour board (it's the group's history);
-- your phone's location, notification settings and sign-in link to this group are removed.
create or replace function public.leave_group()
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_uid uuid := auth.uid(); v_p uuid;
begin
  if v_uid is null or v_g is null or not private.is_group_member(v_g) then raise exception 'You''re not in this group'; end if;
  if (select legacy from public.groups where id = v_g) and private.is_group_organiser(v_g) then
    raise exception 'L.G.C organisers can''t leave from here — ask Josh';
  end if;
  if private.is_group_organiser(v_g)
     and (select count(*) from public.group_members where group_id = v_g and role = 'organiser') = 1
     and (select count(*) from public.group_members where group_id = v_g) > 1 then
    raise exception 'You''re the only organiser — make someone else an organiser first (Group & invites → People), or delete the group';
  end if;
  select player_id into v_p from public.group_members where group_id = v_g and user_id = v_uid;
  if v_p is not null then
    delete from public.location_pings where player_id = v_p;
    delete from public.push_subscriptions where player_id = v_p;
    update public.players set pay_details = null where id = v_p;
  end if;
  delete from public.notify_prefs where group_id = v_g and user_id = v_uid;
  delete from public.group_members where group_id = v_g and user_id = v_uid;
end $$;

-- Delete my account: every group you're in, as above, then your sign-in itself. With p_remove_name, your name in each
-- group's history becomes "Former player" and your selfie goes. Refused while you're the only organiser of a group
-- that has other people in it.
create or replace function public.delete_my_account(p_remove_name boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); m record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  for m in select gm.group_id, gm.player_id, gm.role, g.legacy, g.name from public.group_members gm join public.groups g on g.id = gm.group_id
           where gm.user_id = v_uid loop
    if m.role = 'organiser'
       and (select count(*) from public.group_members where group_id = m.group_id and role = 'organiser') = 1
       and (select count(*) from public.group_members where group_id = m.group_id) > 1 then
      raise exception 'You''re the only organiser of % — make someone else an organiser first, or delete that group', m.name;
    end if;
    if m.legacy and m.role = 'organiser' then raise exception 'L.G.C organisers can''t delete their account from here — ask Josh'; end if;
    if m.player_id is not null then
      delete from public.location_pings where player_id = m.player_id;
      delete from public.push_subscriptions where player_id = m.player_id;
      update public.players set pay_details = null,
        avatar_url = case when p_remove_name then null else avatar_url end,
        name = case when p_remove_name then 'Former player' else name end,
        nickname = case when p_remove_name then null else nickname end
      where id = m.player_id;
    end if;
  end loop;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from public.notify_prefs where user_id = v_uid;
  delete from public.club_members where user_id = v_uid;
  delete from public.group_members where user_id = v_uid;
  update public.club_claims set decided_by = null where decided_by = v_uid;
  delete from auth.users where id = v_uid;
end $$;

-- Delete the whole group (organiser, signed in properly, typing the group's name). Everything in it goes: scores,
-- trips, photos' links, plans, chat. Not L.G.C.
create or replace function public.delete_group(p_confirm_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); g record; t record; v_left int; v_pass int := 0;
begin
  if v_g is null or not private.is_group_organiser(v_g) then raise exception 'Only an organiser can do that'; end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), true) then
    raise exception 'Add a sign-in first (Group & invites) — then you can delete the group';
  end if;
  select * into g from public.groups where id = v_g for update;
  if g.legacy then raise exception 'L.G.C can''t be deleted from the app'; end if;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(g.name)) then raise exception 'Type the group''s name exactly to delete it'; end if;
  -- Child tables first: keep going round until every table with this group's rows is empty (rows that other rows
  -- still point at are tried again on the next pass).
  loop
    v_pass := v_pass + 1;
    v_left := 0;
    for t in
      select c.table_name from information_schema.columns c join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'group_id' and c.table_name <> 'client_errors'
    loop
      begin
        execute format('delete from public.%I where group_id = $1', t.table_name) using v_g;
      exception when foreign_key_violation then
        v_left := v_left + 1;
      end;
    end loop;
    exit when v_left = 0 or v_pass >= 12;
  end loop;
  if v_left > 0 then raise exception 'Couldn''t delete everything in the group — nothing was deleted. Tell Josh.'; end if;
  update public.course_library set source_group_id = null where source_group_id = v_g;
  update public.client_errors set group_id = null where group_id = v_g;
  delete from public.groups where id = v_g;
end $$;

revoke all on function public.leave_group(), public.delete_my_account(boolean), public.delete_group(text) from public, anon;
grant execute on function public.leave_group(), public.delete_my_account(boolean), public.delete_group(text) to authenticated;

-- Wrong-PIN records keep the internet address as it was (for the lock-out). Clear anything older than 30 days now;
-- a daily clean-up job for these, old app problems and old scans comes with the photo clean-up (Stage 9 follow-up).
delete from private.pin_attempts where at < now() - interval '30 days';
