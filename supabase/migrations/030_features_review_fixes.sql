-- 030 — fixes from the independent Stage 3 review. Additive: functions replaced, two rules relaxed in place, a trigger.

-- ------------------------------------------------------------------ A mistyped feature key fails closed
create or replace function private.require_feature(p_group uuid, p_key text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.feature_catalogue where key = p_key) then raise exception 'Unknown feature %', p_key; end if;
  if not public.feature_on(p_group, p_key) then
    raise exception '% is switched off for this group', initcap(replace(p_key, '_', ' '));
  end if;
end $$;

-- ------------------------------------------------------------------ Tribunal: every step checks it's on; verdict post only with the Feed
create or replace function public.set_defence(p_case uuid, p_text text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid;
begin
  select c.group_id into v_g from public.tribunal_cases c
  where c.id = p_case and c.status = 'open' and c.accused_id = private.my_player_id(c.group_id);
  if v_g is null then raise exception 'Only the accused can write the defence, while the case is open'; end if;
  perform private.require_feature(v_g, 'tribunal');
  update public.tribunal_cases set defence = trim(p_text) where id = p_case;
end $$;

create or replace function public.finalise_case(p_case uuid, p_override text, p_ruling text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare
  c public.tribunal_cases%rowtype;
  g int; ng int; v_verdict text; v_old numeric; v_new numeric; v_name text;
begin
  select * into c from public.tribunal_cases where id = p_case for update;
  if c.id is null or c.status <> 'open' then return; end if;
  perform private.require_feature(c.group_id, 'tribunal');
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
  if public.feature_on(c.group_id, 'feed') then
    insert into public.posts (group_id, kind, body, link)
    values (c.group_id, 'tribunal',
      'Verdict: ' || case when v_verdict = 'upheld' then 'GUILTY' else 'NOT GUILTY' end || ' ' || g || '–' || ng || '. ' ||
      case when v_verdict = 'upheld'
        then v_name || ' goes from ' || trim(to_char(v_old, 'FM990.0')) || ' to ' || trim(to_char(v_new, 'FM990.0')) || '.'
        else v_name || ' stays on ' || trim(to_char(v_old, 'FM990.0')) || '.' end ||
      case when p_override in ('upheld','dismissed') then ' (Chair''s ruling)' else '' end,
      '/tribunal/' || p_case);
  end if;
end $$;

-- ------------------------------------------------------------------ Other automatic posts only with the Feed on
create or replace function public.create_my_player(p_name text, p_nickname text, p_handicap numeric, p_avatar_url text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
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
  if not v_admin and public.feature_on(v_g, 'feed') then
    insert into public.posts (group_id, kind, body, link)
    values (v_g, 'auto', trim(p_name) || ' wants to join — admin, approve them in More → Admin.', '/admin');
  end if;
  return v_id;
end $$;

create or replace function public.claim_admin(p_pin text)
returns boolean language plpgsql security definer set search_path = 'public' as $$
declare v_g uuid := private.current_group(); v_pin text;
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  if not (select legacy from public.groups where id = v_g) then
    raise exception 'This group doesn''t use an admin PIN — ask an organiser to make you one';
  end if;
  perform private.pin_check();
  select admin_pin into v_pin from public.groups where id = v_g;
  if v_pin is null or v_pin <> trim(p_pin) then
    perform private.pin_fail('admin');
    return false;
  end if;
  update public.group_members set role = 'organiser' where group_id = v_g and user_id = auth.uid();
  if public.feature_on(v_g, 'feed') then
    insert into public.posts (group_id, kind, body) values (v_g, 'auto', '🔑 Someone used the admin PIN and is now an organiser.');
  end if;
  return true;
end $$;

create or replace function public.set_member_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_old text; v_name text;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can change roles'; end if;
  if p_role not in ('organiser', 'player', 'guest') then raise exception 'Unknown role'; end if;
  perform 1 from public.groups where id = v_g for update;
  select role into v_old from public.group_members where group_id = v_g and user_id = p_user;
  if v_old is null then raise exception 'Not in this group'; end if;
  if v_old = p_role then return; end if;
  if v_old = 'organiser' and (select count(*) from public.group_members where group_id = v_g and role = 'organiser') <= 1 then
    raise exception 'The group needs at least one organiser — make someone else one first';
  end if;
  update public.group_members set role = p_role where group_id = v_g and user_id = p_user;
  if public.feature_on(v_g, 'feed') then
    select coalesce(p.nickname, p.name) into v_name from public.group_members m join public.players p on p.id = m.player_id
      where m.group_id = v_g and m.user_id = p_user;
    insert into public.posts (group_id, kind, body)
    values (v_g, 'auto', '👥 ' || coalesce(v_name, 'Someone without a name yet') || ' is now ' ||
      case p_role when 'organiser' then 'an organiser' when 'guest' then 'a guest' else 'a player' end || '.');
  end if;
end $$;

-- ------------------------------------------------------------------ Bonus strokes: only a CHANGE to the bonus is refused
-- (029's rule refused every change to a round that already had a bonus — e.g. starting or locking it.)
alter policy "feature on: comp_bonus (add)" on public.rounds with check (true);
alter policy "feature on: comp_bonus (change)" on public.rounds using (true) with check (true);
create or replace function private.rounds_comp_bonus_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.comp_bonus, 0) <> 0
     and (tg_op = 'INSERT' or new.comp_bonus is distinct from old.comp_bonus)
     and not public.feature_on(new.group_id, 'comp_bonus') then
    raise exception 'Side comp bonus strokes are switched off for this group';
  end if;
  return new;
end $$;
revoke all on function private.rounds_comp_bonus_check() from public, anon, authenticated;
create or replace trigger ac_rounds_comp_bonus before insert or update on public.rounds
  for each row execute function private.rounds_comp_bonus_check();

-- ------------------------------------------------------------------ The trip-vote checks from 029 really are there
do $$
begin
  if pg_get_functiondef('public.start_trip_votes(uuid, jsonb, jsonb, date)'::regprocedure) not like '%require_feature%'
     or pg_get_functiondef('public.decide_poll(uuid, uuid, boolean)'::regprocedure) not like '%require_feature%' then
    raise exception 'start_trip_votes / decide_poll are missing their feature check — re-run 029''s rewrite';
  end if;
end $$;

-- ------------------------------------------------------------------ L.G.C: every switch written down
-- (So changing a default later can't change L.G.C by surprise.)
insert into public.group_features (group_id, feature_key, enabled, updated_by)
select private.legacy_group(), c.key, c.key not in ('scorecard_photo', 'booking_links'), null
from public.feature_catalogue c
where private.legacy_group() is not null
on conflict (group_id, feature_key) do nothing;
