-- 031 — Stage 4: each group's look comes from the database. Additive: new columns on groups, one function, my_status
-- gains a "look". L.G.C's hard-coded look becomes its row; a new group gets the plain The Golf Trip look.

alter table public.groups add column if not exists short_name text check (short_name is null or length(short_name) between 1 and 12);
alter table public.groups add column if not exists crest_url text;        -- an uploaded crest, or 'builtin:lgc'
alter table public.groups add column if not exists colour_primary text not null default '#1F4B33'
  check (colour_primary ~ '^#[0-9A-Fa-f]{6}$');
alter table public.groups add column if not exists colour_accent text not null default '#E0B84A'
  check (colour_accent ~ '^#[0-9A-Fa-f]{6}$');
alter table public.groups add column if not exists font text not null default 'condensed'
  check (font in ('condensed', 'plain', 'old_english', 'serif'));
grant select (short_name, crest_url, colour_primary, colour_accent, font) on public.groups to authenticated;

-- L.G.C keeps exactly the look it has today.
update public.groups set short_name = 'L.G.C', crest_url = 'builtin:lgc', colour_primary = '#1C2B3F', colour_accent = '#D9A521', font = 'condensed'
where legacy;

-- The organiser sets the look. Colours are checked in the app for readability; here only their format.
create or replace function public.set_group_look(p_name text, p_short_name text, p_primary text, p_accent text, p_font text, p_crest_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group();
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can change the look'; end if;
  if coalesce(length(trim(p_name)), 0) not between 2 and 40 then raise exception 'The group name needs 2–40 characters'; end if;
  -- A crest is either the built-in L.G.C one (L.G.C only) or a photo in this group's own folder.
  if p_crest_url is not null and p_crest_url <> 'builtin:lgc'
     and p_crest_url !~ ('/storage/v1/object/public/photos/' || v_g::text || '/') then
    raise exception 'Upload the crest from this screen';
  end if;
  if p_crest_url = 'builtin:lgc' and not (select legacy from public.groups where id = v_g) then
    raise exception 'That crest belongs to L.G.C';
  end if;
  update public.groups set
    name = trim(p_name),
    short_name = nullif(trim(coalesce(p_short_name, '')), ''),
    colour_primary = p_primary, colour_accent = p_accent, font = p_font, crest_url = p_crest_url
  where id = v_g;
  if (select legacy from public.groups where id = v_g) then
    update public.settings set group_name = trim(p_name) where id = 1;  -- old phones read the name from here
  end if;
end $$;
revoke all on function public.set_group_look(text, text, text, text, text, text) from public, anon;
grant execute on function public.set_group_look(text, text, text, text, text, text) to authenticated;

-- my_status also returns the group's look, so the app can paint itself before anything else loads.
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
    'role', (select role from public.group_members where group_id = (select id from g) and user_id = auth.uid()),
    'signed_in', not coalesce((select is_anonymous from auth.users where id = auth.uid()), true),
    'look', (select json_build_object('short_name', short_name, 'crest_url', crest_url, 'primary', colour_primary,
                                      'accent', colour_accent, 'font', font)
             from public.groups where id = (select id from g)),
    'groups', coalesce((select json_agg(json_build_object('id', gr.id, 'name', gr.name, 'slug', gr.slug, 'role', gm.role) order by gm.created_at)
                        from public.group_members gm join public.groups gr on gr.id = gm.group_id
                        where gm.user_id = auth.uid()), '[]'::json)
  );
$$;
