-- ELUM platform: what every service (Write, Type, Browse, Make, Store) shares in one Supabase project.
--
--   Accounts       public.profiles is the ELUM account (one per person, for every service).
--   Addresses      elum.addresses: every email address that reaches an account (login, Type, aliases).
--   Services       elum.services and elum.service_accounts: which services exist and who uses them.
--   Events         elum.events: one outbox for everything that happens; consumers (Type's inbox, the
--                  email sender, search indexers ...) each get their own delivery queue.
--   Notifications  elum.notifications: what people see in any service's bell.
--   Guards         elum.rate_limits and elum.audit_log.
--
-- Rules every service follows (docs/ELUM-PLATFORM.md has the full contract):
--   - Apps never read the elum schema directly. They call public.elum_* functions, which
--     check who is asking. The tables can change behind them.
--   - A service's own data lives in its own tables (Write's are in public for now; new services
--     use their own schema, such as type.*) and references accounts by public.profiles(id).
--   - Services tell each other things only through events, never by writing each other's tables.
--
-- Run after 20261019000000_preferences.sql. Safe to run once.

create schema if not exists elum;
revoke all on schema elum from public, anon, authenticated;
grant usage on schema elum to service_role;

-- Platform settings, such as the domain Type addresses live on.
create table elum.config (
  key text primary key,
  value text not null
);
insert into elum.config (key, value) values ('type_domain', 'type.elum.example');

-- ---------------------------------------------------------------- services

create table elum.services (
  id text primary key check (id ~ '^[a-z][a-z0-9]{1,30}$'),
  name text not null,
  kind text not null default 'product' check (kind in ('platform', 'product')),
  -- Brand token for the service's colour (see the brand kit).
  color_token text not null,
  url text,
  status text not null default 'planned' check (status in ('planned', 'beta', 'active', 'retired')),
  sort integer not null default 100
);

insert into elum.services (id, name, kind, color_token, status, sort) values
  ('elum', 'ELUM', 'platform', 'elum-blue', 'active', 0),
  ('write', 'Write', 'product', 'write', 'active', 10),
  ('type', 'Type', 'product', 'type', 'planned', 20),
  ('browse', 'Browse', 'product', 'browse', 'planned', 30),
  ('make', 'Make', 'product', 'make', 'planned', 40),
  ('store', 'Store', 'product', 'store', 'planned', 50);

-- Which services each account uses, and on what plan.
create table elum.service_accounts (
  account_id uuid not null references public.profiles (id) on delete cascade,
  service_id text not null references elum.services (id),
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  plan text not null default 'free',
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (account_id, service_id)
);

-- ---------------------------------------------------------------- accounts

-- The account record every service shares. account_type is set only by the server:
-- 'external' for people who sign up with their own email, 'type' for ELUM Type addresses.
alter table public.profiles
  add column handle text unique check (handle ~ '^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$'),
  add column status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  add column locale text check (char_length(locale) <= 35),
  add column time_zone text check (char_length(time_zone) <= 64),
  add column updated_at timestamptz not null default now();

comment on table public.profiles is
  'The ELUM account: one per person, shared by every ELUM service. Services reference accounts by id.';
comment on column public.profiles.handle is
  'Unique name for Type: the part before @ in the person''s Type address. Set by the server.';

-- Names nobody can take as a handle.
create table elum.reserved_handles (handle text primary key);
insert into elum.reserved_handles (handle) values
  ('admin'), ('administrator'), ('elum'), ('support'), ('help'), ('security'), ('abuse'), ('postmaster'),
  ('hostmaster'), ('webmaster'), ('noreply'), ('no-reply'), ('mailer-daemon'), ('root'), ('system'),
  ('write'), ('type'), ('browse'), ('make'), ('store'), ('billing'), ('privacy'), ('legal'), ('team'), ('hello');

