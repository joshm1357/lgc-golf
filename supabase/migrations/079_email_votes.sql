-- 079 — Votes by email (22 Oct 2026). Additive only: new columns, two new tables, functions. No drops or renames.
-- Josh: "For votes I think email is OK to send, and probably allow this — email vs app tick boxes — to be set."
--
--   * Each group has a default for how people get votes and trip questions: 'app' (notifications, as today),
--     'email' or 'both' (groups.vote_channel, organisers set it with set_vote_channel).
--   * Each person can override it for themselves (notify_prefs.vote_channel; null = follow the group).
--   * Email needs an address (vote_emails). A person adds their own (only they and the server can read it). An
--     organiser can type one in for a player who isn't on the app yet ("invited") — used only for trip emails, and
--     the person can remove it. Organisers never read anyone's address; they see who is on email (vote_channels()).
--   * Each vote email carries a one-person, one-vote link (vote_email_tokens: random secret, stored hashed, expires
--     when the vote closes). Only the server reads or writes that table.
--   * plan_votes.via says how a vote was cast ('app' or 'email'), for "3 people answered by email". Anything a
--     signed-in person writes is 'app'; only the server (the vote-link function) writes 'email'.

-- ------------------------------------------------------------------ The group's default
alter table public.groups add column if not exists vote_channel text not null default 'app'
  check (vote_channel in ('app', 'email', 'both'));
grant select (vote_channel) on public.groups to authenticated;

create or replace function public.set_vote_channel(p_group uuid, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.is_group_organiser(p_group), false) then raise exception 'Only an organiser can change that'; end if;
  if p_value is null or p_value not in ('app', 'email', 'both') then raise exception 'Unknown setting'; end if;
  if not public.feature_on(p_group, 'notifications') then raise exception 'Notifications are switched off for this group'; end if;
  update public.groups set vote_channel = p_value where id = p_group;
end $$;
revoke all on function public.set_vote_channel(uuid, text) from public, anon;
grant execute on function public.set_vote_channel(uuid, text) to authenticated;

-- ------------------------------------------------------------------ Each person's choice (null = the group's default)
alter table public.notify_prefs add column if not exists vote_channel text
  check (vote_channel is null or vote_channel in ('app', 'email', 'both'));

-- ------------------------------------------------------------------ Email addresses for trip emails
create table if not exists public.vote_emails (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,     -- who it belongs to ('own'); null for 'invited'
  email text check (email is null or (length(email) <= 254 and email ~* '^[^@\s<>",;]+@[^@\s<>",;]+\.[a-z]{2,}$')),  -- null = removed
  source text not null check (source in ('own', 'invited')),
  added_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (group_id, player_id)
);
create index if not exists vote_emails_player_idx on public.vote_emails (player_id);
create index if not exists vote_emails_user_idx on public.vote_emails (user_id);
alter table public.vote_emails enable row level security;
-- Only the person themselves reads their row (and the server). Changes go through the functions below.
-- Release review B2: your own address only by your sign-in (not by the player name, which someone else could take over
-- later); an address an organiser typed in is readable by whoever now has that player name.
create policy "my email" on public.vote_emails for select
  using (user_id = auth.uid() or (source = 'invited' and player_id = private.my_player_id(group_id)));
create policy "same group only" on public.vote_emails as restrictive for all
  using (group_id = any ((select private.my_group_ids())::uuid[]))
  with check (group_id = any ((select private.my_group_ids())::uuid[]));
revoke all on public.vote_emails from anon, authenticated;
grant select on public.vote_emails to authenticated;
create trigger aa_fill_group_id before insert or update on public.vote_emails
  for each row execute function private.fill_group_id('players:player_id');

-- My trip-email address in my current group, and the email I signed in with (to offer it).
create or replace function public.my_vote_email()
returns table (email text, source text, signin_email text, vote_channel text, group_default text)
language plpgsql stable security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_p uuid;
begin
  if v_g is null then return; end if;
  v_p := private.my_player_id(v_g);
  return query
    select e.email, e.source, (select u.email::text from auth.users u where u.id = auth.uid()),
           (select np.vote_channel from public.notify_prefs np where np.group_id = v_g and np.user_id = auth.uid()),
           (select g.vote_channel from public.groups g where g.id = v_g)
    from (select 1) one
    left join public.vote_emails e on e.group_id = v_g and e.player_id = v_p and v_p is not null
                                   and (e.user_id = auth.uid() or e.source = 'invited');
end $$;
revoke all on function public.my_vote_email() from public, anon;
grant execute on function public.my_vote_email() to authenticated;

