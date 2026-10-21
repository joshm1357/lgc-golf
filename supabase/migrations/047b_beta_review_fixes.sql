-- 047b — review fixes for 047 (20 Oct 2026). Additive (a column rename on a table no app version reads yet).
-- 1. Feedback keeps its words when a group is deleted: delete_group (041b) empties every table with a group_id
--    column, so the column becomes from_group (the foreign key still clears it when the group goes).
-- 2. Feedback only from someone in a group (the app only offers it there), and at most 300 a day across the app, so
--    throwaway sign-ins can't bury real feedback.
-- 3. Josh's list leaves out done items in the database, so new feedback is never pushed off by old.

alter table public.beta_feedback rename column group_id to from_group;
alter index if exists public.beta_feedback_group rename to beta_feedback_from_group;

create or replace function public.send_feedback(p_kind text, p_message text, p_path text default null,
                                                p_version text default null, p_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_g uuid; v_p uuid; v_msg text := btrim(coalesce(p_message, ''));
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_kind not in ('idea', 'problem', 'like') then raise exception 'Pick what kind of feedback it is'; end if;
  if length(v_msg) < 3 then raise exception 'Type a few words first'; end if;
  if length(v_msg) > 1000 then raise exception 'Keep it under 1,000 characters'; end if;
  begin v_g := private.current_group(); exception when others then v_g := null; end;
  if v_g is null then raise exception 'Join your group first, then tell Josh'; end if;
  perform pg_advisory_xact_lock(hashtext('beta_feedback:' || v_uid::text));
  if (select count(*) from public.beta_feedback where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s 20 today — thanks! Send more tomorrow';
  end if;
  if (select count(*) from public.beta_feedback where created_at > now() - interval '1 day') >= 300 then
    raise exception 'Lots of feedback today — please try again tomorrow';
  end if;
  begin v_p := public.my_player_id(); exception when others then v_p := null; end;
  insert into public.beta_feedback (from_group, user_id, player_id, kind, message, path, version, agent)
  values (v_g, v_uid, v_p, p_kind, v_msg,
          left(split_part(split_part(coalesce(p_path, ''), '?', 1), '#/join/', 1), 200),
          left(p_version, 40), left(p_agent, 200));
end $$;
revoke all on function public.send_feedback(text, text, text, text, text) from public, anon;
grant execute on function public.send_feedback(text, text, text, text, text) to authenticated;

create or replace function public.admin_feedback(p_days int, p_include_done boolean)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
    select f.id, f.created_at, f.kind, f.message, f.path, f.version, f.agent, f.done,
           g.name as group_name, coalesce(p.nickname, p.name) as player_name
    from public.beta_feedback f
    left join public.groups g on g.id = f.from_group
    left join public.players p on p.id = f.player_id
    where f.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
      and (coalesce(p_include_done, false) or not f.done)
    order by f.created_at desc limit 200) x
  where private.is_platform_admin();
$$;
revoke all on function public.admin_feedback(int, boolean) from public, anon;
grant execute on function public.admin_feedback(int, boolean) to authenticated;

-- The one-argument version (047) stays for any phone still on it; it now reads the renamed column.
create or replace function public.admin_feedback(p_days int default 30)
returns json language sql stable security definer set search_path = '' as $$
  select public.admin_feedback(p_days, true);
$$;
