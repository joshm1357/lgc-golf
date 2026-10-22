-- 061c — Stage 12's guardrails on Tribunal cases (21 Oct 2026). Additive only.
-- Roast the golf and the mates, never who someone is: the same block list as in-jokes (058, private.in_joke_blocked)
-- refuses a case's title, text, penalty, verdict, or a hearing post that crosses the line — from any app or the
-- connector.
create or replace function private.cases_text_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'cases' then
    if (tg_op = 'INSERT' or (new.title, new.body, new.penalty, new.verdict) is distinct from (old.title, old.body, old.penalty, old.verdict))
       and private.in_joke_blocked(concat_ws(' ', new.title, new.body, new.penalty, new.verdict, new.proposal->>'answer', new.proposal->>'title', new.proposal->>'detail')) then
      raise exception 'Keep it friendly — roast the golf and the mates, never who someone is';
    end if;
  elsif private.in_joke_blocked(new.body) then
    raise exception 'Keep it friendly — roast the golf and the mates, never who someone is';
  end if;
  return new;
end $$;
revoke all on function private.cases_text_check() from public, anon, authenticated;
create or replace trigger ad_cases_text_check before insert or update on public.cases
  for each row execute function private.cases_text_check();
create or replace trigger ad_case_posts_text_check before insert on public.case_posts
  for each row when (new.kind <> 'report') execute function private.cases_text_check();
