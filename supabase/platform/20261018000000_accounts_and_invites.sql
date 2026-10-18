-- ELUM Write: account types, sharing with people who have no account yet, and share emails.
--
-- - Every profile records its account type: 'type' (an ELUM Type inbox, coming later)
--   or 'external' (the person's own email provider). Both have a name.
-- - Editors can share with any email address. If no account uses it yet, an invite waits;
--   it becomes real access only once someone verifies that address.
-- - Shares and invites queue an email in public.share_emails. The send-share-emails edge
--   function (supabase/functions) delivers them through Brevo.
--
-- Run after 20261017000000_elum_write.sql. Safe to run once.

-- ---------------------------------------------------------- account types

alter table public.profiles
  add column account_type text not null default 'external' check (account_type in ('type', 'external'));

comment on column public.profiles.account_type is
  'type: an ELUM Type inbox (sign-in through the inbox, not built yet). external: the person''s own email provider.';

-- ----------------------------------------------------------------- invites

create table public.document_invites (
  doc_id uuid not null references public.documents (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  role text not null check (role in ('viewer', 'commenter', 'editor')),
  invited_at timestamptz not null default now(),
  invited_by uuid default auth.uid() references public.profiles (id) on delete set null,
  primary key (doc_id, email)
);

create index document_invites_email_idx on public.document_invites (email);

alter table public.document_invites enable row level security;
revoke all on public.document_invites from anon, authenticated;
-- Invites are created through share_by_email(); people with access can see and manage them.
grant select, delete on public.document_invites to authenticated;
grant update (role) on public.document_invites to authenticated;
create policy "see pending invites" on public.document_invites
  for select to authenticated using (public.has_doc_role(doc_id, 'viewer'));
create policy "editors change invites" on public.document_invites
  for update to authenticated using (public.has_doc_role(doc_id, 'editor')) with check (public.has_doc_role(doc_id, 'editor'));
create policy "editors cancel invites" on public.document_invites
  for delete to authenticated using (public.has_doc_role(doc_id, 'editor'));

-- Shares a document with an email address: directly when an account uses it, otherwise as an invite.
-- Returns {"kind": "share", "userId": ...} or {"kind": "invite", "email": ...}.
create function public.share_by_email(p_doc uuid, p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(p_email));
  v_owner uuid;
  v_user uuid;
begin
  if not public.has_doc_role(p_doc, 'editor') then
    raise exception using errcode = 'PT403', message = 'Only the owner and editors can add people.';
  end if;
  if p_role not in ('viewer', 'commenter', 'editor') then
    raise exception using errcode = 'PT400', message = 'Choose a role.';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception using errcode = 'PT400', message = 'Enter a valid email address.';
  end if;

  select owner_id into v_owner from public.documents where id = p_doc;
  select id into v_user from public.profiles where lower(email) = v_email;

  if v_user is not null then
    if v_user = v_owner then
      raise exception using errcode = 'PT400', message = 'The owner already has full access.';
    end if;
    insert into public.document_shares (doc_id, user_id, role, added_by)
    values (p_doc, v_user, p_role, auth.uid())
    on conflict (doc_id, user_id) do update set role = excluded.role;
    return jsonb_build_object('kind', 'share', 'userId', v_user);
  end if;

  insert into public.document_invites (doc_id, email, role, invited_by)
  values (p_doc, v_email, p_role, auth.uid())
  on conflict (doc_id, email) do update set role = excluded.role;
  return jsonb_build_object('kind', 'invite', 'email', v_email);
end $$;

grant execute on function public.share_by_email(uuid, text, text) to authenticated;

-- Only a verified address claims invites: at sign-up when confirmation is off,
-- when the confirmation link is followed, or when a changed email is confirmed.
create function public.handle_email_verified() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null or old.email is distinct from new.email) then
    perform public.claim_invites(new.id, new.email);
  end if;
  return new;
end $$;

-- Named to fire after on_auth_user_created, so the profile exists first.
create trigger on_auth_user_verified
  after insert or update of email_confirmed_at, email on auth.users
  for each row execute function public.handle_email_verified();

-- ------------------------------------------------------------ share emails

-- One row per email to send. Only the server (service role) reads or writes it.
create table public.share_emails (
  id bigint generated always as identity primary key,
  doc_id uuid not null references public.documents (id) on delete cascade,
  kind text not null check (kind in ('shared', 'invited')),
  to_email text not null,
  to_user uuid references public.profiles (id) on delete cascade,
  role text not null,
  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create index share_emails_unsent_idx on public.share_emails (created_at) where sent_at is null;

alter table public.share_emails enable row level security;
revoke all on public.share_emails from anon, authenticated;

create function public.queue_share_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'document_shares' then
    insert into public.share_emails (doc_id, kind, to_email, to_user, role, sent_by)
    select new.doc_id, 'shared', p.email, p.id, new.role, new.added_by
    from public.profiles p where p.id = new.user_id;
  else
    insert into public.share_emails (doc_id, kind, to_email, role, sent_by)
    values (new.doc_id, 'invited', new.email, new.role, new.invited_by);
  end if;
  return new;
end $$;

-- New access only. Role changes do not email, and neither do claimed invites
-- (claim_invites sets elum.claiming): they were emailed when the invite was sent.
create trigger document_shares_email
  after insert on public.document_shares
  for each row when (new.added_by is distinct from new.user_id and current_setting('elum.claiming', true) is distinct from 'on')
  execute function public.queue_share_email();

create trigger document_invites_email
  after insert on public.document_invites
  for each row execute function public.queue_share_email();

-- Turns invites for a verified address into shares. Keeps the higher role if both exist.
create function public.claim_invites(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('elum.claiming', 'on', true);
  insert into public.document_shares (doc_id, user_id, role, added_at, added_by)
  select i.doc_id, p_user, i.role, i.invited_at, i.invited_by
  from public.document_invites i
  join public.documents d on d.id = i.doc_id
  where i.email = lower(p_email) and d.owner_id <> p_user
  on conflict (doc_id, user_id) do update
    set role = case when public.role_rank(excluded.role) > public.role_rank(document_shares.role)
                    then excluded.role else document_shares.role end;
  delete from public.document_invites where email = lower(p_email);
  perform set_config('elum.claiming', 'off', true);
end $$;

revoke execute on function public.queue_share_email(), public.handle_email_verified(), public.claim_invites(uuid, text)
  from public, anon, authenticated;

