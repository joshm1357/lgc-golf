-- 054 — Award moments (21 Oct 2026). Additive only. Behind the feature switch 'awards' (053, off by default).
--
-- When something is decided — a round's winner, a closest-to-the-pin / longest-drive hole, a trophy, a Cup match —
-- the first phone that sees it records it here (the app works out "decided" in src/lib/awards.js). Every phone then
-- shows a winner card on the leaderboard, with the winner's photo once someone takes it.
--  * key: one per thing, e.g. round:<round id>, ctp:<round id>:<hole>, ld:<round id>:<hole>, trophy:<trophy id>,
--    cup:<match id>. Unique per group, so many phones recording at once still make one row
--    (insert … on conflict do nothing).
--  * Any member records a moment. The photo: anyone adds the first one; after that only whoever took it, or an
--    organiser, changes it. Organisers can change anything (e.g. a result fixed after a score was corrected).
--  * Recording a moment also posts it to the Feed (if the Feed is on) and queues a phone notification through the
--    existing hourly send (notify_queue, if notifications are on). Adding the photo puts it on that post too.

create table if not exists public.award_moments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  key text not null check (key ~ '^(round|ctp|ld|trophy|cup):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:([1-9]|1[0-8]))?$'),
  kind text not null check (kind in ('round', 'ctp', 'ld', 'trophy', 'cup')),
  round_id uuid references public.rounds(id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 160),
  detail text check (detail is null or length(detail) <= 300),
  winner_player_ids uuid[] not null default '{}' check (cardinality(winner_player_ids) <= 12),
  photo_url text check (photo_url is null or length(photo_url) <= 400),
  photo_by uuid references public.players(id) on delete set null,
  post_id uuid references public.posts(id) on delete set null,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (group_id, key),
  -- The key says what it is: its kind, and (for rounds and side comps) which round and hole.
  check (split_part(key, ':', 1) = kind),
  check ((kind in ('ctp', 'ld')) = (split_part(key, ':', 3) <> '')),
  check (kind not in ('round', 'ctp', 'ld') or round_id::text = split_part(key, ':', 2))
);
create index if not exists award_moments_group_idx on public.award_moments (group_id, created_at desc);
create index if not exists award_moments_round_idx on public.award_moments (round_id);
create index if not exists award_moments_photo_by_idx on public.award_moments (photo_by);
create index if not exists award_moments_post_idx on public.award_moments (post_id);
create index if not exists award_moments_created_by_idx on public.award_moments (created_by);

alter table public.award_moments enable row level security;
create policy "members read" on public.award_moments for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
-- Any member records a moment (the first phone to see it decided).
create policy "members record" on public.award_moments for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
-- Members may update (the photo); the trigger below stops a player changing anything else, or someone else's photo.
create policy "members add the photo" on public.award_moments for update
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers remove" on public.award_moments for delete
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.award_moments as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: awards (add)" on public.award_moments as restrictive for insert with check (public.feature_on(group_id, 'awards'));
create policy "feature on: awards (change)" on public.award_moments as restrictive for update using (public.feature_on(group_id, 'awards')) with check (public.feature_on(group_id, 'awards'));
create policy "feature on: awards (remove)" on public.award_moments as restrictive for delete using (public.feature_on(group_id, 'awards'));
revoke all on public.award_moments from anon;
grant select, insert, update, delete on public.award_moments to authenticated;
create trigger aa_fill_group_id before insert or update on public.award_moments
  for each row execute function private.fill_group_id('rounds:round_id');

-- Who may change what. Runs after the group is filled in (ab_ … after aa_ …).
create or replace function private.award_moments_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_me uuid; v_org boolean; v_ref uuid;
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
create or replace trigger ab_award_moments_check before insert or update on public.award_moments
  for each row execute function private.award_moments_check();

-- Where a moment's feed post points: the leaderboard, the side comp hole, the Trophy Room or the Cup match.
create or replace function private.award_link(p_kind text, p_key text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'round' then '/?r=' || split_part(p_key, ':', 2)
    when 'ctp' then '/comps?r=' || split_part(p_key, ':', 2) || '&kind=ctp&hole=' || split_part(p_key, ':', 3)
    when 'ld' then '/comps?r=' || split_part(p_key, ':', 2) || '&kind=ld&hole=' || split_part(p_key, ':', 3)
    when 'trophy' then '/trophies'
    when 'cup' then '/cup/' || split_part(p_key, ':', 2)
  end;
$$;
revoke all on function private.award_link(text, text) from public, anon, authenticated;

-- A new moment: post it to the Feed and queue a buzz. Only runs for rows really added (not "already there").
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
    select distinct new.group_id, gm.user_id, 'award', left(new.title, 160), left(coalesce(new.detail, ''), 300), null::text
    from public.group_members gm
    where gm.group_id = new.group_id and gm.user_id is not null
      and exists (select 1 from public.push_subscriptions s where s.user_id = gm.user_id);
  end if;
  return new;
end $$;
revoke all on function private.award_moments_announce() from public, anon, authenticated;
create or replace trigger ac_award_moments_announce after insert on public.award_moments
  for each row execute function private.award_moments_announce();

-- The photo (or a corrected result) follows onto the moment's feed post.
create or replace function private.award_moments_follow() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.post_id is null then return new; end if;
  if new.photo_url is distinct from old.photo_url or new.title is distinct from old.title or new.detail is distinct from old.detail then
    update public.posts
       set photo_url = new.photo_url,
           body = left(new.title || coalesce('. ' || nullif(new.detail, ''), ''), 500)
     where id = new.post_id and group_id = new.group_id;
  end if;
  return new;
end $$;
revoke all on function private.award_moments_follow() from public, anon, authenticated;
create or replace trigger ad_award_moments_follow after update on public.award_moments
  for each row execute function private.award_moments_follow();

alter publication supabase_realtime add table public.award_moments;
select private.add_same_group_checks();
