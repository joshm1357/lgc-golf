-- 031b — Stage 4 review fixes. Additive: replaces two functions.
--  1. A crest must be an image uploaded into this group's own crest folder on this project's storage — the whole URL
--     is checked (anchored, no "..", length capped) and the file must exist. Stops outside images (tracking, or
--     swapped later) being loaded on every member's phone.
--  2. invite_info also returns the group's look, so an invite shows the inviting group's crest and colours.
-- Colours: the server checks only their format; the app refuses unreadable pairs (theme.js lookProblems). A deliberate
-- choice — an organiser calling the function directly only affects their own group.

create or replace function public.set_group_look(p_name text, p_short_name text, p_primary text, p_accent text, p_font text, p_crest_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_g uuid := private.current_group(); v_path text;
begin
  if not private.is_group_organiser(v_g) then raise exception 'Only an organiser can change the look'; end if;
  if coalesce(length(trim(p_name)), 0) not between 2 and 40 then raise exception 'The group name needs 2–40 characters'; end if;
  if p_crest_url = 'builtin:lgc' then
    if not (select legacy from public.groups where id = v_g) then raise exception 'That crest belongs to L.G.C'; end if;
  elsif p_crest_url is not null then
    v_path := substring(p_crest_url from '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/photos/(' || v_g::text || '/crest/[A-Za-z0-9_-]+\.(?:jpg|png|webp))$');
    if length(p_crest_url) > 300 or v_path is null
       or not exists (select 1 from storage.objects where bucket_id = 'photos' and name = v_path) then
      raise exception 'Upload the crest from this screen';
    end if;
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

create or replace function public.invite_info(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare v json;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select json_build_object('group_id', g.id, 'group_name', g.name, 'role', i.role,
           'already_in', exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid()),
           'look', json_build_object('short_name', g.short_name, 'crest_url', g.crest_url, 'primary', g.colour_primary,
                                     'accent', g.colour_accent, 'font', g.font, 'name', g.name))
    into v
  from public.group_invites i join public.groups g on g.id = i.group_id
  where i.token = upper(trim(p_token)) and i.revoked_at is null;
  if v is null then perform private.pin_fail('invite'); end if;
  return v;
end $$;
