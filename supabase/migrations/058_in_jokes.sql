-- 058 — In-jokes (21 Oct 2026). Additive only. Feature 'in_jokes' (053).
-- A group's nicknames and running jokes ("{name}'s driver has a mind of its own"), used by award moments and round
-- replays (src/lib/injokes.js picks one for a player and a moment).
--   * Anyone in the group adds one (as themselves). The person who added it, or an organiser, edits it or retires it
--     (active = false). The app never deletes; an organiser can (e.g. to clear out something nasty for good).
--   * moment: when it can come up — any time, a birdie, a bogey, a blow-up hole, taking the lead, a win, closest to
--     the pin, longest drive, the Tribunal. player_id: who it's about (null = anyone).
--   * Keep it friendly: 2–140 characters, and a short block list of slurs and abuse (never race, religion,
--     sexuality or disability). Same list as src/lib/injokes.js (a unit test checks they match).
--   * Refused while the feature is switched off (reads stay allowed so nothing is lost).

create table if not exists public.in_jokes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  text text not null check (length(btrim(text)) between 2 and 140),
  player_id uuid references public.players(id) on delete cascade,
  moment text not null default 'any' check (moment in ('any', 'birdie', 'bogey', 'blowup', 'lead', 'win', 'ctp', 'ld', 'tribunal')),
  active boolean not null default true,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists in_jokes_group_idx on public.in_jokes (group_id);
create index if not exists in_jokes_player_idx on public.in_jokes (player_id);
create index if not exists in_jokes_created_by_idx on public.in_jokes (created_by);

-- The block list: whole words after lower-casing and undoing l33t (0→o 1→i 3→e 4→a 5→s 7→t @→a $→s !→i).
create or replace function private.in_joke_blocked(t text) returns boolean
language sql immutable set search_path = '' as $$
  select (' ' || btrim(regexp_replace(translate(lower(coalesce(t, '')), '013457@$!', 'oieastasi'), '[^a-z]+', ' ', 'g')) || ' ')
    ~ ('( )(' || array_to_string(array[
-- BLOCKED-START
      'nigger', 'nigga', 'niggers', 'niggas', 'coon', 'coons', 'chink', 'chinks', 'gook', 'gooks', 'wog', 'wogs',
      'spic', 'spics', 'kike', 'kikes', 'boong', 'boongs', 'abo', 'abos', 'paki', 'pakis', 'towelhead', 'towelheads',
      'raghead', 'ragheads', 'wetback', 'wetbacks', 'sandnigger', 'jigaboo',
      'fag', 'fags', 'faggot', 'faggots', 'poofter', 'poofters', 'dyke', 'dykes', 'tranny', 'trannies',
      'retard', 'retards', 'retarded', 'spastic', 'spastics', 'spaz', 'spazz', 'mong', 'mongs', 'mongoloid',
      'kys', 'kill yourself', 'kill urself', 'go die'
-- BLOCKED-END
    ], '|') || ')( )');
$$;
revoke all on function private.in_joke_blocked(text) from public, anon, authenticated;

-- Tidy and check each joke; whoever added it stays the same when it's edited.
create or replace function private.in_jokes_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.text := btrim(new.text);
  if tg_op = 'UPDATE' then
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

alter table public.in_jokes enable row level security;
create policy "members read" on public.in_jokes for select
  using (group_id = any ((select private.my_group_ids())::uuid[]));
-- Anyone in the group adds a joke, as themselves.
create policy "members add" on public.in_jokes for insert
  with check (group_id = any ((select private.my_group_ids())::uuid[])
              and created_by = private.my_player_id(group_id));
-- The person who added it, or an organiser, edits or retires it.
create policy "own or organiser change" on public.in_jokes for update
  using (created_by = private.my_player_id(group_id) or group_id = any ((select private.my_organiser_group_ids())::uuid[]))
  with check (created_by = private.my_player_id(group_id) or group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "organisers remove" on public.in_jokes for delete
  using (group_id = any ((select private.my_organiser_group_ids())::uuid[]));
create policy "same group only" on public.in_jokes as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
create policy "feature on: in_jokes (add)" on public.in_jokes as restrictive for insert with check (public.feature_on(group_id, 'in_jokes'));
create policy "feature on: in_jokes (change)" on public.in_jokes as restrictive for update using (public.feature_on(group_id, 'in_jokes')) with check (public.feature_on(group_id, 'in_jokes'));
create policy "feature on: in_jokes (remove)" on public.in_jokes as restrictive for delete using (public.feature_on(group_id, 'in_jokes'));
revoke all on public.in_jokes from anon;
grant select, insert, update, delete on public.in_jokes to authenticated;
create trigger aa_fill_group_id before insert or update on public.in_jokes
  for each row execute function private.fill_group_id('players:player_id');
create trigger ac_in_jokes_check before insert or update on public.in_jokes
  for each row execute function private.in_jokes_check();

alter publication supabase_realtime add table public.in_jokes;
select private.add_same_group_checks();
