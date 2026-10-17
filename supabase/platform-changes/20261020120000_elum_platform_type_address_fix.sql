-- Platform fix needed by ELUM Type. Belongs in the platform migrations (the Write repository today);
-- kept here until it moves, and applied by supabase/tests/run.sh.
--
-- The bug: Type's sign-up creates the auth user with email = handle@<type_domain> (handoff 3.4), so
-- elum.sync_login_address has already stored that address as kind 'login' when
-- elum.assign_type_address runs. Its insert then hits the primary key and every Type sign-up fails
-- with "That name is taken." The fix: the same account's own login row becomes its Type address.
create or replace function elum.assign_type_address(p_account uuid, p_handle text) returns text
language plpgsql security definer set search_path = elum, public as $$
declare
  v_handle text := lower(btrim(p_handle));
  v_address text;
begin
  if v_handle !~ '^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$' or v_handle ~ '[._-]{2}' then
    raise exception using errcode = 'PT400', message = 'Handles are 3 to 30 letters, numbers, dots, dashes or underscores.';
  end if;
  if exists (select 1 from elum.reserved_handles where handle = v_handle) then
    raise exception using errcode = 'PT409', message = 'That name is not available.';
  end if;
  v_address := v_handle || '@' || (select value from elum.config where key = 'type_domain');
  if exists (select 1 from elum.addresses where address = v_address and account_id <> p_account) then
    raise exception using errcode = 'PT409', message = 'That name is taken.';
  end if;
  begin
    update public.profiles set handle = v_handle, account_type = 'type', updated_at = now() where id = p_account;
    insert into elum.addresses (address, account_id, kind, verified_at) values (v_address, p_account, 'type', now())
    on conflict (address) do update set kind = 'type', verified_at = coalesce(elum.addresses.verified_at, now())
      where elum.addresses.account_id = p_account;
  exception when unique_violation then
    raise exception using errcode = 'PT409', message = 'That name is taken.';
  end;
  return v_address;
end $$;
