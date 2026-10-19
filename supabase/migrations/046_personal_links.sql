-- 046 — Personal links (20 Oct 2026). Additive only: one new table and four new functions.
--
-- An organiser sends each player their OWN link. The player opens it, signs in properly (Google or an emailed code,
-- like any new user) and that sign-in is connected to their existing player: same name, scores, handicap history,
-- trophies and honour board. Nothing is copied or merged; the sign-in just points at the player (group_members).
--
-- Rules (decided with Josh, 20 Oct):
--  * Organisers only make links. A link works once and stops after 14 days. A new link replaces the old one.
--  * Only a proper sign-in can use a link (never a phone-only one): that's the point of it.
--  * The phone the player used before keeps working (it's another member row for the same player). An organiser
--    can remove it from Members once they've signed in there too.
--  * If someone has already signed in as that player, the link is refused (an organiser sorts it out).
--  * The link gives the role the player has when it's made (an organiser's link makes an organiser; the card and the
--    confirm screen say so). Unapproved players get no link.
-- Words: a "group" is a golf group; a "player" is a row in players; a "member" is a sign-in in group_members.

create table if not exists public.player_links (
  token text primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  -- The role the link gives, fixed when it's made (the player's best role then), so the organiser card can say
  -- "this link makes them an organiser" before it's sent.
  role text not null default 'player' check (role in ('organiser', 'player', 'guest'))
);
-- (staging had the first version of this table for a few hours; this adds the role there and is skipped elsewhere)
alter table public.player_links add column if not exists role text not null default 'player' check (role in ('organiser', 'player', 'guest'));
create index if not exists player_links_group_id_idx on public.player_links (group_id);
create index if not exists player_links_player_id_idx on public.player_links (player_id);
create index if not exists player_links_created_by_idx on public.player_links (created_by);
create index if not exists player_links_used_by_idx on public.player_links (used_by);
-- One live link per player.
create unique index if not exists player_links_live_idx on public.player_links (player_id) where used_at is null and revoked_at is null;
-- Only the server functions below read or write it.
alter table public.player_links enable row level security;
revoke all on public.player_links from anon, authenticated;

