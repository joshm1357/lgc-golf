-- 003: Not-signed-in visitors can't call any app function; trigger functions aren't callable directly.
revoke execute on function
  public.is_member(), public.is_admin(), public.my_player_id(), public.my_status(),
  public.join_group(text), public.claim_admin(text), public.set_pins(text, text),
  public.create_my_player(text, text, numeric, text), public.claim_player(uuid),
  public.admin_create_player(text, text, numeric, text), public.lodge_case(uuid, numeric, text, text),
  public.set_defence(uuid, text), public.cast_vote(uuid, text, text), public.chair_close_case(uuid, text, text)
  from public, anon;
revoke execute on function public.players_handicap_guard(), public.scores_autopost() from public, anon, authenticated;
