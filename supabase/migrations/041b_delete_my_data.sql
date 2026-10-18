-- 041b — Stage 9: leave a group, delete my account, delete a group, and a daily clean-up. FOR JOSH TO APPLY (it
-- removes rows, so the build tools can't). Apply on STAGING first, then run supabase/tests/stage9_delete.sql there
-- (it rolls back) and compare with stage9_delete.expected.txt.
-- The three functions only act when a person taps the button and confirms. The clean-up runs once a day.
--
-- Photos: files of a deleted group (and a removed selfie) stay in storage until a photo clean-up job is built (it needs
-- the storage service, not SQL). Their links are removed from the database straight away.

-- Helpers ------------------------------------------------------------------------------------------------------------

create or replace function private.regex_quote(p text) returns text language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(p, ''), '([.*+?^${}()|\[\]\\])', '\\\1', 'g');
$$;

-- A player's name and nickname come off the group's history: their profile, the honour board and the app's own feed
-- posts ("Pete made birdie on 3"). Things other people wrote that mention them aren't changed.
create or replace function private.forget_player_name(p_player uuid) returns void language plpgsql set search_path = '' as $$
declare p record; v_pat text;
begin
  select * into p from public.players where id = p_player;
  if p.id is null then return; end if;
  v_pat := '\m(' || private.regex_quote(btrim(p.name))
           || case when coalesce(btrim(p.nickname), '') <> '' then '|' || private.regex_quote(btrim(p.nickname)) else '' end || ')\M';
  update public.honour_board set winner_names = regexp_replace(winner_names, v_pat, 'Former player', 'g')
   where group_id = p.group_id and p_player = any (player_ids);
  update public.posts set body = regexp_replace(body, v_pat, 'Former player', 'g')
   where group_id = p.group_id and kind = 'auto' and body ~ v_pat;
  update public.players set name = 'Former player', nickname = null, avatar_url = null where id = p_player;
end $$;
revoke all on function private.regex_quote(text), private.forget_player_name(uuid) from public, anon, authenticated;

-- Leave a group (named — not just "the one I'm looking at"). Your name stays on the group's past scores and honour
-- board; your phone's location, notification settings, payment details and link to the group go.
create or replace function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_p uuid; g record;
begin
  if v_uid is null or p_group is null or not exists (select 1 from public.group_members where group_id = p_group and user_id = v_uid) then
    raise exception 'You''re not in this group';
  end if;
  select * into g from public.groups where id = p_group;
  if g.legacy and private.is_group_organiser(p_group) then raise exception 'L.G.C organisers can''t leave from here — ask Josh'; end if;
  if (select count(*) from public.group_members where group_id = p_group) = 1 then
    raise exception 'You''re the only one in % — delete the group instead (Group & invites → Your data)', g.name;
  end if;
  if private.is_group_organiser(p_group)
     and (select count(*) from public.group_members where group_id = p_group and role = 'organiser') = 1 then
    raise exception 'You''re the only organiser — make someone else an organiser first (Group & invites → People), or delete the group';
  end if;
  select player_id into v_p from public.group_members where group_id = p_group and user_id = v_uid;
  if v_p is not null then
    delete from public.location_pings where player_id = v_p;
    delete from public.push_subscriptions where player_id = v_p;
    update public.players set pay_details = null where id = v_p;
  end if;
  delete from public.notify_prefs where group_id = p_group and user_id = v_uid;
  delete from public.group_members where group_id = p_group and user_id = v_uid;
end $$;

-- Delete my account: leave every group (as above), then the sign-in itself. With p_remove_name, your name and selfie
-- come off each group's history too ("Former player"). Refused while you're the only person in a group (delete it
-- first) or its only organiser.
create or replace function public.delete_my_account(p_remove_name boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); m record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  for m in select gm.group_id, gm.player_id, gm.role, g.legacy, g.name from public.group_members gm join public.groups g on g.id = gm.group_id
           where gm.user_id = v_uid loop
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
  delete from auth.users where id = v_uid;
end $$;

-- Delete a whole group (organiser, signed in properly, naming the group and typing its name). Everything in it goes.
-- Not L.G.C.
create or replace function public.delete_group(p_group uuid, p_confirm_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare g record; t record; v_left int; v_pass int := 0;
begin
  if p_group is null or not private.is_group_organiser(p_group) then raise exception 'Only an organiser can do that'; end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), true) then
    raise exception 'Add a sign-in first (Group & invites) — then you can delete the group';
  end if;
  select * into g from public.groups where id = p_group for update;
  if g.legacy then raise exception 'L.G.C can''t be deleted from the app'; end if;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(g.name)) then raise exception 'Type the group''s name exactly to delete it'; end if;
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
  if v_left > 0 then raise exception 'Couldn''t delete everything in the group — nothing was deleted. Tell Josh.'; end if;
  update public.course_library set source_group_id = null where source_group_id = p_group;
  update public.client_errors set group_id = null where group_id = p_group;
  delete from public.groups where id = p_group;
end $$;

revoke all on function public.leave_group(uuid), public.delete_my_account(boolean), public.delete_group(uuid, text) from public, anon;
grant execute on function public.leave_group(uuid), public.delete_my_account(boolean), public.delete_group(uuid, text) to authenticated;

-- Daily clean-up (about 2am Sydney): wrong-PIN records after 30 days, app problem reports after 90 days, scan records
-- after 2 years, and a shared location that hasn't updated for a day.
create or replace function private.daily_cleanup() returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from private.pin_attempts where at < now() - interval '30 days';
  delete from public.client_errors where created_at < now() - interval '90 days';
  delete from public.scan_log where created_at < now() - interval '2 years';
  delete from public.location_pings where updated_at < now() - interval '1 day';
end $$;
revoke all on function private.daily_cleanup() from public, anon, authenticated;
select private.daily_cleanup();
select cron.schedule('lgc-daily-cleanup', '20 15 * * *', 'select private.daily_cleanup()');
