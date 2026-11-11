-- Type: sending to anyone failed with "UPDATE requires a WHERE clause".
--
-- Supabase's API loads pg_safeupdate, which refuses an UPDATE without a WHERE clause, even on a
-- temporary table inside a function. type_send_message had one such line (it looks up which
-- recipients have an ELUM mailbox), so every send from the app failed with a 400 before anything
-- was saved. This adds "where true" to that line in whatever version is installed, and changes
-- nothing else. Safe to run more than once.
do $$
declare
  v_fn regprocedure := 'public.type_send_message(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,text,text)'::regprocedure;
  v_old constant text := 'set mailbox = type.mailbox_for_address(s.address);';
  v_new constant text := 'set mailbox = type.mailbox_for_address(s.address) where true;';
  v_def text := pg_get_functiondef(v_fn);
begin
  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end $$;

-- Check: says true.
select position('mailbox_for_address(s.address) where true' in pg_get_functiondef(
  'public.type_send_message(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,text,text)'::regprocedure)) > 0 as fixed;