-- Every address that reaches an account.
--   login    the address the person signs in with (auth.users.email)
--   type     their ELUM Type address, handle@<type_domain>
--   alias    other addresses they have verified
create table elum.addresses (
  address text primary key check (address = lower(btrim(address)) and address ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  account_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('login', 'type', 'alias')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index addresses_account_idx on elum.addresses (account_id);

-- Keeps the login address in step with Supabase Auth: added at sign-up, verified when confirmed,
-- moved when the email changes. Named to fire after on_auth_user_created, so the profile exists.
create function elum.sync_login_address() returns trigger
language plpgsql security definer set search_path = elum, public as $$
begin
  if new.email is null or not exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.email is distinct from new.email then
    delete from elum.addresses where account_id = new.id and kind = 'login' and address <> lower(new.email);
  end if;
  insert into elum.addresses (address, account_id, kind, verified_at)
  values (lower(new.email), new.id, 'login', new.email_confirmed_at)
  on conflict (address) do update
    set verified_at = coalesce(elum.addresses.verified_at, excluded.verified_at)
    where elum.addresses.account_id = excluded.account_id;
  return new;
end $$;

create trigger on_auth_user_created_address
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function elum.sync_login_address();

-- Accounts that already exist.
insert into elum.addresses (address, account_id, kind, verified_at)
select lower(u.email), u.id, 'login', u.email_confirmed_at
from auth.users u join public.profiles p on p.id = u.id
where u.email is not null
on conflict (address) do nothing;

-- The account an address belongs to, if any. Only verified addresses count, except a login
-- address (it is how the person signs in). Every service resolves people through this.
create function elum.account_for_address(p_address text) returns uuid
language sql stable security definer set search_path = elum, public as $$
  select a.account_id
  from elum.addresses a join public.profiles p on p.id = a.account_id
  where a.address = lower(btrim(p_address)) and p.status = 'active'
    and (a.verified_at is not null or a.kind = 'login')
  limit 1
$$;

-- Gives an account its Type address. Server only: Type's sign-up function calls it after
-- creating the auth user (whose email is this same address, confirmed by construction).
create function elum.assign_type_address(p_account uuid, p_handle text) returns text
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
  begin
    update public.profiles set handle = v_handle, account_type = 'type', updated_at = now() where id = p_account;
    insert into elum.addresses (address, account_id, kind, verified_at) values (v_address, p_account, 'type', now());
  exception when unique_violation then
    raise exception using errcode = 'PT409', message = 'That name is taken.';
  end;
  return v_address;
end $$;

-- How to reach an account outside an app: its Type inbox, or email at its login address.
create function elum.delivery_channel(p_account uuid) returns text
language sql stable security definer set search_path = elum, public as $$
  select case when account_type = 'type' then 'type_inbox' else 'email' end
  from public.profiles where id = p_account
$$;

-- -------------------------------------------------------------------- events

-- Every kind of event, named service.object.verb. `notify` events also create a notification
-- for their recipient from payload.notification = {title, body, link}.
create table elum.event_types (
  type text primary key check (type ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$'),
  service_id text not null references elum.services (id),
  version integer not null default 1,
  notify boolean not null default false,
  description text not null
);

insert into elum.event_types (type, service_id, notify, description) values
  ('elum.account.created', 'elum', false, 'A new ELUM account. Payload: {accountType}.'),
  ('elum.account.deleted', 'elum', false, 'An account is being deleted; services remove what is theirs.'),
  ('elum.address.verified', 'elum', false, 'An address was verified for an account. Payload: {address, kind}.'),
  ('elum.service.joined', 'elum', false, 'An account used a service for the first time. Payload: {service}.'),
  ('write.document.shared', 'write', true, 'Someone was given access to a document. Payload: {docId, title, role, notification}.'),
  ('write.document.invited', 'write', false, 'An address without an account was invited to a document. Payload: {docId, title, role}.'),
  ('write.comment.created', 'write', true, 'A comment on a document. Payload: {docId, commentId, quote, notification}.'),
  ('write.comment.replied', 'write', true, 'A reply in a comment thread. Payload: {docId, commentId, notification}.'),
  ('type.message.received', 'type', true, 'A message arrived in a Type inbox. Payload: {threadId, messageId, from, subject, notification}.');

create table elum.events (
  id bigint generated always as identity primary key,
  type text not null references elum.event_types (type),
  source text not null references elum.services (id),
  actor_id uuid references public.profiles (id) on delete set null,
  -- Who the event is for: an account, or an address with no account yet (invites).
  recipient_id uuid references public.profiles (id) on delete cascade,
  recipient_address text,
  -- What it is about, as service:kind:id (write:document:<uuid>), for grouping and clean-up.
  subject text,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 65536),
  -- The same key never makes a second event, so a retried request is safe.
  idempotency_key text unique check (char_length(idempotency_key) <= 200),
  created_at timestamptz not null default now()
);
create index events_recipient_idx on elum.events (recipient_id, created_at desc);
create index events_subject_idx on elum.events (subject);

-- Consumers: workers that act on events (Type's inbox, the email sender ...). Each matches
-- event types by pattern, such as 'write.%' or 'write.document.shared'.
create table elum.consumers (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,40}$'),
  service_id text not null references elum.services (id),
  patterns text[] not null,
  active boolean not null default true,
  description text not null
);

-- Both start switched off, so nothing queues up for a worker that does not exist yet. Each is
-- switched on (update elum.consumers set active = true where id = ...) when its worker ships.
insert into elum.consumers (id, service_id, patterns, active, description) values
  ('email', 'elum', array['write.document.shared', 'write.document.invited', 'write.comment.%'], false,
   'Emails people whose channel is email (Brevo), after checking their notification settings. Replaces Write''s send-share-emails.'),
  ('type-inbox', 'type', array['write.%', 'elum.account.%'], false,
   'Puts events for Type accounts into their Type inbox. Owned by Type.');

-- One delivery per event and consumer: a queue each worker drains at its own pace.
create table elum.deliveries (
  event_id bigint not null references elum.events (id) on delete cascade,
  consumer_id text not null references elum.consumers (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'skipped', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  finished_at timestamptz,
  primary key (event_id, consumer_id)
);
create index deliveries_ready_idx on elum.deliveries (consumer_id, available_at) where status in ('pending', 'processing');

-- Notifications people see in any service.
create table elum.notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (id) on delete cascade,
  event_id bigint references elum.events (id) on delete set null,
  service_id text not null references elum.services (id),
  type text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 1000),
  -- Where it opens: a full URL or a path inside the service.
  link text check (char_length(link) <= 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_account_idx on elum.notifications (account_id, created_at desc);

-- Per-person choice of channel for each event type. No row means the default: in-app plus
-- the account's channel (Type inbox or email).
create table elum.notification_settings (
  account_id uuid not null references public.profiles (id) on delete cascade,
  type text not null references elum.event_types (type) on delete cascade,
  in_app boolean not null default true,
  outside boolean not null default true,
  primary key (account_id, type)
);

-- Records an event, fans it out to consumers and creates its notification. Server only:
-- services call it from their own security-definer functions and triggers, or from edge
-- functions with the service role. Returns the event id (the existing one for a repeated key).
create function elum.emit(
  p_type text,
  p_actor uuid,
  p_recipient uuid,
  p_payload jsonb default '{}',
  p_subject text default null,
  p_idempotency_key text default null,
  p_recipient_address text default null
) returns bigint
language plpgsql security definer set search_path = elum, public as $$
declare
  t elum.event_types;
  v_id bigint;
  v_note jsonb;
begin
  select * into t from elum.event_types where type = p_type;
  if t.type is null then
    raise exception using errcode = 'PT400', message = format('Unknown event type %s.', p_type);
  end if;
  if p_idempotency_key is not null then
    select id into v_id from elum.events where idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;

  insert into elum.events (type, source, actor_id, recipient_id, recipient_address, subject, payload, idempotency_key)
  values (p_type, t.service_id, p_actor, p_recipient, lower(nullif(btrim(p_recipient_address), '')), p_subject, coalesce(p_payload, '{}'), p_idempotency_key)
  returning id into v_id;

  insert into elum.deliveries (event_id, consumer_id)
  select v_id, c.id from elum.consumers c
  where c.active and exists (select 1 from unnest(c.patterns) pat where p_type like pat);

  v_note := p_payload -> 'notification';
  if t.notify and p_recipient is not null and p_recipient is distinct from p_actor
     and jsonb_typeof(v_note) = 'object' and coalesce(v_note ->> 'title', '') <> ''
     and coalesce((select in_app from elum.notification_settings s where s.account_id = p_recipient and s.type = p_type), true) then
    insert into elum.notifications (account_id, event_id, service_id, type, actor_id, title, body, link)
    values (p_recipient, v_id, t.service_id, p_type, p_actor, left(v_note ->> 'title', 200), left(v_note ->> 'body', 1000), left(v_note ->> 'link', 500));
  end if;
  return v_id;
end $$;

-- Workers: take a batch, then mark each delivery done, skipped or failed.
create function elum.claim_deliveries(p_consumer text, p_limit integer default 50, p_lease_seconds integer default 120)
returns table (event_id bigint, attempts integer, type text, actor_id uuid, recipient_id uuid, recipient_address text,
               subject text, payload jsonb, created_at timestamptz, channel text)
language plpgsql security definer set search_path = elum, public as $$
begin
  return query
  with ready as (
    select d.event_id from elum.deliveries d
    where d.consumer_id = p_consumer
      and ((d.status = 'pending' and d.available_at <= now()) or (d.status = 'processing' and d.locked_until < now()))
    order by d.available_at
    limit least(greatest(p_limit, 1), 500)
    for update skip locked
  ), taken as (
    update elum.deliveries d
       set status = 'processing', attempts = d.attempts + 1, locked_until = now() + make_interval(secs => p_lease_seconds)
      from ready where d.event_id = ready.event_id and d.consumer_id = p_consumer
    returning d.event_id, d.attempts
  )
  select e.id, taken.attempts, e.type, e.actor_id, e.recipient_id, e.recipient_address, e.subject, e.payload, e.created_at,
         case when e.recipient_id is null then 'email' else elum.delivery_channel(e.recipient_id) end
  from taken join elum.events e on e.id = taken.event_id
  order by e.id;
end $$;

create function elum.finish_delivery(p_consumer text, p_event bigint, p_status text default 'done', p_error text default null)
returns void
language plpgsql security definer set search_path = elum, public as $$
declare
  v_attempts integer;
begin
  if p_status in ('done', 'skipped') then
    update elum.deliveries set status = p_status, finished_at = now(), locked_until = null, last_error = null
    where event_id = p_event and consumer_id = p_consumer;
  elsif p_status = 'retry' then
    -- Back off: 1, 2, 4 ... minutes, at most 6 hours; give up after 10 tries.
    update elum.deliveries
       set status = case when attempts >= 10 then 'failed' else 'pending' end,
           available_at = now() + least(make_interval(mins => power(2, greatest(attempts - 1, 0))::integer), interval '6 hours'),
           locked_until = null, last_error = left(p_error, 1000),
           finished_at = case when attempts >= 10 then now() end
     where event_id = p_event and consumer_id = p_consumer
    returning attempts into v_attempts;
  else
    raise exception using errcode = 'PT400', message = 'Status is done, skipped or retry.';
  end if;
end $$;

-- ------------------------------------------------------------ rate limits

create table elum.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- Counts one use of `p_key` in a fixed window; true while under `p_limit`. Signed-in callers'
-- keys are scoped to their account, so nobody can use up someone else's allowance.
create function elum.take_rate_limit(p_key text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = elum, public as $$
declare
  v_key text := case when auth.uid() is not null then auth.uid()::text || ':' || p_key else p_key end;
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into elum.rate_limits (key, window_start, count) values (v_key, v_start, 1)
  on conflict (key, window_start) do update set count = elum.rate_limits.count + 1
  returning count into v_count;
  -- Old windows are cleared now and then.
  if random() < 0.01 then delete from elum.rate_limits where window_start < now() - interval '1 day'; end if;
  return v_count <= p_limit;
end $$;

-- ----------------------------------------------------------------- audit log

-- Security-relevant changes to an account: sign-in from a new device, password or address
-- changes, handle changes, sessions revoked. Written by the server; people read their own.
create table elum.audit_log (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  service_id text references elum.services (id),
  action text not null check (action ~ '^[a-z]+\.[a-z_.]+$'),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_account_idx on elum.audit_log (account_id, created_at desc);

create function elum.audit(p_account uuid, p_action text, p_service text default 'elum', p_detail jsonb default '{}')
returns void
language sql security definer set search_path = elum, public as $$
  insert into elum.audit_log (account_id, actor_id, service_id, action, detail)
  values (p_account, auth.uid(), p_service, p_action, coalesce(p_detail, '{}'))
$$;

-- -------------------------------------------------------- account events

create function elum.on_profile_created() returns trigger
language plpgsql security definer set search_path = elum, public as $$
begin
  perform elum.emit('elum.account.created', new.id, new.id, jsonb_build_object('accountType', new.account_type),
                    'elum:account:' || new.id, 'elum.account.created:' || new.id);
  return new;
end $$;

create trigger profiles_account_created
  after insert on public.profiles
  for each row execute function elum.on_profile_created();

create function elum.on_address_verified() returns trigger
language plpgsql security definer set search_path = elum, public as $$
begin
  if new.verified_at is not null and (tg_op = 'INSERT' or old.verified_at is null) then
    perform elum.emit('elum.address.verified', new.account_id, new.account_id,
                      jsonb_build_object('address', new.address, 'kind', new.kind),
                      'elum:account:' || new.account_id, 'elum.address.verified:' || new.address || ':' || new.account_id);
  end if;
  return new;
end $$;

create trigger addresses_verified
  after insert or update of verified_at on elum.addresses
  for each row execute function elum.on_address_verified();

-- ------------------------------------------------------------- Write events

-- Shares and invites become events: notifications now, Type inbox delivery once Type exists.
-- Write's own share emails (public.share_emails) keep working alongside until the platform's
-- email consumer replaces them.
create function public.emit_write_share_event() returns trigger
language plpgsql security definer set search_path = public, elum as $$
declare
  v_title text;
  v_actor uuid;
  v_actor_name text;
begin
  select title into v_title from public.documents where id = new.doc_id;
  if tg_table_name = 'document_shares' then
    v_actor := new.added_by;
    select name into v_actor_name from public.profiles where id = v_actor;
    perform elum.emit('write.document.shared', v_actor, new.user_id,
      jsonb_build_object('docId', new.doc_id, 'title', v_title, 'role', new.role,
        'notification', jsonb_build_object(
          'title', coalesce(v_actor_name, 'Someone') || ' shared “' || coalesce(v_title, 'a document') || '” with you',
          'body', 'You can ' || case new.role when 'viewer' then 'view' when 'commenter' then 'comment' else 'edit' end || '.',
          'link', '/d/' || new.doc_id)),
      'write:document:' || new.doc_id);
  else
    perform elum.emit('write.document.invited', new.invited_by, null,
      jsonb_build_object('docId', new.doc_id, 'title', v_title, 'role', new.role),
      'write:document:' || new.doc_id, null, new.email);
  end if;
  return new;
end $$;

create trigger document_shares_event
  after insert on public.document_shares
  for each row when (new.added_by is distinct from new.user_id and current_setting('elum.claiming', true) is distinct from 'on')
  execute function public.emit_write_share_event();

create trigger document_invites_event
  after insert on public.document_invites
  for each row execute function public.emit_write_share_event();

create function public.emit_write_comment_event() returns trigger
language plpgsql security definer set search_path = public, elum as $$
declare
  v_doc uuid;
  v_title text;
  v_owner uuid;
  v_to uuid;
  v_name text;
begin
  if tg_table_name = 'comments' then
    v_doc := new.doc_id;
    select title, owner_id into v_title, v_owner from public.documents where id = v_doc;
    v_to := v_owner;
  else
    select c.doc_id, c.author_id into v_doc, v_to from public.comments c where c.id = new.comment_id;
    select title into v_title from public.documents where id = v_doc;
  end if;
  if v_to is null or v_to = new.author_id then return new; end if;
  select name into v_name from public.profiles where id = new.author_id;
  perform elum.emit(
    case when tg_table_name = 'comments' then 'write.comment.created' else 'write.comment.replied' end,
    new.author_id, v_to,
    jsonb_build_object('docId', v_doc, 'commentId', coalesce(to_jsonb(new) ->> 'comment_id', to_jsonb(new) ->> 'id'),
      'notification', jsonb_build_object(
        'title', coalesce(v_name, 'Someone') || case when tg_table_name = 'comments' then ' commented on “' else ' replied to you in “' end
                 || coalesce(v_title, 'a document') || '”',
        'body', left(new.body, 200),
        'link', '/d/' || v_doc)),
    'write:document:' || v_doc);
  return new;
end $$;

create trigger comments_event
  after insert on public.comments
  for each row execute function public.emit_write_comment_event();

create trigger comment_replies_event
  after insert on public.comment_replies
  for each row execute function public.emit_write_comment_event();

-- Sharing with any of someone's addresses (their Type address, a verified alias) reaches their account.
create or replace function public.share_by_email(p_doc uuid, p_email text, p_role text) returns jsonb
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
  if not elum.take_rate_limit('write.share_by_email', 60, 3600) then
    raise exception using errcode = 'PT429', message = 'You have shared a lot in the last hour. Try again later.';
  end if;

  select owner_id into v_owner from public.documents where id = p_doc;
  v_user := coalesce(elum.account_for_address(v_email), (select id from public.profiles where lower(email) = v_email));

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

-- --------------------------------------------------------------- public API
--
-- What apps call (supabase.rpc('elum_...')). Each acts as the signed-in person.

-- The signed-in account: profile, addresses, services and unread notifications.
create function public.elum_me() returns jsonb
language plpgsql stable security definer set search_path = elum, public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception using errcode = 'PT401', message = 'Your session has ended. Sign in again.';
  end if;
  return (
    select jsonb_build_object(
      'id', p.id, 'name', p.name, 'email', p.email, 'color', p.color, 'accountType', p.account_type,
      'handle', p.handle, 'status', p.status, 'locale', p.locale, 'timeZone', p.time_zone, 'createdAt', p.created_at,
      'addresses', coalesce((select jsonb_agg(jsonb_build_object('address', a.address, 'kind', a.kind, 'verified', a.verified_at is not null) order by a.kind, a.address)
                             from elum.addresses a where a.account_id = p.id), '[]'),
      'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status, 'joined', sa.account_id is not null,
                                                                 'plan', sa.plan, 'lastSeenAt', sa.last_seen_at) order by s.sort)
                            from elum.services s left join elum.service_accounts sa on sa.service_id = s.id and sa.account_id = p.id
                            where s.kind = 'product' and s.status <> 'retired'), '[]'),
      'unread', (select count(*) from elum.notifications n where n.account_id = p.id and n.read_at is null))
    from public.profiles p where p.id = v_me
  );
end $$;

-- Records that the signed-in person uses a service (call on every sign-in or app start).
create function public.elum_join_service(p_service text) returns jsonb
language plpgsql security definer set search_path = elum, public as $$
declare
  v_me uuid := auth.uid();
  v_new boolean;
begin
  if v_me is null then
    raise exception using errcode = 'PT401', message = 'Your session has ended. Sign in again.';
  end if;
  if not exists (select 1 from elum.services where id = p_service and kind = 'product' and status in ('beta', 'active')) then
    raise exception using errcode = 'PT400', message = 'That service is not open yet.';
  end if;
  insert into elum.service_accounts (account_id, service_id) values (v_me, p_service)
  on conflict (account_id, service_id) do update set last_seen_at = now()
  returning (xmax = 0) into v_new;
  if v_new then
    perform elum.emit('elum.service.joined', v_me, v_me, jsonb_build_object('service', p_service),
                      'elum:account:' || v_me, 'elum.service.joined:' || p_service || ':' || v_me);
  end if;
  return jsonb_build_object('service', p_service, 'joined', v_new);
end $$;

-- Notifications for the signed-in person, newest first; `p_before` pages back.
create function public.elum_notifications(p_limit integer default 30, p_before timestamptz default null, p_unread_only boolean default false)
returns table (id uuid, service_id text, type text, title text, body text, link text, created_at timestamptz, read_at timestamptz,
               actor jsonb)
language sql stable security definer set search_path = elum, public as $$
  select n.id, n.service_id, n.type, n.title, n.body, n.link, n.created_at, n.read_at,
         case when a.id is null then null else jsonb_build_object('id', a.id, 'name', a.name, 'color', a.color) end
  from elum.notifications n left join public.profiles a on a.id = n.actor_id
  where n.account_id = auth.uid()
    and (p_before is null or n.created_at < p_before)
    and (not p_unread_only or n.read_at is null)
  order by n.created_at desc
  limit least(greatest(p_limit, 1), 100)
$$;

-- Marks notifications read (all of them when `p_ids` is null). Returns how many changed.
create function public.elum_mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = elum, public as $$
declare
  v_count integer;
begin
  update elum.notifications set read_at = now()
  where account_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Changes the signed-in person's notification choice for one event type.
create function public.elum_set_notification_setting(p_type text, p_in_app boolean, p_outside boolean) returns void
language plpgsql security definer set search_path = elum, public as $$
begin
  if auth.uid() is null then
    raise exception using errcode = 'PT401', message = 'Your session has ended. Sign in again.';
  end if;
  insert into elum.notification_settings (account_id, type, in_app, outside) values (auth.uid(), p_type, p_in_app, p_outside)
  on conflict (account_id, type) do update set in_app = excluded.in_app, outside = excluded.outside;
end $$;

-- Changes account details everyone may change themselves.
create function public.elum_update_account(p_locale text default null, p_time_zone text default null) returns void
language plpgsql security definer set search_path = elum, public as $$
begin
  if auth.uid() is null then
    raise exception using errcode = 'PT401', message = 'Your session has ended. Sign in again.';
  end if;
  update public.profiles set locale = coalesce(p_locale, locale), time_zone = coalesce(p_time_zone, time_zone), updated_at = now()
  where id = auth.uid();
end $$;

-- Whether a Type handle can be taken (for Type's sign-up form).
create function public.elum_handle_available(p_handle text) returns boolean
language plpgsql stable security definer set search_path = elum, public as $$
declare
  v text := lower(btrim(p_handle));
begin
  return v ~ '^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$' and v !~ '[._-]{2}'
     and not exists (select 1 from elum.reserved_handles where handle = v)
     and not exists (select 1 from public.profiles where handle = v);
end $$;

-- Server-side wrappers for workers and edge functions (service role only).
create function public.elum_emit(p_type text, p_actor uuid, p_recipient uuid, p_payload jsonb default '{}', p_subject text default null,
                                 p_idempotency_key text default null, p_recipient_address text default null) returns bigint
language sql security definer set search_path = elum, public as $$
  select elum.emit(p_type, p_actor, p_recipient, p_payload, p_subject, p_idempotency_key, p_recipient_address)
$$;
create function public.elum_claim_deliveries(p_consumer text, p_limit integer default 50, p_lease_seconds integer default 120)
returns table (event_id bigint, attempts integer, type text, actor_id uuid, recipient_id uuid, recipient_address text,
               subject text, payload jsonb, created_at timestamptz, channel text)
language sql security definer set search_path = elum, public as $$
  select * from elum.claim_deliveries(p_consumer, p_limit, p_lease_seconds)
$$;
create function public.elum_finish_delivery(p_consumer text, p_event bigint, p_status text default 'done', p_error text default null) returns void
language sql security definer set search_path = elum, public as $$
  select elum.finish_delivery(p_consumer, p_event, p_status, p_error)
$$;
create function public.elum_assign_type_address(p_account uuid, p_handle text) returns text
language sql security definer set search_path = elum, public as $$
  select elum.assign_type_address(p_account, p_handle)
$$;

-- ------------------------------------------------------------------ grants

revoke all on all tables in schema elum from public, anon, authenticated;
revoke all on all functions in schema elum from public, anon, authenticated;
grant all on all tables in schema elum to service_role;
grant execute on all functions in schema elum to service_role;

revoke all on function public.elum_me(), public.elum_join_service(text), public.elum_notifications(integer, timestamptz, boolean),
  public.elum_mark_notifications_read(uuid[]), public.elum_set_notification_setting(text, boolean, boolean),
  public.elum_update_account(text, text), public.elum_handle_available(text),
  public.elum_emit(text, uuid, uuid, jsonb, text, text, text), public.elum_claim_deliveries(text, integer, integer),
  public.elum_finish_delivery(text, bigint, text, text), public.elum_assign_type_address(uuid, text),
  public.emit_write_share_event(), public.emit_write_comment_event()
  from public, anon, authenticated;

grant execute on function public.elum_me(), public.elum_join_service(text), public.elum_notifications(integer, timestamptz, boolean),
  public.elum_mark_notifications_read(uuid[]), public.elum_set_notification_setting(text, boolean, boolean),
  public.elum_update_account(text, text) to authenticated;
-- Type's sign-up form checks names before an account exists.
grant execute on function public.elum_handle_available(text) to anon, authenticated;
grant execute on function public.elum_emit(text, uuid, uuid, jsonb, text, text, text), public.elum_claim_deliveries(text, integer, integer),
  public.elum_finish_delivery(text, bigint, text, text), public.elum_assign_type_address(uuid, text) to service_role;

-- Live notifications: apps subscribe to their own rows with Supabase Realtime.
alter table elum.notifications enable row level security;
create policy "people see their own notifications" on elum.notifications
  for select to authenticated using (account_id = auth.uid());
grant usage on schema elum to authenticated;
grant select on elum.notifications to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table elum.notifications;
  end if;
end $$;

-- Row level security on everything else, with no client policies: server only.
alter table elum.config enable row level security;
alter table elum.services enable row level security;
alter table elum.service_accounts enable row level security;
alter table elum.reserved_handles enable row level security;
alter table elum.addresses enable row level security;
alter table elum.event_types enable row level security;
alter table elum.events enable row level security;
alter table elum.consumers enable row level security;
alter table elum.deliveries enable row level security;
alter table elum.notification_settings enable row level security;
alter table elum.rate_limits enable row level security;
alter table elum.audit_log enable row level security;
