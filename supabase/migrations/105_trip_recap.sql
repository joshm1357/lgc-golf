-- 105 — The Weekend Recap (ov37, 24 Oct 2026). Additive only. Josh: "some sort of commentary recap of the
-- weekend… that includes all the historical stuff… Try make it funny."
--
-- A finished trip gets a short two-voice script (our own commentators, Rex Fairway and Bev Divot), read out on the
-- phone. It's part of the existing 'commentary' feature (071) — no new switch.
--
--   * trip_recaps — one per trip: the title, the lines ([{ who: 'A'|'B', text }], 4–16 of them, each up to 300
--     characters), the facts the commentators had (shown under the script), how many cards were in when it was written
--     (so the screen can say "new cards since — write it again"), who wrote the words ('ai' or 'template'), a version
--     number, and the Feed post once it's published.
--   * Written by the ai-helper function ({ mode: 'trip_recap' }) with the ORGANISER'S own sign-in, so these rules apply
--     exactly as if they'd typed it: organisers write, members read, same group only, the feature must be on. The
--     shape checks are on the table itself, so nobody (not even the server) can store something odd.
--   * publish_trip_recap(trip) — organisers: marks it published and puts ONE post in the Feed ("📺 The Weekend Recap is
--     out: <title> — ▶️ have a listen", linking to the recap). Publishing again after "Write it again" updates that post.
--     The post and published time can only be set this way (the guard trigger keeps them otherwise).
-- Nothing existing is changed or dropped. Older app versions don't know the table and carry on as before.

-- ------------------------------------------------------------------ the shape of a script
create or replace function private.recap_lines_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) between 4 and 16
     and not exists (
       select 1 from jsonb_array_elements(p) l
       where jsonb_typeof(l) <> 'object'
          or (l ->> 'who') is null or (l ->> 'who') not in ('A', 'B')
          or jsonb_typeof(l -> 'text') is distinct from 'string'
          or char_length(btrim(l ->> 'text')) not between 1 and 300
          or (select count(*) from jsonb_object_keys(l)) <> 2
     )
$$;
revoke all on function private.recap_lines_ok(jsonb) from public, anon;
grant execute on function private.recap_lines_ok(jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------ the table
create table if not exists public.trip_recaps (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 90),
  lines jsonb not null check (private.recap_lines_ok(lines)),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object' and length(facts::text) <= 20000),
  cards int not null default 0 check (cards between 0 and 10000),
  written_by text not null default 'template' check (written_by in ('ai', 'template')),
  version int not null default 1 check (version >= 1),
  post_id uuid references public.posts(id) on delete set null,
  published_at timestamptz,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id)
);
create index if not exists trip_recaps_group_idx on public.trip_recaps (group_id);
create index if not exists trip_recaps_post_idx on public.trip_recaps (post_id);
create index if not exists trip_recaps_created_by_idx on public.trip_recaps (created_by);

alter table public.trip_recaps enable row level security;
create policy "members read" on public.trip_recaps for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers add" on public.trip_recaps for insert
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "organisers change" on public.trip_recaps for update
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.trip_recaps as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: commentary (add)" on public.trip_recaps as restrictive for insert with check (public.feature_on(group_id, 'commentary'));
create policy "feature on: commentary (change)" on public.trip_recaps as restrictive for update using (public.feature_on(group_id, 'commentary')) with check (public.feature_on(group_id, 'commentary'));
revoke all on public.trip_recaps from anon;
grant select, insert, update on public.trip_recaps to authenticated;

drop trigger if exists aa_fill_group_id on public.trip_recaps;
create trigger aa_fill_group_id before insert or update on public.trip_recaps
  for each row execute function private.fill_group_id('trips:trip_id');

-- Guard: who wrote it, the version, and the Feed bits (only publish_trip_recap sets those).
create or replace function private.trip_recap_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  new.updated_at := now();
  if coalesce(current_setting('lgc.recap_publish', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if private.is_group_guest(new.group_id) then raise exception 'Guests can''t write the recap'; end if;
    new.post_id := null;
    new.published_at := null;
    new.version := 1;
    new.created_by := private.my_player_id(new.group_id);
    new.created_at := now();
  else
    if new.trip_id is distinct from old.trip_id or new.group_id is distinct from old.group_id then raise exception 'A recap stays with its trip'; end if;
    new.post_id := old.post_id;
    new.published_at := old.published_at;
    new.created_at := old.created_at;
    new.version := old.version + case when new.lines is distinct from old.lines or new.title is distinct from old.title then 1 else 0 end;
    new.created_by := coalesce(private.my_player_id(new.group_id), old.created_by);
  end if;
  return new;
end $$;
revoke all on function private.trip_recap_guard() from public, anon, authenticated;
drop trigger if exists ab_trip_recap_guard on public.trip_recaps;
create trigger ab_trip_recap_guard before insert or update on public.trip_recaps
  for each row execute function private.trip_recap_guard();

-- ------------------------------------------------------------------ publish it to the Feed
create or replace function public.publish_trip_recap(p_trip uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.trip_recaps%rowtype; v_post uuid; v_body text;
begin
  select * into r from public.trip_recaps where trip_id = p_trip;
  if r.id is null or not private.is_group_member(r.group_id) then raise exception 'There''s no recap for that trip yet'; end if;
  if not private.is_group_organiser(r.group_id) then raise exception 'Only an organiser can publish the recap'; end if;
  if not public.feature_on(r.group_id, 'commentary') then raise exception 'Commentary is switched off for this group'; end if;
  v_body := left('📺 The Weekend Recap is out: ' || left(btrim(r.title), 80) || ' — ▶️ have a listen', 500);
  v_post := r.post_id;
  if public.feature_on(r.group_id, 'feed') then
    if v_post is not null and exists (select 1 from public.posts where id = v_post and group_id = r.group_id) then
      update public.posts set body = v_body where id = v_post and group_id = r.group_id;
    else
      insert into public.posts (group_id, trip_id, kind, body, player_id, link)
      values (r.group_id, r.trip_id, 'auto', v_body, private.my_player_id(r.group_id), '/recap/' || r.trip_id)
      returning id into v_post;
    end if;
  end if;
  perform set_config('lgc.recap_publish', 'on', true);
  update public.trip_recaps set post_id = v_post, published_at = coalesce(published_at, now()) where id = r.id;
  perform set_config('lgc.recap_publish', '', true);
  return v_post;
end $$;
revoke all on function public.publish_trip_recap(uuid) from public, anon;
grant execute on function public.publish_trip_recap(uuid) to authenticated;

alter publication supabase_realtime add table public.trip_recaps;
select private.add_same_group_checks();
