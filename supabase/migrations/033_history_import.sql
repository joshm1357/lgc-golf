-- 033 — Stage 6: history import. Additive: two columns on honour_board, one on handicap_history, two functions.
-- (Removing a mistyped history handicap is in 033b — it has a delete, so it's pasted by hand like 027b.)
-- Organisers add past winners (per trophy and year) and past handicaps, by hand or by pasting a list. The honour board
-- and Trophy Room show imported and app-made history together (ordered by year in the app).

-- Winners can be linked to the trip they were won on (app-made ones are, from now), so past trips can show them.
alter table public.honour_board add column if not exists trip_id uuid references public.trips(id) on delete set null;
alter table public.honour_board add column if not exists imported boolean not null default false;
create index if not exists honour_board_trip_idx on public.honour_board (trip_id);
select private.add_same_group_checks();   -- the trip must be the group's own

alter table public.handicap_history add column if not exists imported boolean not null default false;

-- Past winners: [{ "trophy": "BD", "label": "2019", "winners": "Josh M & Mike M", "player_ids": [...], "trip_id": … }, …]
-- (up to 200 at a time). player_ids and trip_id are optional; only this group's players and trips are kept.
create or replace function public.import_honours(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); r jsonb; n int := 0;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can add history'; end if;
  perform private.require_feature(v_g, 'trophies');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'Up to 200 lines at a time'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if coalesce(btrim(r ->> 'trophy'), '') = '' or coalesce(btrim(r ->> 'label'), '') = '' or coalesce(btrim(r ->> 'winners'), '') = '' then
      raise exception 'Each line needs a year, a trophy and the winner(s)';
    end if;
    insert into public.honour_board (group_id, trophy_name, label, winner_names, player_ids, sort_key, imported, trip_id)
    values (v_g, left(btrim(r ->> 'trophy'), 60), left(btrim(r ->> 'label'), 30), left(btrim(r ->> 'winners'), 200),
            coalesce((select array_agg(p.id) from public.players p
                      where p.group_id = v_g and p.id::text in (select jsonb_array_elements_text(coalesce(r -> 'player_ids', '[]'::jsonb)))), '{}'),
            0, true,
            (select t.id from public.trips t where t.group_id = v_g and t.id::text = r ->> 'trip_id'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.import_honours(jsonb) from public, anon;
grant execute on function public.import_honours(jsonb) to authenticated;

-- Past handicaps: [{ "player_id": "…", "date": "2023-06-01", "handicap": 14.2 }, …]. History only — today's handicaps
-- don't change (they only change through the admin or the Tribunal, as before).
create or replace function public.import_handicaps(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); r jsonb; n int := 0; v_date date; v_h numeric;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can add history'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'Up to 500 lines at a time'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if not exists (select 1 from public.players where id = (r ->> 'player_id')::uuid and group_id = v_g) then
      raise exception 'A player on the list isn''t in this group';
    end if;
    v_date := (r ->> 'date')::date;
    v_h := (r ->> 'handicap')::numeric;
    if v_date is null or v_h is null then raise exception 'Each line needs a player, a date and a handicap'; end if;
    if v_date > current_date or v_date < date '1950-01-01' then raise exception 'That date doesn''t look right (%)', v_date; end if;
    if v_h < -10 or v_h > 54 then raise exception 'A handicap of % doesn''t look right', v_h; end if;
    insert into public.handicap_history (group_id, player_id, old_handicap, new_handicap, reason, created_at, imported)
    values (v_g, (r ->> 'player_id')::uuid, null, v_h, 'History (added later)', v_date::timestamptz + interval '12 hours', true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.import_handicaps(jsonb) from public, anon;
grant execute on function public.import_handicaps(jsonb) to authenticated;
