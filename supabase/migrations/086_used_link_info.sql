-- 086 — Sign in first, as part of joining (ov13, 22 Oct 2026). Additive only: one new function.
--
-- The join screen now asks people to sign in first. An organiser link works once, so someone opening one that's
-- already been used (often by themselves, on another phone) should read "This link's already been used. If that was
-- you, sign in below." rather than "ask for a new one". invite_info (027/050b) says nothing for a used link (it
-- returns null, same as a wrong code), so the app couldn't tell the two apart. used_link_info says which:
--
--   used_link_info(token) → {"state": "used"}    an organiser link that's been used
--                           {"state": "expired"} an organiser link that's run out
--                           null                 anything else (a wrong code, or a link that still works)
--
-- Nothing about the group or who used it is given back. It takes the same wrong-guess limit as invite links
-- (pin_check), but doesn't count a try itself: invite_info has already counted it for a wrong code.
-- Old app versions never call it. Words: "organiser link" = a row in organiser_invites (049).

create or replace function public.used_link_info(p_token text)
returns json language plpgsql stable security definer set search_path = '' as $$
declare o public.organiser_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform private.pin_check();
  select * into o from public.organiser_invites where token = upper(trim(coalesce(p_token, '')));
  if o.token is null then return null; end if;
  if o.used_at is not null then return json_build_object('state', 'used'); end if;
  if o.expires_at <= now() then return json_build_object('state', 'expired'); end if;
  return null;
end $$;

revoke all on function public.used_link_info(text) from public, anon;
grant execute on function public.used_link_info(text) to authenticated;
