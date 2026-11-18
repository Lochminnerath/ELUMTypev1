-- ELUM's own domain is elum.space, and Type addresses live on it directly: theo@elum.space.
--
-- Before this, Type addresses lived on type.elum.services (and, earlier still, type.elum.example).
-- This sets type_domain to elum.space and moves every account on an old Type domain, everywhere
-- the address is stored, so people keep signing in with their handle and replies still reach them.
-- It also reserves more names, now that Type shares its domain with the rest of ELUM.
-- Safe to run more than once. It changes nothing for a database that already chose another domain.
do $$
declare
  v_new constant text := 'elum.space';
  v_old text;
  v_moved int;
begin
  update elum.config set value = v_new
  where key = 'type_domain' and value in ('type.elum.services', 'type.elum.example');
  if (select value from elum.config where key = 'type_domain') is distinct from v_new then
    return;
  end if;

  foreach v_old in array array['type.elum.services', 'type.elum.example'] loop
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

    if v_moved > 0 then
      raise notice 'Moved % Type account(s) from % to %.', v_moved, v_old, v_new;
    end if;
  end loop;
end $$;

-- Names that now sit next to ELUM's own mail on elum.space.
insert into elum.reserved_handles (handle) values
  ('account'), ('accounts'), ('inquire'), ('tune'), ('code'), ('capture'), ('console'), ('status'),
  ('info'), ('contact'), ('news'), ('press'), ('mail'), ('email'), ('dmarc'), ('sales'), ('careers'),
  ('jobs'), ('staff'), ('www')
on conflict (handle) do nothing;
