-- 039 — Stage 8b part 3: Clubhouse TV. Additive: one column on rounds, two functions.
-- A big-screen, read-only page per course (#/tv/<course>) showing today's live leaderboards — only for groups that
-- have the Clubhouse TV switch on AND opted in for that round. First names or nicknames only, no photos, no surnames
-- (team names and round names aren't sent — a round can be named after the person who started it; the TV calls each
-- board "Group 1", "Group 2" and names a team by its players' first names).

alter table public.rounds add column if not exists tv boolean not null default false;

-- The organiser puts a round on (or off) the clubhouse TV.
create or replace function public.set_round_tv(p_round uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid;
begin
  select group_id into v_g from public.rounds where id = p_round;
  if v_g is null or v_g is distinct from private.current_group() or not private.is_group_organiser(v_g) then
    raise exception 'Only the organiser can do that';
  end if;
  if p_on then perform private.require_feature(v_g, 'clubhouse_tv'); end if;
  update public.rounds set tv = p_on where id = p_round;
end $$;
revoke all on function public.set_round_tv(uuid, boolean) from public, anon;
grant execute on function public.set_round_tv(uuid, boolean) to authenticated;

-- What the TV shows (anyone can read it — it's on a screen in the clubhouse): today's opted-in rounds on this course.
create or replace function public.tv_board(p_slug text)
returns json language sql stable security definer set search_path = '' as $$
  with l as (select id, name from public.course_library where slug = lower(btrim(p_slug)) and not hidden),
       today as (select (now() at time zone 'Australia/Sydney')::date as d),
       r as (select r.* from public.rounds r join public.courses c on c.id = r.course_id
             where c.library_id = (select id from l) and r.tv and r.status in ('live', 'locked')
               and r.play_date = (select d from today) and public.feature_on(r.group_id, 'clubhouse_tv'))
  select json_build_object('course', (select name from l), 'rounds', coalesce((select json_agg(json_build_object(
    'id', r.id, 'format', r.format, 'status', r.status,
    'holes', (select json_agg(json_build_object('n', h -> 'n', 'par', h -> 'par', 'si', h -> 'si') order by (h ->> 'n')::int)
              from public.courses c, jsonb_array_elements(c.holes) h where c.id = r.course_id),
    'round_players', (select coalesce(json_agg(json_build_object('player_id', rp.player_id, 'playing_handicap', rp.playing_handicap)), '[]'::json)
                      from public.round_players rp where rp.round_id = r.id),
    'players', (select coalesce(json_agg(json_build_object('id', p.id, 'name', coalesce(nullif(btrim(p.nickname), ''), split_part(btrim(p.name), ' ', 1)))), '[]'::json)
                from public.players p where p.group_id = r.group_id
                  and (p.id in (select player_id from public.round_players where round_id = r.id)
                       or p.id in (select tp.player_id from public.team_players tp join public.teams t on t.id = tp.team_id where t.round_id = r.id))),
    'teams', (select coalesce(json_agg(json_build_object('id', t.id, 'handicap', t.handicap,
                       'player_ids', (select coalesce(json_agg(tp.player_id), '[]'::json) from public.team_players tp where tp.team_id = t.id))), '[]'::json)
              from public.teams t where t.round_id = r.id),
    'scores', (select coalesce(json_agg(json_build_object('subject_id', s.subject_id, 'hole', s.hole, 'strokes', s.strokes, 'picked_up', s.picked_up)), '[]'::json)
               from public.scores s where s.round_id = r.id)
  ) order by r.created_at) from r), '[]'::json))
  where exists (select 1 from l);
$$;
revoke all on function public.tv_board(text) from public;
grant execute on function public.tv_board(text) to anon, authenticated;
