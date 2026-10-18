-- Type accounts made while Type addresses lived on type.elum.example keep signing in.
--
-- type-signup creates the auth user as handle@<type_domain>, and a handle signs in as that address.
-- Moving type_domain to type.elum.services (platform-changes/20261021120000) left earlier accounts
-- on handle@type.elum.example, so signing in with the handle looked for an address that did not
-- exist. This moves them, everywhere the address is stored, to the current domain.
-- Safe to run more than once, and does nothing while type_domain is still type.elum.example.
do $$
declare
  v_old constant text := 'type.elum.example';
  v_new text := (select value from elum.config where key = 'type_domain');
  v_moved int;
begin
  if v_new is null or v_new = v_old then
    return;
  end if;

  -- The address book first: the Type address row moves, so the login sync below finds it in place.
  update elum.addresses set address = split_part(address, '@', 1) || '@' || v_new
  where address like '%@' || v_old
    and not exists (select 1 from elum.addresses taken where taken.address = split_part(elum.addresses.address, '@', 1) || '@' || v_new);

  update type.mailboxes set address = split_part(address, '@', 1) || '@' || v_new
  where address like '%@' || v_old
    and not exists (select 1 from type.mailboxes taken where taken.address = split_part(type.mailboxes.address, '@', 1) || '@' || v_new);

  -- Their own place in each conversation, so replies still reach them.
  update type.participants pa set address = mb.address
  from type.mailboxes mb
  where pa.mailbox_id = mb.id and pa.address like '%@' || v_old and pa.address <> mb.address
    and not exists (select 1 from type.participants other where other.thread_id = pa.thread_id and other.address = mb.address);

  -- The sign-in address. Triggers keep profiles.email and the login address in step.
  update auth.users set email = split_part(email, '@', 1) || '@' || v_new
  where email like '%@' || v_old
    and not exists (select 1 from auth.users taken where taken.email = split_part(auth.users.email, '@', 1) || '@' || v_new);
  get diagnostics v_moved = row_count;

  -- Supabase keeps a copy of the email on the identity.
  if to_regclass('auth.identities') is not null then
    update auth.identities i set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(u.email))
    from auth.users u
    where i.user_id = u.id and i.provider = 'email' and i.identity_data ->> 'email' like '%@' || v_old;
  end if;

  raise notice 'Moved % Type account(s) from % to %.', v_moved, v_old, v_new;
end $$;
