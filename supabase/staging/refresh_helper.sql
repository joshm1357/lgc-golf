-- STAGING ONLY. Never run on live.
-- Loads rows exported from live (as a JSON array) into one staging group.
-- Columns that exist in both are copied; group_id is set to p_group; rows that already exist are skipped.
-- Run inside: begin; set local session_replication_role = replica; ... commit;
-- (replica mode skips triggers, so no birdie posts or notifications fire while loading).
create or replace function private.tmp_load(p_table text, p_rows jsonb, p_group uuid) returns int
language plpgsql set search_path = '' as $$
declare cols text; n int;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then return 0; end if;
  select string_agg(quote_ident(c.column_name), ',') into cols from information_schema.columns c
  where c.table_schema='public' and c.table_name=p_table
    and (c.column_name='group_id' or c.column_name in (select jsonb_object_keys(p_rows->0)));
  execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing', p_table, cols, cols, p_table)
    using (select jsonb_agg(r || jsonb_build_object('group_id', p_group)) from jsonb_array_elements(p_rows) r);
  get diagnostics n = row_count; return n;
end $$;
-- When finished: drop function private.tmp_load(text, jsonb, uuid);
