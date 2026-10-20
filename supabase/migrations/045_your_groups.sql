-- 045 — Sign-in first, then "Your groups" (20 Oct 2026). Additive only.
-- my_status's list of groups also carries each group's crest (and whether it's L.G.C or a quick group), so the
-- Your groups screen can show each crest. Nothing else changes: same fields, same meaning; older app versions
-- ignore the extra ones. Copied from the 036 version (the latest), with three fields added to each group entry.
create or replace function public.my_status()
returns json language sql stable security definer set search_path = 'public' as $$
  with g as (select private.current_group() as id)
  select json_build_object(
    'is_member', (select id from g) is not null,
    'is_admin', coalesce(private.is_group_organiser((select id from g)), false),
    'player_id', private.my_player_id((select id from g)),
    'group_name', (select name from public.groups where id = (select id from g)),
    'group_id', (select id from g),
    'legacy', (select legacy from public.groups where id = (select id from g)),
    'quick', (select quick from public.groups where id = (select id from g)),
    'role', (select role from public.group_members where group_id = (select id from g) and user_id = auth.uid()),
    'signed_in', not coalesce((select is_anonymous from auth.users where id = auth.uid()), true),
    'look', (select json_build_object('short_name', short_name, 'crest_url', crest_url, 'primary', colour_primary,
                                      'accent', colour_accent, 'font', font)
             from public.groups where id = (select id from g)),
    'groups', coalesce((select json_agg(json_build_object('id', gr.id, 'name', gr.name, 'slug', gr.slug, 'role', gm.role,
                                                          'crest_url', gr.crest_url, 'legacy', gr.legacy, 'quick', gr.quick)
                                        order by gm.created_at)
                        from public.group_members gm join public.groups gr on gr.id = gm.group_id
                        where gm.user_id = auth.uid()), '[]'::json)
  );
$$;
-- create or replace keeps the existing grants (authenticated only, from 019/027); restated so this file stands alone.
revoke all on function public.my_status() from public, anon;
grant execute on function public.my_status() to authenticated;