-- Set (or with null / '' remove) my own address. Removing also removes one an organiser typed in for me.
create or replace function public.set_my_vote_email(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_p uuid; v_e text := lower(btrim(coalesce(p_email, '')));
begin
  if v_g is null then raise exception 'Join the group first'; end if;
  v_p := private.my_player_id(v_g);
  if v_p is null then raise exception 'Pick your name first'; end if;
  if v_e <> '' and not public.feature_on(v_g, 'notifications') then raise exception 'Notifications are switched off for this group'; end if;
  if v_e = '' then
    -- Removed: the address is wiped (the empty row just means "no email").
    update public.vote_emails set email = null where group_id = v_g and player_id = v_p;
    return;
  end if;
  insert into public.vote_emails (group_id, player_id, user_id, email, source, added_by)
  values (v_g, v_p, auth.uid(), v_e, 'own', auth.uid())
  on conflict (group_id, player_id) do update set email = excluded.email, source = 'own', user_id = excluded.user_id,
    added_by = excluded.added_by, created_at = now();
end $$;
revoke all on function public.set_my_vote_email(text) from public, anon;
grant execute on function public.set_my_vote_email(text) to authenticated;

-- An organiser types in an email for a player who isn't on the app yet (or removes it with null / '').
-- Never replaces someone's own address, and is refused once that player is on the app.
create or replace function public.set_invited_vote_email(p_player uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_e text := lower(btrim(coalesce(p_email, '')));
begin
  if v_g is null or not coalesce(private.is_group_organiser(v_g), false) then raise exception 'Only an organiser can do that'; end if;
  if not exists (select 1 from public.players where id = p_player and group_id = v_g) then raise exception 'That player isn''t in this group'; end if;
  if v_e <> '' and not public.feature_on(v_g, 'notifications') then raise exception 'Notifications are switched off for this group'; end if;
  if exists (select 1 from public.group_members where group_id = v_g and player_id = p_player) then
    raise exception 'They''re on the app — they can add their own email in Notifications';
  end if;
  if v_e = '' then
    update public.vote_emails set email = null where group_id = v_g and player_id = p_player and source = 'invited';
    return;
  end if;
  if exists (select 1 from public.vote_emails where group_id = v_g and player_id = p_player and source = 'own' and email is not null) then
    raise exception 'They''ve already added their own email';
  end if;
  insert into public.vote_emails (group_id, player_id, user_id, email, source, added_by)
  values (v_g, p_player, null, v_e, 'invited', auth.uid())
  on conflict (group_id, player_id) do update set email = excluded.email, source = 'invited', user_id = null,
    added_by = excluded.added_by, created_at = now();
end $$;
revoke all on function public.set_invited_vote_email(uuid, text) from public, anon;
grant execute on function public.set_invited_vote_email(uuid, text) to authenticated;

-- Organisers: who gets votes how. Never the address itself — only whether there is one, and for an address an
-- organiser typed in, a shortened version (j…@gmail.com) so they can tell which one it is.
create or replace function public.vote_channels()
returns table (player_id uuid, on_app boolean, choice text, has_email boolean, source text, email_hint text)
language plpgsql stable security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_def text;
begin
  if v_g is null or not coalesce(private.is_group_organiser(v_g), false) then raise exception 'Only an organiser can see that'; end if;
  select g.vote_channel into v_def from public.groups g where g.id = v_g;
  return query
    select p.id, m.user_id is not null,
           case when m.user_id is null then null else coalesce(np.vote_channel, v_def) end,
           e.email is not null and (e.source = 'invited' or e.user_id = m.user_id),
           case when e.email is not null then e.source end,
           case when e.source = 'invited' and e.email is not null then left(e.email, 1) || '…' || substring(e.email from position('@' in e.email)) end
    from public.players p
    left join public.group_members m on m.group_id = v_g and m.player_id = p.id
    left join public.notify_prefs np on np.group_id = v_g and np.user_id = m.user_id
    left join public.vote_emails e on e.group_id = v_g and e.player_id = p.id
    where p.group_id = v_g and p.approved is not false;
end $$;
revoke all on function public.vote_channels() from public, anon;
grant execute on function public.vote_channels() to authenticated;

-- ------------------------------------------------------------------ One-tap answer links (server only)
create table if not exists public.vote_email_tokens (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  batch_key text not null,                 -- the vote batch (plan_polls.vote_batch) or the single poll's id
  kind text not null default 'open' check (kind in ('open', 'reminder')),
  poll_ids uuid[] not null,
  secret_hash text not null,               -- SHA-256 of the link's secret; the secret itself is only in the email
  expires_at timestamptz not null,
  status text,                             -- 'sent', 'email not set up', 'failed: …'
  created_at timestamptz not null default now(),
  unique (batch_key, player_id, kind)
);
create index if not exists vote_email_tokens_group_idx on public.vote_email_tokens (group_id);
create index if not exists vote_email_tokens_plan_idx on public.vote_email_tokens (plan_id);
create index if not exists vote_email_tokens_player_idx on public.vote_email_tokens (player_id);
alter table public.vote_email_tokens enable row level security;
revoke all on public.vote_email_tokens from anon, authenticated;

-- ------------------------------------------------------------------ How each vote was cast
alter table public.plan_votes add column if not exists via text not null default 'app' check (via in ('app', 'email'));
create or replace function private.plan_votes_via() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A signed-in person (the app) always counts as 'app'; only the server can say 'email'.
  if auth.uid() is not null then new.via := 'app'; end if;
  return new;
end $$;
revoke all on function private.plan_votes_via() from public, anon, authenticated;
create or replace trigger ac_plan_votes_via before insert or update on public.plan_votes
  for each row execute function private.plan_votes_via();


-- Release review B2: when someone leaves (or their player name moves to another sign-in), their own address is wiped,
-- so it's never shown to, or used to email, whoever takes the name over.
create or replace function private.vote_email_on_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.player_id is not null and (tg_op = 'DELETE' or new.player_id is distinct from old.player_id or new.user_id is distinct from old.user_id) then
    update public.vote_emails set email = null
     where group_id = old.group_id and player_id = old.player_id and source = 'own' and user_id is not distinct from old.user_id;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.vote_email_on_leave() from public, anon, authenticated;
create trigger zz_vote_email_on_leave after delete or update on public.group_members
  for each row execute function private.vote_email_on_leave();

select private.add_same_group_checks();