-- ------------------------------------------------------------------ Make (or remake) a player's link
create or replace function public.create_player_link(p_player uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_token text; v_role text;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can send personal links'; end if;
  if not exists (select 1 from public.players where id = p_player and group_id = v_g) then raise exception 'No such player'; end if;
  if exists (select 1 from public.players where id = p_player and approved is false) then
    raise exception 'Approve this player first';
  end if;
  select m.role into v_role from public.group_members m where m.group_id = v_g and m.player_id = p_player
   order by case m.role when 'organiser' then 1 when 'player' then 2 else 3 end limit 1;
  update public.player_links set revoked_at = now() where player_id = p_player and used_at is null and revoked_at is null;
  loop
    v_token := private.random_code(12);
    exit when not exists (select 1 from public.player_links where token = v_token)
          and not exists (select 1 from public.group_invites where token = v_token);
  end loop;
  insert into public.player_links (token, group_id, player_id, role) values (v_token, v_g, p_player, coalesce(v_role, 'player'));
  return v_token;
end $$;

-- ------------------------------------------------------------------ What a link is (for the "Hi Mike" screen)
-- Anyone signed in (a phone-only sign-in too) can ask, so the screen can greet them before they sign in properly.
-- A wrong token counts towards the same wrong-guess limit as PINs and invite links.
create or replace function public.player_link_info(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare v json; l public.player_links%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select * into l from public.player_links where token = upper(trim(p_token));
  if l.token is null then perform private.pin_fail('invite'); return null; end if;
  select json_build_object(
      'group_id', g.id, 'group_name', g.name,
      'player_name', coalesce(nullif(trim(p.nickname), ''), p.name),
      'state', case when l.used_at is not null then 'used' when l.revoked_at is not null then 'replaced'
                    when l.expires_at <= now() then 'expired' else 'ok' end,
      -- Already done for this sign-in. A phone-only sign-in that's already this player (the old phone) isn't done:
      -- it still has to sign in properly.
      'mine', not coalesce((select is_anonymous from auth.users where id = auth.uid()), true)
              and (l.used_by = auth.uid()
                   or exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid() and m.player_id = p.id)),
      'role', l.role,
      'signed_in', not coalesce((select is_anonymous from auth.users where id = auth.uid()), true),
      'look', json_build_object('short_name', g.short_name, 'crest_url', g.crest_url, 'primary', g.colour_primary,
                                'accent', g.colour_accent, 'font', g.font, 'name', g.name))
    into v
  from public.groups g join public.players p on p.id = l.player_id
  where g.id = l.group_id;
  return v;
end $$;

-- ------------------------------------------------------------------ Use a link: this sign-in becomes that player
create or replace function public.claim_player_link(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.player_links%rowtype;
  v_me uuid := auth.uid();
  v_role text;
  v_mine public.group_members%rowtype;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if coalesce((select is_anonymous from auth.users where id = v_me), true) then
    raise exception 'Sign in with Google or an email code first — that''s what keeps your history with you';
  end if;
  perform private.pin_check();
  select * into l from public.player_links where token = upper(trim(p_token)) for update;
  -- A wrong code: counted towards the wrong-guess limit, and null back (an exception would undo the count).
  if l.token is null then perform private.pin_fail('invite'); return null; end if;
  -- Already done (e.g. tapped twice): nothing more to do.
  if l.used_by = v_me then return l.group_id; end if;
  if l.used_at is not null then raise exception 'That link has already been used — ask your organiser for a new one'; end if;
  if l.revoked_at is not null then raise exception 'There''s a newer link for you — use the latest one your organiser sent'; end if;
  if l.expires_at <= now() then raise exception 'That link has run out (they last 14 days) — ask your organiser for a new one'; end if;
  -- Someone else has already signed in properly as this player.
  if exists (select 1 from public.group_members m join auth.users u on u.id = m.user_id
             where m.group_id = l.group_id and m.player_id = l.player_id and m.user_id <> v_me and not coalesce(u.is_anonymous, true)) then
    raise exception 'Someone has already signed in as this player — ask your organiser to sort it out';
  end if;
  select * into v_mine from public.group_members where group_id = l.group_id and user_id = v_me;
  if v_mine.user_id is not null and v_mine.player_id is not null and v_mine.player_id <> l.player_id then
    raise exception 'This sign-in is already someone else in this group — ask your organiser to sort it out';
  end if;
  -- The role the link was made with (the organiser saw it on the card when sending).
  v_role := l.role;
  if v_mine.user_id is null then
    insert into public.group_members (group_id, user_id, player_id, role) values (l.group_id, v_me, l.player_id, v_role);
  else
    update public.group_members
       set player_id = l.player_id,
           role = case when v_mine.role = 'organiser' or v_role = 'organiser' then 'organiser'
                       when v_mine.role = 'player' or v_role = 'player' then 'player' else 'guest' end
     where group_id = l.group_id and user_id = v_me;
  end if;
  update public.player_links set used_at = now(), used_by = v_me where token = l.token;
  return l.group_id;
end $$;

-- ------------------------------------------------------------------ For the organiser: who's signed in
-- Per player: signed in properly (and as which email, partly hidden), how many phone-only sign-ins, and whether a
-- link is waiting. The organiser's own group only.
create or replace function public.player_sign_ins()
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can see that'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'player_id', p.id,
      'signed_in', exists (select 1 from public.group_members m join auth.users u on u.id = m.user_id
                           where m.group_id = v_g and m.player_id = p.id and not coalesce(u.is_anonymous, true)),
      'email', (select regexp_replace(u.email, '^(.).*(@.*)$', '\1…\2') from public.group_members m join auth.users u on u.id = m.user_id
                where m.group_id = v_g and m.player_id = p.id and not coalesce(u.is_anonymous, true) and u.email is not null
                order by m.created_at limit 1),
      'phones', (select count(*) from public.group_members m join auth.users u on u.id = m.user_id
                 where m.group_id = v_g and m.player_id = p.id and coalesce(u.is_anonymous, true)),
      'link_waiting', exists (select 1 from public.player_links l where l.player_id = p.id and l.used_at is null
                              and l.revoked_at is null and l.expires_at > now()),
      'role', (select m.role from public.group_members m where m.group_id = v_g and m.player_id = p.id
               order by case m.role when 'organiser' then 1 when 'player' then 2 else 3 end limit 1),
      'link_expires', (select max(l.expires_at) from public.player_links l where l.player_id = p.id and l.used_at is null
                       and l.revoked_at is null and l.expires_at > now())
    ))
    from public.players p where p.group_id = v_g), '[]'::json);
end $$;

revoke all on function public.create_player_link(uuid), public.player_link_info(text), public.claim_player_link(text),
  public.player_sign_ins() from public, anon;
grant execute on function public.create_player_link(uuid), public.player_link_info(text), public.claim_player_link(text),
  public.player_sign_ins() to authenticated;
