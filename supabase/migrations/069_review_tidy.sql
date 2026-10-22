-- 069 — Review tidy-ups for the overnight features (21 Oct 2026). Additive (function changes only). Run after 054–058.
--  * "Delete my account" with "remove my name" also covers the new tables: award titles, award photos they took,
--    in-jokes by or about them (retired, words cleared).
--  * In-jokes: removing a player no longer leaves a joke pointing at them (the trigger let the database's own
--    "set to empty" through).

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
  -- 069: the overnight features. Award titles say the name like auto posts do; jokes by or about them are retired
  -- (and their words cleared); award photos they took come off.
  if to_regclass('public.award_moments') is not null then
    execute 'update public.award_moments set title = regexp_replace(title, $1, ''Former player'', ''g''), detail = regexp_replace(coalesce(detail, ''''), $1, ''Former player'', ''g'')
              where group_id = $2 and (title ~ $1 or detail ~ $1)' using v_pat, p.group_id;
    execute 'update public.award_moments set photo_url = null, photo_by = null where group_id = $1 and photo_by = $2' using p.group_id, p_player;
  end if;
  if to_regclass('public.in_jokes') is not null then
    execute 'update public.in_jokes set active = false, text = ''(removed)'', player_id = null
              where group_id = $1 and (player_id = $2 or created_by = $2)' using p.group_id, p_player;
  end if;
  update public.players set name = 'Former player', nickname = null, avatar_url = null where id = p_player;
end $$;
revoke all on function private.forget_player_name(uuid) from public, anon, authenticated;

create or replace function private.in_jokes_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.text := btrim(new.text);
  -- 069: only a person's own edit keeps who added it; the database's own "set to empty" when a player is removed
  -- (a nested trigger) is let through, so no joke keeps pointing at a deleted player.
  if tg_op = 'UPDATE' and pg_trigger_depth() = 1 then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := coalesce(new.created_by, private.my_player_id(new.group_id));
  end if;
  if length(new.text) < 2 or length(new.text) > 140 then
    raise exception 'Keep a joke between 2 and 140 characters';
  end if;
  if (tg_op = 'INSERT' or new.text is distinct from old.text) and private.in_joke_blocked(new.text) then
    raise exception 'Keep it friendly — roast the golf, not who someone is';
  end if;
  return new;
end $$;
revoke all on function private.in_jokes_check() from public, anon, authenticated;
