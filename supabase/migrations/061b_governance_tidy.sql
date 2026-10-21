-- 061b — Governance tidy-ups (21 Oct 2026). Additive only.
-- 1. Assistants never vote, decide or approve: the service role (the connector's key) can't run those functions at
--    all, even if a future connector tool tried. (They already need a signed-in person in the group.)
-- 2. Rule history: a proposer editing their rule while it's up for a vote is recorded as 'changed', not a second
--    'proposed'.
revoke execute on function public.vote_case(uuid, text, text), public.decide_case(uuid, text, text), public.approve_mid_trip(uuid),
  public.cast_vote(uuid, text, text), public.chair_close_case(uuid, text, text)
from service_role;

create or replace function private.gov_rule_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ver int; v_event text; v_case uuid := nullif(current_setting('app.gov_case', true), '')::uuid; v_wording boolean;
begin
  begin
    if tg_op = 'INSERT' then
      v_ver := 1;
      v_event := case new.status when 'proposed' then 'proposed' when 'active' then 'added' else new.status end;
      if v_event not in ('proposed','added','rejected','retired') then v_event := 'recorded'; end if;
    else
      v_wording := (new.title, new.detail, new.value, new.category, new.applies_to) is distinct from (old.title, old.detail, old.value, old.category, old.applies_to);
      if not v_wording and new.status is not distinct from old.status then return new; end if;
      select coalesce(max(version), 0) into v_ver from public.rule_versions where rule_id = new.id;
      if v_ver = 0 then v_ver := 1; elsif v_wording and old.status = 'active' then v_ver := v_ver + 1; end if;
      v_event := case
        when new.status is distinct from old.status and new.status = 'active' and old.status = 'proposed' then 'adopted'
        when new.status is distinct from old.status and new.status = 'active' then 'restored'
        when new.status is distinct from old.status and new.status = 'retired' then 'retired'
        when new.status is distinct from old.status and new.status = 'rejected' then 'rejected'
        when new.status is distinct from old.status and new.status = 'proposed' then 'proposed'
        else 'changed' end;
    end if;
    insert into public.rule_versions (group_id, rule_id, version, event, title, detail, value, category, applies_to, status, case_id, changed_by, note)
    values (new.group_id, new.id, v_ver, v_event, new.title, new.detail, new.value, new.category, new.applies_to, new.status,
      coalesce(v_case, (select id from public.cases where rule_id = new.id order by created_at desc limit 1)),
      private.my_player_id(new.group_id), new.decision_note);
  exception when others then
    raise warning 'rule history: %', sqlerrm;   -- never stop a Rulebook change from an old app
  end;
  return new;
end $$;
revoke all on function private.gov_rule_history() from public, anon, authenticated;
