-- 071 — Live commentary (21 Oct 2026). Additive only. New feature 'commentary' (a child of 'awards', on by default —
-- so it's on wherever award moments are on). Josh: "Auto commentary for notifications as the comp proceeds."
--
-- The app decides WHEN; the server writes the WORDS:
--   * A member's phone that sees a moment (src/lib/commentary.js: a lead change, a charge from 3+ back, birdie
--     streaks, an eagle, a hole-in-one, three wipes in a row, a Cup match going dormie, a Cup side going ahead, and
--     the round report once the round's award moment exists) records it here once: key unique per group, so many
--     phones make one row (insert … on conflict do nothing). Facts are ids, hole numbers, numbers and short words —
--     never free text from a phone. The database checks it's real (below).
--   * Every minute a scheduled job (lgc-commentary) checks for moments waiting for words. Only if there are any, it
--     calls the ai-helper function ({"mode":"commentary"}, with the server's cron secret header). That writes ONE
--     line — the AI in the group's tone with up to 5 of its running jokes, or a template line if the AI isn't set up,
--     is over its cap or fails — and marks the row 'ready'. (Picked over a pg_net call on every insert: one path,
--     retries for free, and nothing is called when nobody is playing.)
--   * 'ready' → the database posts the line to the Feed (if the Feed is on) and queues phone buzzes (notify_queue,
--     kind 'commentary', if notifications are on): only to people who chose "straight away", and at most one per
--     person per round each 30 minutes ("sometimes", the default) or 10 minutes ("often"); "feed only" never buzzes.
--     The round report goes to the Feed only (the round's award moment already buzzed). The ai-helper then asks the
--     notify function ({"type":"commentary"}) to send the waiting buzzes straight away.
--   * Organisers can hide a line (status 'hidden'): its Feed post comes down.
--   * commentary_settings: per group tone (straight / cheeky (default) / tv — a generic old-school TV commentator,
--     never a real person) and buzz level (often / sometimes (default) / feed). Organisers change it.

insert into public.feature_catalogue (key, default_on, parent, tier) values ('commentary', true, 'awards', 'free') on conflict (key) do nothing;

-- ------------------------------------------------------------------ Moments and their lines
create table if not exists public.commentary (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  key text not null check (key ~ '^(lead|charge|birdies|eagle|ace|wipe|dormie|cuplead|report):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|a|b)(:([1-9]|1[0-8]))?)?$'),
  kind text not null check (kind in ('lead', 'charge', 'birdies', 'eagle', 'ace', 'wipe', 'dormie', 'cuplead', 'report')),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object' and length(facts::text) <= 2000),
  line text check (line is null or length(line) between 1 and 600),
  status text not null default 'pending' check (status in ('pending', 'writing', 'ready', 'hidden')),
  written_by text check (written_by is null or written_by in ('ai', 'template')),
  input_tokens int check (input_tokens is null or input_tokens >= 0),
  output_tokens int check (output_tokens is null or output_tokens >= 0),
  claimed_at timestamptz,
  post_id uuid references public.posts(id) on delete set null,
  buzzed uuid[] not null default '{}',        -- who got a buzz for this line (sign-in ids), for the rate limit
  buzzed_at timestamptz,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (group_id, key),
  check (split_part(key, ':', 1) = kind),
  check (round_id::text = split_part(key, ':', 2)),
  check (status not in ('ready', 'hidden') or line is not null)
);
create index if not exists commentary_round_idx on public.commentary (round_id, created_at desc);
create index if not exists commentary_waiting_idx on public.commentary (created_at) where status in ('pending', 'writing');
create index if not exists commentary_group_idx on public.commentary (group_id, created_at desc);
create index if not exists commentary_post_idx on public.commentary (post_id);
create index if not exists commentary_created_by_idx on public.commentary (created_by);

alter table public.commentary enable row level security;
create policy "members read" on public.commentary for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
-- Any member (not a guest — the trigger checks) records a moment it sees.
create policy "members record" on public.commentary for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
-- Organisers hide a line (the trigger only lets the status change, to 'hidden').
create policy "organisers hide" on public.commentary for update
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.commentary as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: commentary (add)" on public.commentary as restrictive for insert with check (public.feature_on(group_id, 'commentary'));
create policy "feature on: commentary (change)" on public.commentary as restrictive for update using (public.feature_on(group_id, 'commentary')) with check (public.feature_on(group_id, 'commentary'));
revoke all on public.commentary from anon;
grant select, insert, update on public.commentary to authenticated;
create trigger aa_fill_group_id before insert or update on public.commentary
  for each row execute function private.fill_group_id('rounds:round_id');

-- Is this id someone (or a team, or a Cup match) in this round?
create or replace function private.commentary_in_round(p_round uuid, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.round_players where round_id = p_round and player_id = p_id)
      or exists (select 1 from public.teams where round_id = p_round and id = p_id)
      or exists (select 1 from public.team_players tp join public.teams t on t.id = tp.team_id where t.round_id = p_round and tp.player_id = p_id)
      or exists (select 1 from public.cup_matches where round_id = p_round and id = p_id);
$$;
revoke all on function private.commentary_in_round(uuid, uuid) from public, anon, authenticated;

-- Strokes minus par on a hole (null if there's no score with strokes).
create or replace function private.commentary_vs_par(p_round uuid, p_subject uuid, p_hole int) returns int
language sql stable security definer set search_path = '' as $$
  select s.strokes - (h ->> 'par')::int
  from public.scores s
  join public.rounds r on r.id = s.round_id
  join public.courses c on c.id = r.course_id
  cross join lateral jsonb_array_elements(c.holes) h
  where s.round_id = p_round and s.subject_id = p_subject and s.hole = p_hole and s.strokes is not null and not s.picked_up
    and (h ->> 'n')::int = p_hole
  limit 1;
$$;
revoke all on function private.commentary_vs_par(uuid, uuid, int) from public, anon, authenticated;

-- What a person may do. The server (service role) writes the line; a phone only records a checked moment; an
-- organiser only hides a line.
create or replace function private.commentary_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_me uuid; r public.rounds%rowtype; v_ref text; v_hole int; v_s text; v_vs int;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  -- The server itself (scheduled job / edge function with the server key): writing the line.
  if coalesce(nullif(current_setting('role', true), 'none'), 'postgres') not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'UPDATE' then
    if not private.is_group_organiser(new.group_id) then raise exception 'Only an organiser can hide a line'; end if;
    if new.status <> 'hidden' or old.status not in ('ready', 'hidden')
       or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'An organiser can only hide a line';
    end if;
    return new;
  end if;
  -- INSERT: a member's phone records a moment it saw; check it's real (cheaply).
  if private.is_group_guest(new.group_id) then raise exception 'Guests can''t record commentary'; end if;
  v_me := private.my_player_id(new.group_id);
  if v_me is null then raise exception 'Pick your name first'; end if;
  select * into r from public.rounds where id = new.round_id and group_id = new.group_id;
  if r.id is null or r.status not in ('live', 'locked') or r.play_date is null
     or r.play_date < ((now() at time zone 'Australia/Sydney')::date - 1) then
    raise exception 'That round isn''t being played';
  end if;
  -- Facts: only ids, numbers, true/false and short words — never free text. Every id must be in this round.
  for v_s in select x #>> '{}' from jsonb_path_query(new.facts, 'strict $.**') x where jsonb_typeof(x) = 'string' loop
    if v_s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      if not private.commentary_in_round(r.id, v_s::uuid) then raise exception 'That isn''t someone in this round'; end if;
    elsif v_s !~ '^[a-z_]{1,20}$' then
      raise exception 'Commentary facts can''t hold text';
    end if;
  end loop;
  v_ref := split_part(new.key, ':', 3);
  v_hole := nullif(split_part(new.key, ':', 4), '')::int;
  if new.kind in ('lead', 'charge', 'birdies', 'eagle', 'ace', 'wipe') then
    if v_hole is null or v_ref !~ '^[0-9a-f-]{36}$' or new.facts ->> 'subject' is distinct from v_ref
       or (new.facts ->> 'hole') is distinct from v_hole::text then
      raise exception 'That moment doesn''t add up';
    end if;
    if new.kind <> 'lead' and new.kind <> 'charge' then
      if not exists (select 1 from public.scores where round_id = r.id and subject_id = v_ref::uuid and hole = v_hole) then
        raise exception 'There''s no score for that hole';
      end if;
      v_vs := private.commentary_vs_par(r.id, v_ref::uuid, v_hole);
      if (new.kind = 'ace' and not exists (select 1 from public.scores where round_id = r.id and subject_id = v_ref::uuid and hole = v_hole and strokes = 1))
         or (new.kind = 'eagle' and coalesce(v_vs, 0) > -2)
         or (new.kind = 'birdies' and coalesce(v_vs, 0) > -1) then
        raise exception 'The score doesn''t match';
      end if;
    end if;
  elsif new.kind = 'dormie' then
    if v_hole is not null or new.facts ->> 'match' is distinct from v_ref
       or not exists (select 1 from public.cup_matches where id = nullif(v_ref, '')::uuid and round_id = r.id) then
      raise exception 'That isn''t one of this round''s matches';
    end if;
  elsif new.kind = 'cuplead' then
    if v_ref not in ('a', 'b') or v_hole is not null or new.facts ->> 'side' is distinct from v_ref
       or not exists (select 1 from public.cup_matches where round_id = r.id) then
      raise exception 'That isn''t this round''s Cup';
    end if;
  elsif new.kind = 'report' then
    if v_ref <> '' or not exists (select 1 from public.award_moments where group_id = new.group_id and key = 'round:' || r.id) then
      raise exception 'The round isn''t decided yet';
    end if;
  end if;
  -- The server fills these in.
  new.status := 'pending';
  new.line := null;
  new.written_by := null;
  new.input_tokens := null;
  new.output_tokens := null;
  new.claimed_at := null;
  new.post_id := null;
  new.buzzed := '{}';
  new.buzzed_at := null;
  new.created_by := v_me;
  new.created_at := now();
  return new;
end $$;
revoke all on function private.commentary_check() from public, anon, authenticated;
create or replace trigger ab_commentary_check before insert or update on public.commentary
  for each row execute function private.commentary_check();

-- ------------------------------------------------------------------ Settings
create table if not exists public.commentary_settings (
  group_id uuid primary key references public.groups(id) on delete cascade,
  tone text not null default 'cheeky' check (tone in ('straight', 'cheeky', 'tv')),
  buzz text not null default 'sometimes' check (buzz in ('often', 'sometimes', 'feed')),
  updated_at timestamptz not null default now()
);
alter table public.commentary_settings enable row level security;
create policy "members read" on public.commentary_settings for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "organisers add" on public.commentary_settings for insert
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "organisers change" on public.commentary_settings for update
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.commentary_settings as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: commentary (add)" on public.commentary_settings as restrictive for insert with check (public.feature_on(group_id, 'commentary'));
create policy "feature on: commentary (change)" on public.commentary_settings as restrictive for update using (public.feature_on(group_id, 'commentary')) with check (public.feature_on(group_id, 'commentary'));
revoke all on public.commentary_settings from anon;
grant select, insert, update on public.commentary_settings to authenticated;
create trigger aa_fill_group_id before insert or update on public.commentary_settings
  for each row execute function private.fill_group_id();

-- ------------------------------------------------------------------ A line is ready: Feed post and buzzes
create or replace function private.commentary_announce() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_post uuid; v_trip uuid; v_buzz text; v_mins int; v_users uuid[]; v_player uuid; v_round text;
begin
  -- Hidden: the Feed post comes down.
  if new.status = 'hidden' and old.status is distinct from 'hidden' then
    if new.post_id is not null then
      delete from public.posts where id = new.post_id and group_id = new.group_id;
    end if;
    return new;
  end if;
  if not (new.status = 'ready' and old.status is distinct from 'ready' and new.line is not null and new.post_id is null) then
    return new;
  end if;
  select trip_id, name into v_trip, v_round from public.rounds where id = new.round_id and group_id = new.group_id;
  if public.feature_on(new.group_id, 'feed') then
    select p.id into v_player from public.players p
     where p.group_id = new.group_id and p.id::text = coalesce(new.facts ->> 'subject', new.facts -> 'winners' ->> 0);
    insert into public.posts (group_id, trip_id, round_id, kind, body, player_id, link)
    values (new.group_id, v_trip, new.round_id, 'auto', left('🎙️ ' || new.line, 500), v_player, '/?r=' || new.round_id)
    returning id into v_post;
  end if;
  -- Buzzes: not for the report (the round's award moment already buzzed), not when the group chose "feed only".
  select coalesce((select buzz from public.commentary_settings where group_id = new.group_id), 'sometimes') into v_buzz;
  if new.kind <> 'report' and v_buzz <> 'feed' and public.feature_on(new.group_id, 'notifications') then
    v_mins := case v_buzz when 'often' then 10 else 30 end;
    with who as (
      select distinct gm.user_id from public.group_members gm
      where gm.group_id = new.group_id and gm.user_id is not null
        and exists (select 1 from public.push_subscriptions s where s.user_id = gm.user_id)
        -- Only people who chose "straight away" (or haven't chosen): a live line is no use in tomorrow's digest.
        and coalesce((select np.mode from public.notify_prefs np where np.group_id = new.group_id and np.user_id = gm.user_id), 'instant') = 'instant'
        -- The rate limit: one buzz a person a round each v_mins minutes; the rest are Feed only.
        and not exists (select 1 from public.commentary c
                        where c.group_id = new.group_id and c.round_id = new.round_id and c.id <> new.id
                          and c.buzzed_at > now() - make_interval(mins => v_mins) and gm.user_id = any (c.buzzed))
    ), q as (
      insert into public.notify_queue (group_id, user_id, kind, title, body, url)
      select new.group_id, who.user_id, 'commentary', left('🎙️ ' || new.line, 160), left(coalesce(v_round, ''), 300), null::text from who
      returning user_id
    )
    select coalesce(array_agg(user_id), '{}') into v_users from q;
  end if;
  update public.commentary set post_id = v_post, buzzed = coalesce(v_users, '{}'),
         buzzed_at = case when cardinality(coalesce(v_users, '{}')) > 0 then now() end
   where id = new.id;
  return new;
end $$;
revoke all on function private.commentary_announce() from public, anon, authenticated;
create or replace trigger ac_commentary_announce after update on public.commentary
  for each row execute function private.commentary_announce();

-- ------------------------------------------------------------------ The every-minute job
-- Calls the ai-helper (to write waiting lines) only when something is waiting, and the notify function (to send
-- waiting buzzes) only when a buzz has been sitting there over two minutes. The project's address comes from the
-- existing daily-reminders job (so this works on staging and live alike); the secret from server_secrets.
create or replace function private.commentary_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare v_base text; v_secret text;
begin
  select substring(command from 'https://[a-z0-9]+\.supabase\.co') into v_base from cron.job where jobname = 'lgc-daily-reminders';
  select value into v_secret from public.server_secrets where name = 'cron_secret';
  if v_base is null or v_secret is null then return; end if;
  if exists (select 1 from public.commentary
             where created_at > now() - interval '2 hours'
               and (status = 'pending' or (status = 'writing' and claimed_at < now() - interval '3 minutes'))) then
    perform net.http_post(url := v_base || '/functions/v1/ai-helper',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := '{"mode":"commentary"}'::jsonb);
  end if;
  if exists (select 1 from public.notify_queue where kind = 'commentary' and sent_at is null
             and created_at < now() - interval '2 minutes' and created_at > now() - interval '30 minutes') then
    perform net.http_post(url := v_base || '/functions/v1/notify',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := '{"type":"commentary"}'::jsonb);
  end if;
end $$;
revoke all on function private.commentary_tick() from public, anon, authenticated;
select cron.schedule('lgc-commentary', '* * * * *', 'select private.commentary_tick()');

alter publication supabase_realtime add table public.commentary;
alter publication supabase_realtime add table public.commentary_settings;
select private.add_same_group_checks();
