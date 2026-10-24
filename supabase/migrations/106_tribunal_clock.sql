-- 106 — The Handicap Tribunal: posts worth tapping, a closing time, a verdict worth sharing (ov38, Josh 24 Oct 2026).
-- RUNS AFTER 104 (105 is ov37's weekend recap; nothing here touches it). Not applied to any Supabase project yet.
--
-- Why: on the South Coast weekend (18 Oct) four handicap cases were lodged mid-round and three were still open six
-- days later — nothing closed them — and the Feed posts were flat ("Case lodged: The Lads v Mike (proposed -4.0)").
--
-- ADDITIVE ONLY. Nothing is dropped or renamed; no check is dropped or re-added.
--   * tribunal_cases: four new nullable columns — closes_at (when voting closes), reminded_at (the "have your say"
--     nudge went), lodged_post_id and defence_post_id (the Feed posts, so they can be updated, not duplicated).
--   * A new case gets its closing time from the group's Handicap setting "Voting closes after" (governance_settings
--     .close_hours, already there since 061, default 48 hours). An organiser can move it per case
--     (set_case_closing). Existing open cases: 8pm Sydney on the first evening at least 18 hours after this runs
--     (run on Sat 24 or before 2am Sun 25 Oct → Sun 25 Oct 8pm, as Josh asked for L.G.C's three).
--   * lodge_case: PATCHED (029/104 style: the live body is read, only its Feed-post block is swapped for a call to
--     private.tribunal_lodged_post, fails loudly if the block isn't found, skipped if already done). Its 102 saved-
--     account check and everything else stay exactly as they are.
--   * The defence post: a trigger on tribunal_cases (when the defence is written or changed) — set_defence itself is
--     untouched. One post per case, updated in place; cleared defence → post removed.
--   * finalise_case: FULLY REPLACED (it is small, and no later migration patched it — 102 leaves it ungated on
--     purpose). Same verdict maths as 030 (majority guilty = upheld; a tie → not guilty; the chair can overrule), new
--     verdict words with the defence in them, and a "case_verdict" notification.
--   * The clock: private.tribunal_tick(now) every 10 minutes (pg_cron 'lgc-tribunal'), group by group:
--       - closing time passed → finalise_case (the same path as the last vote / the chair). Groups where the
--         organiser decides handicap cases ("the chair closes") are never auto-closed: organisers get one
--         "time's up" notification instead;
--       - a few hours before (4 h, daytime only) or the evening before (from 6pm, for a morning close) → one nudge to
--         everyone who can vote and hasn't: "⚖️ Verdicts at 8pm — 2 votes so far on Mike. Have your say."
--     Notifications go into notify_queue (kinds case_closing / case_verdict / case_fallback — the notify function
--     already knows them, their Tribunal switch and "only important") and the hourly send delivers them, honouring
--     each person's straight away / daily digest / only important choice. No edge-function change.
-- Older app versions keep working: they read tribunal_cases with select('*') and simply ignore the new columns.

-- =================================================================================================== columns
alter table public.tribunal_cases add column if not exists closes_at timestamptz;
alter table public.tribunal_cases add column if not exists reminded_at timestamptz;
alter table public.tribunal_cases add column if not exists lodged_post_id uuid references public.posts(id) on delete set null;
alter table public.tribunal_cases add column if not exists defence_post_id uuid references public.posts(id) on delete set null;
create index if not exists tribunal_cases_open_closes_idx on public.tribunal_cases (closes_at) where status = 'open';
create index if not exists tribunal_cases_lodged_post_idx on public.tribunal_cases (lodged_post_id);
create index if not exists tribunal_cases_defence_post_idx on public.tribunal_cases (defence_post_id);

-- =================================================================================================== words
-- A handicap the way people say it: 30, 12.4, -1.
create or replace function private.tribunal_hcp(p numeric) returns text
language sql immutable set search_path = '' as $$
  select case when p is null then '?' else regexp_replace(trim(to_char(p, 'FM990.0')), '\.0$', '') end
$$;

-- "Sun 8pm", "Sat 7:30am" (Sydney time).
create or replace function private.tribunal_clock(p timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(p at time zone 'Australia/Sydney', 'Dy') || ' ' ||
         to_char(p at time zone 'Australia/Sydney', 'FMHH12') ||
         case when extract(minute from p at time zone 'Australia/Sydney') = 0 then ''
              else to_char(p at time zone 'Australia/Sydney', ':MI') end ||
         lower(to_char(p at time zone 'Australia/Sydney', 'am'))
$$;

-- For a nudge: "at 8pm" (today), "tomorrow at 9am", else "Sun 8pm".
create or replace function private.tribunal_when(p timestamptz, p_now timestamptz) returns text
language sql stable set search_path = '' as $$
  select case (p at time zone 'Australia/Sydney')::date - (p_now at time zone 'Australia/Sydney')::date
    when 0 then 'at ' || substr(private.tribunal_clock(p), 5)
    when 1 then 'tomorrow at ' || substr(private.tribunal_clock(p), 5)
    else private.tribunal_clock(p) end
$$;

-- Someone's words, tidied and trimmed on a word boundary: one line, no wrapping quotes, "…" when cut.
create or replace function private.tribunal_quote(p text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
begin
  v := btrim(v, ' "“”''‘’');
  if v = '' then return null; end if;
  if char_length(v) <= p_max then return v; end if;
  v := substr(v, 1, p_max);
  if v ~ '\s' then v := regexp_replace(v, '\s+\S*$', ''); end if;
  return rtrim(v, ' ,.;:!?—–-') || '…';
end $$;

-- "Mike's"
create or replace function private.tribunal_whose(p_name text) returns text
language sql immutable set search_path = '' as $$ select coalesce(p_name, 'Someone') || '''s' $$;

-- The defence, for the verdict line: its first clause when that's short ("The “one-off” defence"), else its opening
-- words in quotes.
create or replace function private.tribunal_defence_bit(p_defence text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := private.tribunal_quote(p_defence, 300); v_first text; v_words int;
begin
  if v is null then return null; end if;
  v_first := btrim(split_part(regexp_replace(v, '[,.!?;:—–…]', '|', 'g'), '|', 1));
  v_words := coalesce(array_length(regexp_split_to_array(v_first, '\s+'), 1), 0);
  if v_first <> '' and v_words <= 4 then return 'The “' || v_first || '” defence'; end if;
  return '“' || private.tribunal_quote(v, 40) || '”';
end $$;

-- ⚖️ Mike's in the dock: “Hit them far too well!” 30 → 26 if guilty. Guilty or not? Vote by Sun 8pm.
create or replace function private.tribunal_lodged_words(p_case uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare c public.tribunal_cases; p public.players;
begin
  select * into c from public.tribunal_cases where id = p_case;
  select * into p from public.players where id = c.accused_id;
  return '⚖️ ' || private.tribunal_whose(coalesce(p.nickname, p.name)) || ' in the dock: “' ||
    coalesce(private.tribunal_quote(c.case_text, 90), 'No reason given') || '” ' ||
    private.tribunal_hcp(p.handicap) || ' → ' ||
    private.tribunal_hcp(greatest(-10, least(54, p.handicap + c.proposed_change))) || ' if guilty. Guilty or not?' ||
    case when c.closes_at is not null then ' Vote by ' || private.tribunal_clock(c.closes_at) || '.' else ' Have your say.' end;
end $$;

-- 🗣️ Mike's defence: “This was a one-off, I got lucky…”
create or replace function private.tribunal_defence_words(p_case uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare c public.tribunal_cases; v_name text;
begin
  select * into c from public.tribunal_cases where id = p_case;
  select coalesce(nickname, name) into v_name from public.players where id = c.accused_id;
  if private.tribunal_quote(c.defence, 140) is null then return null; end if;
  return '🗣️ ' || private.tribunal_whose(v_name) || ' defence: “' || private.tribunal_quote(c.defence, 140) || '”';
end $$;

-- ⚖️ GUILTY 3–1. Mike goes 30 → 26. The “one-off” defence didn't wash.
-- ⚖️ NOT GUILTY 2–1. Chris walks free and stays on 27.
create or replace function private.tribunal_verdict_words(p_verdict text, p_guilty int, p_not int, p_name text,
                                                         p_old numeric, p_new numeric, p_defence text, p_chair boolean)
returns text language plpgsql immutable set search_path = '' as $$
declare v_bit text := private.tribunal_defence_bit(p_defence); v text;
begin
  if p_verdict = 'upheld' then
    v := '⚖️ GUILTY ' || p_guilty || '–' || p_not || '. ' || coalesce(p_name, 'The accused') || ' goes ' ||
      private.tribunal_hcp(p_old) || ' → ' || private.tribunal_hcp(p_new) || '.' ||
      case when v_bit is not null then ' ' || v_bit || ' didn''t wash.' else ' No defence offered.' end;
  else
    v := '⚖️ NOT GUILTY ' || p_guilty || '–' || p_not || '. ' || coalesce(p_name, 'The accused') ||
      ' walks free and stays on ' || private.tribunal_hcp(p_old) || '.' ||
      case when v_bit is not null then ' ' || v_bit || ' did the trick.' else '' end;
  end if;
  if p_chair then v := v || ' (Chair''s ruling)'; end if;
  return v;
end $$;

-- =================================================================================================== posts
-- The lodged post (called by lodge_case). Only with the Feed on.
create or replace function private.tribunal_lodged_post(p_case uuid, p_by uuid, p_photo text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.tribunal_cases; v_post uuid;
begin
  select * into c from public.tribunal_cases where id = p_case;
  if c.id is null or not public.feature_on(c.group_id, 'feed') then return; end if;
  insert into public.posts (group_id, kind, body, player_id, link, photo_url)
  values (c.group_id, 'tribunal', left(private.tribunal_lodged_words(p_case), 500), p_by, '/tribunal/' || p_case, p_photo)
  returning id into v_post;
  update public.tribunal_cases set lodged_post_id = v_post where id = p_case;
end $$;

-- A new case: its closing time from the group's Handicap setting (default 48 hours).
create or replace function private.tribunal_cases_closes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.closes_at is null and new.status = 'open' then
    new.closes_at := now() + make_interval(hours => coalesce((private.gov_settings(new.group_id, 'handicap')->>'close_hours')::int, 48));
  end if;
  return new;
end $$;
drop trigger if exists ba_tribunal_closes on public.tribunal_cases;
create trigger ba_tribunal_closes before insert on public.tribunal_cases
  for each row execute function private.tribunal_cases_closes();

-- The defence post: written or changed → one post, updated in place; cleared → removed.
create or replace function private.tribunal_defence_post() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_words text; v_post uuid := new.defence_post_id;
begin
  if new.defence is not distinct from old.defence or new.status <> 'open' then return null; end if;
  v_words := private.tribunal_defence_words(new.id);
  if v_words is null then
    if v_post is not null then
      update public.tribunal_cases set defence_post_id = null where id = new.id;
      delete from public.posts where id = v_post;
    end if;
    return null;
  end if;
  if v_post is not null and exists (select 1 from public.posts where id = v_post) then
    update public.posts set body = left(v_words, 500) where id = v_post;
  elsif public.feature_on(new.group_id, 'feed') then
    insert into public.posts (group_id, kind, body, player_id, link)
    values (new.group_id, 'tribunal', left(v_words, 500), new.accused_id, '/tribunal/' || new.id)
    returning id into v_post;
    update public.tribunal_cases set defence_post_id = v_post where id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists zz_tribunal_defence_post on public.tribunal_cases;
create trigger zz_tribunal_defence_post after update of defence on public.tribunal_cases
  for each row execute function private.tribunal_defence_post();

-- =================================================================================================== lodge_case (patched)
do $$
declare v_def text := pg_get_functiondef('public.lodge_case(uuid, numeric, text, text)'::regprocedure);
        v_find text := $f$  if public.feature_on(v_g, 'feed') then
    insert into public.posts (group_id, kind, body, player_id, link, photo_url)
    values (v_g, 'tribunal', 'Case lodged: The Lads v ' || v_name || ' (proposed ' ||
      case when p_change > 0 then '+' else '' end || trim(to_char(p_change, 'FM990.0')) || ')', v_me,
      '/tribunal/' || v_id, p_exhibit_url);
  end if;$f$;
begin
  if position('tribunal_lodged_post' in v_def) > 0 then raise notice '106: lodge_case already patched'; return; end if;
  if position(v_find in v_def) = 0 then raise exception '106: lodge_case has changed — its Feed post block wasn''t found'; end if;
  execute replace(v_def, v_find, '  perform private.tribunal_lodged_post(v_id, v_me, p_exhibit_url); /* 106 */');
end $$;

-- =================================================================================================== finalise_case (replaced)
-- Same as 030 — the verdict maths, the handicap change and its history — with the new verdict words and a buzz.
create or replace function public.finalise_case(p_case uuid, p_override text, p_ruling text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare
  c public.tribunal_cases%rowtype;
  g int; ng int; v_verdict text; v_old numeric; v_new numeric; v_name text; v_line text; v_chair boolean;
begin
  select * into c from public.tribunal_cases where id = p_case for update;
  if c.id is null or c.status <> 'open' then return; end if;
  perform private.require_feature(c.group_id, 'tribunal');
  select count(*) filter (where vote = 'guilty'), count(*) filter (where vote = 'not_guilty')
    into g, ng from public.tribunal_votes where case_id = p_case;
  v_verdict := case when g > ng then 'upheld' else 'dismissed' end;
  if p_override in ('upheld','dismissed') then v_verdict := p_override; end if;
  v_chair := p_override in ('upheld','dismissed');
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
    overruled = coalesce(v_chair and p_override <> case when g > ng then 'upheld' else 'dismissed' end, false),
    old_handicap = v_old, new_handicap = v_new, closed_at = now()
  where id = p_case;
  v_line := private.tribunal_verdict_words(v_verdict, g, ng, v_name, v_old, v_new, c.defence, v_chair);
  if public.feature_on(c.group_id, 'feed') then
    insert into public.posts (group_id, kind, body, link) values (c.group_id, 'tribunal', left(v_line, 500), '/tribunal/' || p_case);
  end if;
  perform private.tribunal_queue(c.group_id, null, 'case_verdict', v_line, 'Tap to see the case — and share the verdict.', p_case);
end $$;
revoke execute on function public.finalise_case(uuid, text, text) from public, anon, authenticated;

-- =================================================================================================== notifications
-- Into notify_queue for these players (null = everyone in the group), with a phone that takes notifications. The
-- hourly send delivers them as each person chose. Nothing when notifications or the Tribunal are off.
create or replace function private.tribunal_queue(p_group uuid, p_players uuid[], p_kind text, p_title text, p_body text,
                                                 p_case uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_players is not null and cardinality(p_players) = 0 then return 0; end if;
  if not public.feature_on(p_group, 'notifications') or not public.feature_on(p_group, 'tribunal') then return 0; end if;
  insert into public.notify_queue (group_id, user_id, kind, title, body, url)
  select distinct p_group, gm.user_id, p_kind, left(p_title, 160), left(coalesce(p_body, ''), 300), '#/tribunal/' || p_case::text
  from public.group_members gm
  where gm.group_id = p_group and gm.user_id is not null
    and (p_players is null or gm.player_id = any (p_players))
    and exists (select 1 from public.push_subscriptions s where s.user_id = gm.user_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- Who can vote on this case: the Handicap Committee when it decides (and has members), else every player bar the
-- accused and guests.
create or replace function private.tribunal_voters(p_case uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare c public.tribunal_cases; s jsonb; v uuid[];
begin
  select * into c from public.tribunal_cases where id = p_case;
  s := private.gov_settings(c.group_id, 'handicap');
  if s->>'decides' = 'committee' then
    v := array_remove(private.committee_members(c.group_id, nullif(s->>'committee_id', '')::uuid), c.accused_id);
    if cardinality(v) > 0 then return v; end if;
  end if;
  select coalesce(array_agg(distinct gm.player_id), '{}') into v from public.group_members gm
  where gm.group_id = c.group_id and gm.player_id is not null and gm.player_id <> c.accused_id and gm.role <> 'guest';
  return v;
end $$;

-- Is it time for the "have your say" nudge? A few hours before (4 h) while people are up (8am–9pm Sydney), or the
-- evening before (from 6pm) for a close that's overnight or the next morning. Not in a case's first hour.
create or replace function private.tribunal_nudge_due(p_closes timestamptz, p_created timestamptz, p_now timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p_closes > p_now and p_created <= p_now - interval '1 hour' and (
    (p_closes <= p_now + interval '4 hours' and extract(hour from p_now at time zone 'Australia/Sydney') between 8 and 20)
    or (p_closes <= p_now + interval '16 hours' and extract(hour from p_now at time zone 'Australia/Sydney') between 18 and 20))
$$;

-- =================================================================================================== the clock
-- p_now: for tests.
create or replace function private.tribunal_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; r record; v_closed int := 0; v_nudged int := 0; v_due int := 0; v_hit int; v_line text;
begin
  -- Time's up.
  for c in select tc.*, coalesce(p.nickname, p.name) as who from public.tribunal_cases tc join public.players p on p.id = tc.accused_id
           where tc.status = 'open' and tc.closes_at is not null and tc.closes_at <= p_now
             and public.feature_on(tc.group_id, 'tribunal') order by tc.closes_at loop
    if private.gov_settings(c.group_id, 'handicap')->>'decides' = 'organiser' then
      -- The chair closes these: tell the organisers, once.
      insert into public.notify_log (key) values ('tribunal-due:' || c.id) on conflict do nothing;
      get diagnostics v_hit = row_count;
      if v_hit > 0 then
        perform private.tribunal_queue(c.group_id,
          (select array_agg(player_id) from public.group_members where group_id = c.group_id and role = 'organiser' and player_id is not null),
          'case_fallback', '⚖️ Time''s up on ' || private.tribunal_whose(c.who) || ' case — the chair closes it.',
          (select count(*) filter (where vote = 'guilty') || '–' || count(*) filter (where vote = 'not_guilty') || ' so far.'
             from public.tribunal_votes where case_id = c.id), c.id);
        v_due := v_due + 1;
      end if;
    else
      perform public.finalise_case(c.id, null, null);
      v_closed := v_closed + 1;
    end if;
  end loop;
  -- Have your say: one buzz per person, naming every case they haven't voted on that's due a nudge.
  for r in
    with due as (
      select tc.id, tc.group_id, tc.closes_at, coalesce(p.nickname, p.name) as who,
             (select count(*) from public.tribunal_votes v where v.case_id = tc.id) as n
      from public.tribunal_cases tc join public.players p on p.id = tc.accused_id
      where tc.status = 'open' and tc.reminded_at is null and tc.closes_at is not null
        and private.tribunal_nudge_due(tc.closes_at, tc.created_at, p_now) and public.feature_on(tc.group_id, 'tribunal')
    ), marked as (
      update public.tribunal_cases t set reminded_at = p_now from due where t.id = due.id returning due.*
    ), todo as (
      select m.*, x as voter from marked m cross join lateral unnest(private.tribunal_voters(m.id)) x
      where not exists (select 1 from public.tribunal_votes v where v.case_id = m.id and v.voter_id = x)
    )
    select group_id, voter, min(closes_at) as first_close, (array_agg(id order by closes_at, who))[1] as first_case,
           array_agg(n order by closes_at, who) as ns, array_agg(who order by closes_at, who) as whos
    from todo group by group_id, voter
  loop
    -- "2 votes so far on Mike, 1 on Chris, none on Dave" (the first one in full).
    v_line := '';
    for i in 1 .. cardinality(r.ns) loop
      v_line := v_line || case when i > 1 then ', ' else '' end ||
        case when r.ns[i] = 0 then case when i = 1 then 'no votes yet' else 'none' end
             else r.ns[i] || case when i = 1 then case when r.ns[i] = 1 then ' vote so far' else ' votes so far' end else '' end end
        || ' on ' || r.whos[i];
    end loop;
    perform private.tribunal_queue(r.group_id, array[r.voter], 'case_closing',
      '⚖️ Verdicts ' || private.tribunal_when(r.first_close, p_now) || ' — ' || v_line || '. Have your say.',
      'Guilty or not? Tap to vote.', r.first_case);
    v_nudged := v_nudged + 1;
  end loop;
  return jsonb_build_object('closed', v_closed, 'nudged', v_nudged, 'chair', v_due);
end $$;

create or replace function private.tribunal_job() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return private.tribunal_tick(now());
end $$;

-- =================================================================================================== the organiser moves it
-- An organiser moves a case's closing time (15 minutes to 30 days away). The nudge can go again; the lodged post's
-- "Vote by …" is brought up to date.
create or replace function public.set_case_closing(p_case uuid, p_closes_at timestamptz) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare c public.tribunal_cases;
begin
  perform private.saved_ok(null); /* 102-style: saved accounts only */
  select * into c from public.tribunal_cases where id = p_case;
  if c.id is null or not private.is_group_member(c.group_id) then raise exception 'No such case'; end if;
  perform private.require_feature(c.group_id, 'tribunal');
  if not private.is_group_organiser(c.group_id) then raise exception 'Only an organiser can move the closing time'; end if;
  if c.status <> 'open' then raise exception 'This case is closed'; end if;
  if p_closes_at is null or p_closes_at < now() + interval '15 minutes' then raise exception 'Pick a time at least 15 minutes away'; end if;
  if p_closes_at > now() + interval '30 days' then raise exception 'Pick a time within 30 days'; end if;
  update public.tribunal_cases set closes_at = p_closes_at, reminded_at = null where id = p_case;
  if c.lodged_post_id is not null then
    update public.posts set body = left(private.tribunal_lodged_words(p_case), 500) where id = c.lodged_post_id;
  end if;
  return p_closes_at;
end $$;

-- =================================================================================================== existing open cases
-- 8pm Sydney on the first evening at least 18 hours from now (Sun 25 Oct 8pm when run on Sat 24 Oct).
do $$
declare v_at timestamptz := ((now() at time zone 'Australia/Sydney')::date + time '20:00') at time zone 'Australia/Sydney';
begin
  while v_at < now() + interval '18 hours' loop v_at := v_at + interval '1 day'; end loop;
  update public.tribunal_cases set closes_at = v_at where status = 'open' and closes_at is null;
end $$;

-- =================================================================================================== permissions + the job
revoke all on function private.tribunal_hcp(numeric), private.tribunal_clock(timestamptz), private.tribunal_when(timestamptz, timestamptz),
  private.tribunal_quote(text, int), private.tribunal_whose(text), private.tribunal_defence_bit(text),
  private.tribunal_lodged_words(uuid), private.tribunal_defence_words(uuid),
  private.tribunal_verdict_words(text, int, int, text, numeric, numeric, text, boolean),
  private.tribunal_lodged_post(uuid, uuid, text), private.tribunal_cases_closes(), private.tribunal_defence_post(),
  private.tribunal_queue(uuid, uuid[], text, text, text, uuid), private.tribunal_voters(uuid),
  private.tribunal_nudge_due(timestamptz, timestamptz, timestamptz), private.tribunal_tick(timestamptz), private.tribunal_job()
  from public, anon, authenticated;
revoke all on function public.set_case_closing(uuid, timestamptz) from public, anon;
grant execute on function public.set_case_closing(uuid, timestamptz) to authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'lgc-tribunal') then perform cron.unschedule('lgc-tribunal'); end if;
end $$;
select cron.schedule('lgc-tribunal', '*/10 * * * *', 'select private.tribunal_job()');
