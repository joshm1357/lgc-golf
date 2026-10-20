-- 047 — Stage 1, the L.G.C beta (20 Oct 2026). Additive only: older app versions keep working.
-- 1. A switch for new groups. Off until Stage 2 (friends' beta): while it's off, only Josh (a platform admin) can
--    start a group or a quick round. Groups made by migrations or the SQL editor (no signed-in user) aren't affected.
--    Staging turns it on after this runs:  update private.platform_flags set is_on = true where key = 'new_groups_open';
-- 2. "Tell Josh": beta feedback from inside the app, read on Josh's screen.

-- 1. The switch ------------------------------------------------------------------------------------------------
create table if not exists private.platform_flags (
  key text primary key,
  is_on boolean not null default false,
  note text
);
revoke all on private.platform_flags from public, anon, authenticated;
insert into private.platform_flags (key, is_on, note)
values ('new_groups_open', false, 'Anyone may start a group or a quick round. Off until Stage 2 (friends'' beta).')
on conflict (key) do nothing;

create or replace function private.flag_on(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_on from private.platform_flags where key = p_key), false);
$$;
revoke all on function private.flag_on(text) from public, anon, authenticated;

create or replace function private.new_groups_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Only people using the app are stopped; migrations and the SQL editor have no signed-in user.
  if auth.uid() is not null and not private.flag_on('new_groups_open') and not private.is_platform_admin() then
    raise exception 'The Golf Trip is invite-only while we test it. Got an invite link? Open it to join your group.';
  end if;
  return new;
end $$;
revoke all on function private.new_groups_guard() from public, anon, authenticated;

create or replace trigger groups_new_groups_guard before insert on public.groups
  for each row execute function private.new_groups_guard();

-- So the app can say so before anyone fills in the wizard.
create or replace function public.new_groups_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.flag_on('new_groups_open') or private.is_platform_admin();
$$;
revoke all on function public.new_groups_open() from public;
grant execute on function public.new_groups_open() to anon, authenticated;

-- 2. Feedback -------------------------------------------------------------------------------------------------------
create table if not exists public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  group_id uuid references public.groups(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,   -- deleting an account keeps the words, not who wrote them
  player_id uuid references public.players(id) on delete set null,
  kind text not null check (kind in ('idea', 'problem', 'like')),
  message text not null check (length(message) between 3 and 1000),
  path text,
  version text,
  agent text,
  done boolean not null default false
);
alter table public.beta_feedback enable row level security;   -- no rules: only the functions below touch it
revoke all on public.beta_feedback from anon, authenticated;
create index if not exists beta_feedback_created on public.beta_feedback (created_at desc);
create index if not exists beta_feedback_user on public.beta_feedback (user_id);
create index if not exists beta_feedback_group on public.beta_feedback (group_id);
create index if not exists beta_feedback_player on public.beta_feedback (player_id);

create or replace function public.send_feedback(p_kind text, p_message text, p_path text default null,
                                                p_version text default null, p_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_g uuid; v_p uuid; v_msg text := btrim(coalesce(p_message, ''));
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_kind not in ('idea', 'problem', 'like') then raise exception 'Pick what kind of feedback it is'; end if;
  if length(v_msg) < 3 then raise exception 'Type a few words first'; end if;
  if length(v_msg) > 1000 then raise exception 'Keep it under 1,000 characters'; end if;
  perform pg_advisory_xact_lock(hashtext('beta_feedback:' || v_uid::text));
  if (select count(*) from public.beta_feedback where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s 20 today — thanks! Send more tomorrow';
  end if;
  begin v_g := private.current_group(); exception when others then v_g := null; end;
  begin v_p := public.my_player_id(); exception when others then v_p := null; end;
  insert into public.beta_feedback (group_id, user_id, player_id, kind, message, path, version, agent)
  values (v_g, v_uid, v_p, p_kind, v_msg,
          left(split_part(split_part(coalesce(p_path, ''), '?', 1), '#/join/', 1), 200),
          left(p_version, 40), left(p_agent, 200));
end $$;
revoke all on function public.send_feedback(text, text, text, text, text) from public, anon;
grant execute on function public.send_feedback(text, text, text, text, text) to authenticated;

-- Josh's screen: newest first, with the group and player's name.
create or replace function public.admin_feedback(p_days int default 30)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
    select f.id, f.created_at, f.kind, f.message, f.path, f.version, f.agent, f.done,
           g.name as group_name, coalesce(p.nickname, p.name) as player_name
    from public.beta_feedback f
    left join public.groups g on g.id = f.group_id
    left join public.players p on p.id = f.player_id
    where f.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
    order by f.created_at desc limit 200) x
  where private.is_platform_admin();
$$;
revoke all on function public.admin_feedback(int) from public, anon;
grant execute on function public.admin_feedback(int) to authenticated;

create or replace function public.admin_feedback_done(p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Only Josh can do that'; end if;
  update public.beta_feedback set done = coalesce(p_done, true) where id = p_id;
end $$;
revoke all on function public.admin_feedback_done(uuid, boolean) from public, anon;
grant execute on function public.admin_feedback_done(uuid, boolean) to authenticated;
