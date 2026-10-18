-- 033c — Stage 6 review fixes. Replaces the two import functions (additive). Run after 033.
--  1. A past winner needs a year in its label ("2019", "Hunter 2019") — without one it can't be put in order.
--  2. Pasting the same list twice doesn't double it: exact repeats are skipped, and the number really added is
--     returned (the app says how many were already there).
--  3. "Today" allows for Australia being ahead of UTC (early morning here is still yesterday in UTC).
create or replace function public.import_honours(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); r jsonb; n int := 0;
        v_trophy text; v_label text; v_winners text;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can add history'; end if;
  perform private.require_feature(v_g, 'trophies');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'Up to 200 lines at a time'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_trophy := left(btrim(coalesce(r ->> 'trophy', '')), 60);
    v_label := left(btrim(coalesce(r ->> 'label', '')), 30);
    v_winners := left(btrim(coalesce(r ->> 'winners', '')), 200);
    if v_trophy = '' or v_label = '' or v_winners = '' then raise exception 'Each line needs a year, a trophy and the winner(s)'; end if;
    if v_label !~ '(^|[^0-9])(19[5-9][0-9]|20[0-9][0-9])([^0-9]|$)' then raise exception 'Put the year in: %', v_label; end if;
    continue when exists (select 1 from public.honour_board h where h.group_id = v_g and lower(h.trophy_name) = lower(v_trophy)
                          and lower(h.label) = lower(v_label) and lower(h.winner_names) = lower(v_winners));
    insert into public.honour_board (group_id, trophy_name, label, winner_names, player_ids, sort_key, imported, trip_id)
    values (v_g, v_trophy, v_label, v_winners,
            coalesce((select array_agg(p.id) from public.players p
                      where p.group_id = v_g and p.id::text in (select jsonb_array_elements_text(coalesce(r -> 'player_ids', '[]'::jsonb)))), '{}'),
            0, true,
            (select t.id from public.trips t where t.group_id = v_g and t.id::text = r ->> 'trip_id'));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.import_handicaps(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); r jsonb; n int := 0; v_date date; v_h numeric; v_p uuid;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can add history'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'Up to 500 lines at a time'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_p := (r ->> 'player_id')::uuid;
    if not exists (select 1 from public.players where id = v_p and group_id = v_g) then
      raise exception 'A player on the list isn''t in this group';
    end if;
    v_date := (r ->> 'date')::date;
    v_h := round((r ->> 'handicap')::numeric, 1);
    if v_date is null or v_h is null then raise exception 'Each line needs a player, a date and a handicap'; end if;
    if v_date > current_date + 1 or v_date < date '1950-01-01' then raise exception 'That date doesn''t look right (%)', v_date; end if;
    if v_h < -10 or v_h > 54 then raise exception 'A handicap of % doesn''t look right', v_h; end if;
    continue when exists (select 1 from public.handicap_history h where h.player_id = v_p and h.imported
                          and (h.created_at at time zone 'UTC')::date = v_date and h.new_handicap = v_h);
    insert into public.handicap_history (group_id, player_id, old_handicap, new_handicap, reason, created_at, imported)
    values (v_g, v_p, null, v_h, 'History (added later)', (v_date::timestamp + interval '12 hours') at time zone 'UTC', true);
    n := n + 1;
  end loop;
  return n;
end $$;
