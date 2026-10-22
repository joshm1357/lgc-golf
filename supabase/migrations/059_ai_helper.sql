-- 059 — The AI helper (21 Oct 2026). Additive only. Part of the 'ai_helper' feature (switch added in 053).
-- One table: helper_log, a row per question to the helper (and per "Do it"), for the cap and the cost:
--   * the cap: 60 questions a group a calendar month, 10 a person a day (Sydney time), counted from this table by the
--     ai-helper edge function BEFORE it calls the model;
--   * the cost: tokens in and out, and how long it took.
-- It never holds what was asked or answered (no prompt text). Only the edge function (server key) reads or writes
-- it: RLS is on with no policies, and the app's roles have no access at all.
-- Everything else the helper does goes through the existing tables and their rules, as the person asking.

create table if not exists public.helper_log (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  mode text not null check (mode in ('setup', 'history', 'apply')),
  ok boolean not null default false,
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  ms int not null default 0 check (ms >= 0),
  created_at timestamptz not null default now()
);
create index if not exists helper_log_group_idx on public.helper_log (group_id, created_at);
create index if not exists helper_log_user_idx on public.helper_log (user_id, created_at);
alter table public.helper_log enable row level security;
-- No policies on purpose: the app can't read or write it. The edge function uses the server key.
revoke all on public.helper_log from anon, authenticated;
grant select, insert, update on public.helper_log to service_role;

-- helper_log has no links to other group tables, so this changes nothing today; it's here so the same-group checks
-- stay complete if a link is ever added.
select private.add_same_group_checks();
