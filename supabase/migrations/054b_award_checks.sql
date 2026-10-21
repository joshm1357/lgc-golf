-- 054b — Award moments: review fixes (21 Oct 2026). Run after 054.
--  * A member's phone can still record an award it sees decided, but the database now checks it's real: no guests;
--    winners must be this group's players; a round / side comp award needs a live or locked round played today or
--    yesterday; a side comp award's hole must be one of the round's comp holes and its winner must have an entry there;
--    a trophy award's trophy must belong to the round's trip. Organisers are unchanged.
--  * Closest to the pin / longest drive buzzes are kind 'award_minor' (not "important"); the notify function treats
--    both kinds as the awards feature.

create or replace function private.award_moments_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_me uuid; v_org boolean; v_ref uuid; r public.rounds%rowtype; v_hole int;
begin
  -- The moment's own follow-up (its feed post's id, set by the trigger below) isn't a person's change.
  if pg_trigger_depth() > 1 then return new; end if;
  v_me := private.my_player_id(new.group_id);
  v_org := private.is_group_organiser(new.group_id);
  -- What the key points at must be this group's.
  v_ref := split_part(new.key, ':', 2)::uuid;
  if (new.kind = 'trophy' and not exists (select 1 from public.trophies t where t.id = v_ref and t.group_id = new.group_id))
     or (new.kind = 'cup' and not exists (select 1 from public.cup_matches m where m.id = v_ref and m.group_id = new.group_id)) then
    raise exception 'That award isn''t for one of this group''s trophies or matches';
  end if;
  if tg_op = 'INSERT' then
    -- 054b: a member's phone records what it saw decided; check it's real (from the review: no forged awards).
    if not v_org then
      if private.is_group_guest(new.group_id) then raise exception 'Guests can''t record awards'; end if;
      if coalesce(cardinality(new.winner_player_ids), 0) = 0
         or exists (select 1 from unnest(new.winner_player_ids) w
                    where not exists (select 1 from public.players p where p.id = w and p.group_id = new.group_id)) then
        raise exception 'The winner isn''t in this group';
      end if;
      if new.kind in ('round', 'ctp', 'ld') then
        select * into r from public.rounds where id = split_part(new.key, ':', 2)::uuid and group_id = new.group_id;
        if r.id is null or new.round_id is distinct from r.id or r.status not in ('live', 'locked')
           or r.play_date is null or r.play_date < ((now() at time zone 'Australia/Sydney')::date - 1) then
          raise exception 'That round isn''t being played';
        end if;
        if new.kind in ('ctp', 'ld') then
          v_hole := split_part(new.key, ':', 3)::int;
          if not (v_hole = any (case when new.kind = 'ctp' then r.ctp_holes else r.ld_holes end))
             or not exists (select 1 from public.side_entries e where e.round_id = r.id and e.kind = new.kind and e.hole = v_hole
                            and e.player_id = new.winner_player_ids[1]) then
            raise exception 'That side comp result doesn''t match the entries';
          end if;
        end if;
      elsif new.kind = 'trophy' and new.round_id is not null
            and not exists (select 1 from public.trophies t join public.rounds rr on rr.trip_id = t.trip_id
                            where t.id = v_ref and rr.id = new.round_id and rr.group_id = new.group_id) then
        raise exception 'That trophy isn''t for this trip';
      end if;
    end if;
    new.created_by := v_me;
    new.created_at := now();
    new.post_id := null;
    if not v_org then new.photo_url := null; end if;
    new.photo_by := case when new.photo_url is null then null else v_me end;
    return new;
  end if;
  if not v_org then
    if new.key is distinct from old.key or new.kind is distinct from old.kind or new.round_id is distinct from old.round_id
       or new.title is distinct from old.title or new.detail is distinct from old.detail
       or new.winner_player_ids is distinct from old.winner_player_ids or new.post_id is distinct from old.post_id
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'Only an organiser can change an award';
    end if;
    if new.photo_url is distinct from old.photo_url or new.photo_by is distinct from old.photo_by then
      if v_me is null then raise exception 'Pick your name first'; end if;
      if old.photo_url is not null and old.photo_by is distinct from v_me then
        raise exception 'Only the organiser or whoever took the photo can change it';
      end if;
      new.photo_by := case when new.photo_url is null then null else v_me end;
    end if;
  elsif new.photo_url is distinct from old.photo_url and new.photo_by is not distinct from old.photo_by then
    new.photo_by := case when new.photo_url is null then null else v_me end;
  end if;
  return new;
end $$;
revoke all on function private.award_moments_check() from public, anon, authenticated;

create or replace function private.award_moments_announce() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_post uuid; v_trip uuid; v_body text;
begin
  v_body := new.title || coalesce('. ' || nullif(new.detail, ''), '');
  if public.feature_on(new.group_id, 'feed') then
    select trip_id into v_trip from public.rounds where id = new.round_id and group_id = new.group_id;
    insert into public.posts (group_id, trip_id, round_id, kind, body, player_id, link, photo_url)
    values (new.group_id, v_trip, new.round_id, 'auto', left(v_body, 500),
            (select p.id from public.players p where p.id = new.winner_player_ids[1] and p.group_id = new.group_id),
            private.award_link(new.kind, new.key), new.photo_url)
    returning id into v_post;
    update public.award_moments set post_id = v_post where id = new.id;
  end if;
  -- Phones: through the existing hourly send (notify function, type "digest"), to members with notifications set up.
  -- "Straight away" people get it at the next send, "daily digest" people in their digest.
  if public.feature_on(new.group_id, 'notifications') then
    insert into public.notify_queue (group_id, user_id, kind, title, body, url)
    -- 054b: closest-to-pin / longest-drive are 'award_minor' (not counted as important); rounds, trophies, Cup matches 'award'.
    select distinct new.group_id, gm.user_id, case when new.kind in ('ctp', 'ld') then 'award_minor' else 'award' end,
           left(new.title, 160), left(coalesce(new.detail, ''), 300), null::text
    from public.group_members gm
    where gm.group_id = new.group_id and gm.user_id is not null
      and exists (select 1 from public.push_subscriptions s where s.user_id = gm.user_id);
  end if;
  return new;
end $$;
revoke all on function private.award_moments_announce() from public, anon, authenticated;
