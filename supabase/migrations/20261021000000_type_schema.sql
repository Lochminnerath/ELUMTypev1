-- ELUM Type: messaging and email, on the shared ELUM platform.
--
--   Mailboxes      type.mailboxes: an account's addresses in Type. A Type account's mailbox is its
--                  Type address and can email anyone; an external account's mailbox is its login
--                  address and talks to ELUM people only (sending as Gmail would fail DMARC).
--   Threads        type.threads, type.participants: conversations, and each person's state in them
--                  (folder, read, muted).
--   Messages       type.messages with type.message_recipients: which mailboxes hold a copy. People
--                  see only messages that were sent to them, so a Bcc stays a Bcc and someone added
--                  later does not read what came before.
--   Outbox         type.outbox: one row per outside address, drained by the type-send edge function.
--   Drafts         type.drafts, saved as people type, with a version for conflict checks.
--   Inbox cards    type.inbox_cards: platform events (Write shares, comments ...) shown in the inbox.
--
-- Rules (docs/TYPE.md has the full story):
--   - Apps never write these tables. They read through the public.type_* functions, and Realtime
--     reads messages, participants and cards under the row level security below.
--   - Edge functions use the service-role functions at the end (receive, outbox, cards).
--   - Type talks to other services only through elum.emit and the platform's deliveries.
--
-- Run after 20261020000000_elum_platform.sql (in the Write repository). Safe to run once.

create schema type;
revoke all on schema type from public, anon;
grant usage on schema type to authenticated, service_role;

-- Type opens when this migration is applied. Set the URL once the family domain is chosen.
update elum.services set status = 'beta' where id = 'type' and status = 'planned';

-- ------------------------------------------------------------------ tables

create table type.mailboxes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  address text not null unique check (address = lower(btrim(address)) and address ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  signature text check (char_length(signature) <= 2000),
  -- True for Type addresses: ELUM owns the domain, so mail can go to and come from anyone.
  can_email boolean not null default false,
  created_at timestamptz not null default now()
);
create index mailboxes_owner_idx on type.mailboxes (owner_id);

create table type.preferences (
  account_id uuid primary key references public.profiles (id) on delete cascade,
  default_mailbox uuid references type.mailboxes (id) on delete set null,
  -- Remote images in email: 'ask' blocks them until allowed, 'always' loads them.
  load_images text not null default 'ask' check (load_images in ('ask', 'always')),
  vacation_on boolean not null default false,
  vacation_subject text check (char_length(vacation_subject) <= 200),
  vacation_body text check (char_length(vacation_body) <= 4000),
  vacation_until timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Senders whose remote images load without asking.
create table type.image_senders (
  account_id uuid not null references public.profiles (id) on delete cascade,
  address text not null,
  primary key (account_id, address)
);

create table type.threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('elum', 'email')),
  subject text check (char_length(subject) <= 300),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table type.participants (
  thread_id uuid not null references type.threads (id) on delete cascade,
  address text not null,
  mailbox_id uuid references type.mailboxes (id) on delete cascade,   -- ELUM people
  name text,
  folder text not null default 'inbox' check (folder in ('inbox', 'archive', 'trash', 'spam')),
  last_read_at timestamptz,
  muted boolean not null default false,
  -- Only ever Bcc'd: in the thread, but not shown to the others.
  hidden boolean not null default false,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (thread_id, address)
);
create index participants_mailbox_idx on type.participants (mailbox_id, updated_at desc);

create table type.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references type.threads (id) on delete cascade,
  sender_address text not null,
  sender_name text,
  sender_mailbox uuid references type.mailboxes (id) on delete set null,
  to_list jsonb not null default '[]' check (jsonb_typeof(to_list) = 'array'),
  cc_list jsonb not null default '[]' check (jsonb_typeof(cc_list) = 'array'),
  subject text check (char_length(subject) <= 300),
  body_text text not null default '' check (char_length(body_text) <= 200000),
  body_html text check (char_length(body_html) <= 1000000),   -- sanitised again wherever it is shown
  snippet text not null default '',
  headers jsonb,                        -- email only
  message_id text unique,               -- RFC 5322 Message-ID: threading and de-duplication
  in_reply_to text,
  status text not null default 'sent' check (status in ('queued', 'sent', 'delivered', 'failed', 'received')),
  has_attachments boolean not null default false,
  has_remote_images boolean not null default false,
  auto boolean not null default false,  -- vacation replies; never answered automatically
  event_id bigint unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index messages_thread_idx on type.messages (thread_id, created_at);

create table type.message_recipients (
  message_id uuid not null references type.messages (id) on delete cascade,
  mailbox_id uuid not null references type.mailboxes (id) on delete cascade,
  kind text not null check (kind in ('from', 'to', 'cc', 'bcc')),
  primary key (message_id, mailbox_id)
);
create index message_recipients_mailbox_idx on type.message_recipients (mailbox_id);

create table type.drafts (
  id uuid primary key,                  -- chosen by the app; becomes the message id when sent
  mailbox_id uuid not null references type.mailboxes (id) on delete cascade,
  thread_id uuid references type.threads (id) on delete cascade,
  to_list jsonb not null default '[]',
  cc_list jsonb not null default '[]',
  bcc_list jsonb not null default '[]',
  subject text check (char_length(subject) <= 300),
  body_text text not null default '' check (char_length(body_text) <= 200000),
  body_html text check (char_length(body_html) <= 1000000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drafts_mailbox_idx on type.drafts (mailbox_id);

-- Files live in the type-attachments bucket at <message or draft id>/<file>.
create table type.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references type.messages (id) on delete cascade,
  draft_id uuid references type.drafts (id) on delete cascade,
  path text not null unique,
  name text not null check (char_length(name) between 1 and 255),
  mime text not null,
  bytes integer not null check (bytes between 0 and 25 * 1024 * 1024),
  created_at timestamptz not null default now(),
  check ((message_id is null) <> (draft_id is null))
);
create index attachments_message_idx on type.attachments (message_id);
create index attachments_draft_idx on type.attachments (draft_id);

create table type.outbox (
  id bigint generated always as identity primary key,
  message_id uuid not null references type.messages (id) on delete cascade,
  address text not null,
  name text,
  kind text not null check (kind in ('to', 'cc', 'bcc')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  provider_id text,
  last_error text,
  sent_at timestamptz,
  unique (message_id, address)
);
create index outbox_ready_idx on type.outbox (available_at) where status in ('pending', 'processing');

create table type.inbox_cards (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references type.mailboxes (id) on delete cascade,
  event_id bigint not null unique,
  service_id text not null references elum.services (id),
  actor_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 1000),
  action_label text,
  action_url text check (char_length(action_url) <= 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  archived_at timestamptz
);
create index inbox_cards_mailbox_idx on type.inbox_cards (mailbox_id, created_at desc);

-- A recovery email waiting for its 6-digit code (handoff 3.4). Only a hash of the code is kept.
create table type.recovery_codes (
  account_id uuid primary key references public.profiles (id) on delete cascade,
  address text not null check (address = lower(btrim(address))),
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now()
);

-- Who got a vacation reply, so each sender gets one every few days at most.
create table type.vacation_log (
  mailbox_id uuid not null references type.mailboxes (id) on delete cascade,
  address text not null,
  sent_at timestamptz not null default now(),
  primary key (mailbox_id, address)
);

-- ----------------------------------------------------------------- helpers

create function type.my_mailboxes() returns setof uuid
language sql stable security definer set search_path = type, public as $$
  select id from type.mailboxes where owner_id = auth.uid()
$$;

create function type.my_threads() returns setof uuid
language sql stable security definer set search_path = type, public as $$
  select p.thread_id from type.participants p join type.mailboxes m on m.id = p.mailbox_id where m.owner_id = auth.uid()
$$;

create function type.sees_message(p_message uuid) returns boolean
language sql stable security definer set search_path = type, public as $$
  select exists (
    select 1 from type.message_recipients r join type.mailboxes m on m.id = r.mailbox_id
    where r.message_id = p_message and m.owner_id = auth.uid()
  )
$$;

create function type.owns_draft(p_draft uuid) returns boolean
language sql stable security definer set search_path = type, public as $$
  select exists (select 1 from type.drafts d join type.mailboxes m on m.id = d.mailbox_id where d.id = p_draft and m.owner_id = auth.uid())
$$;

create function type.try_uuid(p_text text) returns uuid
language plpgsql immutable as $$
begin
  return p_text::uuid;
exception when invalid_text_representation then
  return null;
end $$;

create function type.domain() returns text
language sql stable security definer set search_path = elum as $$
  select value from elum.config where key = 'type_domain'
$$;

create function type.require_me() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then
    raise exception using errcode = 'PT401', message = 'Your session has ended. Sign in again.';
  end if;
  return auth.uid();
end $$;

-- One line of text for lists and notifications.
create function type.snippet(p_text text) returns text
language sql immutable as $$
  select left(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')), 160)
$$;

-- Recipients arrive as ["a@b.c"] or [{"address": "a@b.c", "name": "A"}]. Cleaned, lowercased, de-duplicated.
create function type.recipients(p_list jsonb) returns table (address text, name text)
language plpgsql immutable as $$
begin
  if p_list is null or jsonb_typeof(p_list) = 'null' then return; end if;
  if jsonb_typeof(p_list) <> 'array' then
    raise exception using errcode = 'PT400', message = 'Recipients must be a list.';
  end if;
  return query
  select distinct on (a.addr) a.addr, a.nm from (
    select lower(btrim(case when jsonb_typeof(e) = 'string' then e #>> '{}' else e ->> 'address' end)) as addr,
           nullif(left(btrim(case when jsonb_typeof(e) = 'object' then e ->> 'name' end), 80), '') as nm,
           ord
    from jsonb_array_elements(p_list) with ordinality as x (e, ord)
  ) a
  where a.addr is not null and a.addr <> ''
  order by a.addr, a.ord;
end $$;

create function type.check_address(p_address text) returns void
language plpgsql immutable as $$
begin
  if p_address !~ '^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[^\s@<>(),;:"\[\]]+$' or char_length(p_address) > 254 then
    raise exception using errcode = 'PT400', message = format('%s is not a valid email address.', p_address);
  end if;
end $$;

-- The account's mailboxes, created on first need. Returns the one to send from by default:
-- the Type address when there is one, otherwise the login address.
create function type.ensure_mailbox(p_account uuid) returns uuid
language plpgsql security definer set search_path = type, elum, public as $$
declare
  v_name text;
  v_type text;
  v_login text;
  v_id uuid;
begin
  select name into v_name from public.profiles where id = p_account and status = 'active';
  if v_name is null then return null; end if;
  select address into v_type from elum.addresses where account_id = p_account and kind = 'type' limit 1;
  select address into v_login from elum.addresses where account_id = p_account and kind = 'login' limit 1;
  if v_type is not null then
    insert into type.mailboxes (owner_id, address, display_name, can_email) values (p_account, v_type, v_name, true)
    on conflict (address) do update set can_email = true where type.mailboxes.owner_id = excluded.owner_id;
    select id into v_id from type.mailboxes where address = v_type and owner_id = p_account;
  elsif v_login is not null then
    insert into type.mailboxes (owner_id, address, display_name, can_email) values (p_account, v_login, v_name, false)
    on conflict (address) do nothing;
    select id into v_id from type.mailboxes where address = v_login and owner_id = p_account;
  end if;
  insert into type.preferences (account_id, default_mailbox) values (p_account, v_id)
  on conflict (account_id) do update set default_mailbox = coalesce(type.preferences.default_mailbox, excluded.default_mailbox);
  return coalesce((select default_mailbox from type.preferences where account_id = p_account), v_id);
end $$;

-- The mailbox an address reaches, if it belongs to an ELUM account. Every address resolves through
-- the platform, so writing to someone's login email or Type address reaches the same inbox.
create function type.mailbox_for_address(p_address text) returns uuid
language plpgsql security definer set search_path = type, elum, public as $$
declare
  v_account uuid := elum.account_for_address(p_address);
  v_id uuid;
begin
  if v_account is null then return null; end if;
  select id into v_id from type.mailboxes where address = lower(btrim(p_address)) and owner_id = v_account;
  return coalesce(v_id, type.ensure_mailbox(v_account));
end $$;

-- Gives a mailbox its copy of a message: joins the thread, brings it back to the inbox, tells the owner.
create function type.deliver(p_message uuid, p_mailbox uuid, p_kind text, p_folder text default 'inbox') returns void
language plpgsql security definer set search_path = type, elum, public as $$
declare
  m type.messages;
  mb type.mailboxes;
  v_muted boolean;
  v_url text;
  v_payload jsonb;
begin
  select * into m from type.messages where id = p_message;
  select * into mb from type.mailboxes where id = p_mailbox;
  insert into type.message_recipients (message_id, mailbox_id, kind) values (p_message, p_mailbox, p_kind)
  on conflict (message_id, mailbox_id) do nothing;
  if not found then return; end if;

  insert into type.participants (thread_id, address, mailbox_id, name, folder, hidden)
  values (m.thread_id, mb.address, mb.id, mb.display_name, p_folder, p_kind = 'bcc')
  on conflict (thread_id, address) do update
    set mailbox_id = excluded.mailbox_id,
        hidden = type.participants.hidden and excluded.hidden,
        folder = case when type.participants.folder = 'archive' then 'inbox' else type.participants.folder end,
        updated_at = now()
  returning muted into v_muted;

  -- Mailboxes whose owner sent it, or that sent it themselves, need no notification.
  if mb.id is not distinct from m.sender_mailbox or p_folder = 'spam' then return; end if;
  select url into v_url from elum.services where id = 'type';
  v_payload := jsonb_build_object('threadId', m.thread_id, 'messageId', m.id, 'from', m.sender_address, 'subject', m.subject);
  if not coalesce(v_muted, false) then
    v_payload := v_payload || jsonb_build_object('notification', jsonb_build_object(
      'title', coalesce(nullif(m.sender_name, ''), m.sender_address) || ' sent you a message',
      'body', coalesce(nullif(m.subject, ''), m.snippet),
      'link', coalesce(v_url, '') || '/t/' || m.thread_id));
  end if;
  perform elum.emit('type.message.received',
    (select owner_id from type.mailboxes where id = m.sender_mailbox), mb.owner_id, v_payload,
    'type:thread:' || m.thread_id, 'type.message.received:' || m.id || ':' || mb.id);
end $$;

-- Answers a message with the owner's vacation reply, once every four days per sender.
create function type.vacation_reply(p_mailbox uuid, p_thread uuid, p_to text, p_to_name text, p_subject text) returns void
language plpgsql security definer set search_path = type, elum, public as $$
declare
  mb type.mailboxes;
  pr type.preferences;
  v_local uuid;
  v_id uuid := gen_random_uuid();
  v_body text;
begin
  select * into mb from type.mailboxes where id = p_mailbox;
  select * into pr from type.preferences where account_id = mb.owner_id;
  if pr.account_id is null or not pr.vacation_on or (pr.vacation_until is not null and pr.vacation_until < now()) then return; end if;
  if p_to = mb.address or p_to ~* '^(no-?reply|mailer-daemon|postmaster)@' then return; end if;
  if exists (select 1 from type.vacation_log where mailbox_id = p_mailbox and address = p_to and sent_at > now() - interval '4 days') then return; end if;
  v_local := type.mailbox_for_address(p_to);
  if v_local is null and not mb.can_email then return; end if;

  insert into type.vacation_log (mailbox_id, address) values (p_mailbox, p_to)
  on conflict (mailbox_id, address) do update set sent_at = now();
  v_body := coalesce(nullif(btrim(pr.vacation_body), ''), 'I am away at the moment and will reply when I am back.');
  insert into type.messages (id, thread_id, sender_address, sender_name, sender_mailbox, to_list, subject, body_text, snippet,
                             message_id, status, auto, sent_at)
  values (v_id, p_thread, mb.address, mb.display_name, mb.id, jsonb_build_array(jsonb_build_object('address', p_to, 'name', p_to_name)),
          coalesce(nullif(pr.vacation_subject, ''), 'Away: ' || coalesce(p_subject, 'your message')), v_body, type.snippet(v_body),
          '<' || v_id || '@' || type.domain() || '>', case when v_local is null then 'queued' else 'sent' end, true, now());
  insert into type.message_recipients (message_id, mailbox_id, kind) values (v_id, mb.id, 'from');
  if v_local is null then
    insert into type.outbox (message_id, address, name, kind) values (v_id, p_to, p_to_name, 'to');
  else
    perform type.deliver(v_id, v_local, 'to');
  end if;
  update type.threads set last_message_at = now() where id = p_thread;
end $$;

-- ------------------------------------------------------- reading (apps)

-- Opens Type for the signed-in person: makes their mailbox, returns what the app needs to start.
create function public.type_start() returns jsonb
language plpgsql security definer set search_path = type, elum, public as $$
declare
  v_me uuid := type.require_me();
begin
  perform type.ensure_mailbox(v_me);
  return jsonb_build_object(
    'typeDomain', type.domain(),
    'mailboxes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'address', address, 'displayName', display_name,
                                                                'signature', signature, 'canEmail', can_email) order by can_email desc, created_at)
                           from type.mailboxes where owner_id = v_me), '[]'),
    'preferences', (select jsonb_build_object('defaultMailbox', default_mailbox, 'loadImages', load_images, 'vacationOn', vacation_on,
                                              'vacationSubject', vacation_subject, 'vacationBody', vacation_body, 'vacationUntil', vacation_until,
                                              'version', version)
                    from type.preferences where account_id = v_me),
    'imageSenders', coalesce((select jsonb_agg(address order by address) from type.image_senders where account_id = v_me), '[]'),
    'pendingRecovery', (select address from type.recovery_codes where account_id = v_me and expires_at > now()));
end $$;

-- The conversation list. Views: inbox, unread, elum, email, archive, spam, trash.
create function public.type_inbox(p_view text default 'inbox', p_query text default null, p_before timestamptz default null,
                                  p_limit integer default 50)
returns table (thread_id uuid, kind text, subject text, snippet text, last_message_at timestamptz, unread boolean, folder text,
               muted boolean, has_attachments boolean, message_count integer, last_sender jsonb, participants jsonb)
language plpgsql stable security definer set search_path = type, public as $$
declare
  v_me uuid := type.require_me();
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if p_view not in ('inbox', 'unread', 'elum', 'email', 'archive', 'spam', 'trash') then
    raise exception using errcode = 'PT400', message = 'Choose a view.';
  end if;
  return query
  with mine as (
    select p.* from type.participants p join type.mailboxes mb on mb.id = p.mailbox_id where mb.owner_id = v_me
  ), rows as (
    select me.thread_id, t.kind, t.subject, me.folder, me.muted, me.last_read_at, me.mailbox_id,
           last.snippet as last_snippet, last.created_at as last_at, last.sender_name, last.sender_address,
           (select count(*)::integer from type.messages m join type.message_recipients r on r.message_id = m.id
             where m.thread_id = me.thread_id and r.mailbox_id = me.mailbox_id) as cnt,
           exists (select 1 from type.messages m join type.message_recipients r on r.message_id = m.id
                    where m.thread_id = me.thread_id and r.mailbox_id = me.mailbox_id and r.kind <> 'from'
                      and m.created_at > coalesce(me.last_read_at, '-infinity')) as is_unread,
           exists (select 1 from type.messages m join type.message_recipients r on r.message_id = m.id
                    where m.thread_id = me.thread_id and r.mailbox_id = me.mailbox_id and m.has_attachments) as attach
    from mine me
    join type.threads t on t.id = me.thread_id
    cross join lateral (
      select m.snippet, m.created_at, m.sender_name, m.sender_address
      from type.messages m join type.message_recipients r on r.message_id = m.id
      where m.thread_id = me.thread_id and r.mailbox_id = me.mailbox_id
      order by m.created_at desc limit 1
    ) last
  )
  select r.thread_id, r.kind, r.subject, r.last_snippet, r.last_at, r.is_unread, r.folder, r.muted, r.attach, r.cnt,
         jsonb_build_object('address', r.sender_address, 'name', r.sender_name),
         coalesce((select jsonb_agg(jsonb_build_object('address', p.address, 'name', p.name, 'isElum', p.mailbox_id is not null,
                                                        'color', pr.color) order by p.joined_at)
                   from type.participants p
                   left join type.mailboxes pm on pm.id = p.mailbox_id
                   left join public.profiles pr on pr.id = pm.owner_id
                   where p.thread_id = r.thread_id and p.mailbox_id is distinct from r.mailbox_id and not p.hidden), '[]')
  from rows r
  where (p_before is null or r.last_at < p_before)
    and case p_view
          when 'inbox' then r.folder = 'inbox'
          when 'unread' then r.folder = 'inbox' and r.is_unread
          when 'elum' then r.folder = 'inbox' and r.kind = 'elum'
          when 'email' then r.folder = 'inbox' and r.kind = 'email'
          else r.folder = p_view
        end
    and (v_q is null
         or r.subject ilike '%' || v_q || '%'
         or exists (select 1 from type.participants p where p.thread_id = r.thread_id and not p.hidden
                      and (p.address ilike '%' || v_q || '%' or p.name ilike '%' || v_q || '%'))
         or exists (select 1 from type.messages m join type.message_recipients rr on rr.message_id = m.id
                     where m.thread_id = r.thread_id and rr.mailbox_id = r.mailbox_id and m.body_text ilike '%' || v_q || '%'))
  order by r.last_at desc
  limit least(greatest(p_limit, 1), 100);
end $$;

-- One conversation: the messages you hold a copy of, oldest first.
create function public.type_thread(p_thread uuid) returns jsonb
language plpgsql stable security definer set search_path = type, public as $$
declare
  v_me uuid := type.require_me();
  me type.participants;
begin
  select p.* into me from type.participants p join type.mailboxes mb on mb.id = p.mailbox_id
  where p.thread_id = p_thread and mb.owner_id = v_me limit 1;
  if me.thread_id is null then
    raise exception using errcode = 'PT404', message = 'This conversation does not exist or was deleted.';
  end if;
  return (
    select jsonb_build_object(
      'id', t.id, 'kind', t.kind, 'subject', t.subject, 'lastMessageAt', t.last_message_at,
      'me', jsonb_build_object('mailboxId', me.mailbox_id, 'address', me.address, 'folder', me.folder, 'muted', me.muted, 'lastReadAt', me.last_read_at),
      'participants', coalesce((select jsonb_agg(jsonb_build_object('address', p.address, 'name', p.name, 'isElum', p.mailbox_id is not null,
                                                                    'color', pr.color) order by p.joined_at)
                                from type.participants p left join type.mailboxes pm on pm.id = p.mailbox_id
                                left join public.profiles pr on pr.id = pm.owner_id
                                where p.thread_id = t.id and (not p.hidden or p.mailbox_id = me.mailbox_id)), '[]'),
      'messages', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'from', jsonb_build_object('address', m.sender_address, 'name', m.sender_name, 'isElum', m.sender_mailbox is not null,
                                                  'color', sp.color),
          'mine', m.sender_mailbox = me.mailbox_id,
          'to', m.to_list, 'cc', m.cc_list,
          'bcc', case when m.sender_mailbox = me.mailbox_id then
                   coalesce((select jsonb_agg(jsonb_build_object('address', o.address, 'name', o.name)) from type.outbox o where o.message_id = m.id and o.kind = 'bcc'), '[]')
                   || coalesce((select jsonb_agg(jsonb_build_object('address', bm.address, 'name', bm.display_name))
                                from type.message_recipients br join type.mailboxes bm on bm.id = br.mailbox_id
                                where br.message_id = m.id and br.kind = 'bcc'), '[]')
                 else '[]'::jsonb end,
          'subject', m.subject, 'text', m.body_text, 'html', m.body_html, 'headers', m.headers, 'messageId', m.message_id,
          'status', m.status, 'auto', m.auto, 'hasRemoteImages', m.has_remote_images, 'createdAt', m.created_at, 'sentAt', m.sent_at,
          'failed', case when m.sender_mailbox = me.mailbox_id then
                      coalesce((select jsonb_agg(o.address) from type.outbox o where o.message_id = m.id and o.status = 'failed'), '[]')
                    else '[]'::jsonb end,
          'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'path', a.path, 'name', a.name, 'mime', a.mime, 'bytes', a.bytes) order by a.created_at)
                                   from type.attachments a where a.message_id = m.id), '[]'))
          order by m.created_at)
        from type.messages m
        join type.message_recipients r on r.message_id = m.id and r.mailbox_id = me.mailbox_id
        left join type.mailboxes smb on smb.id = m.sender_mailbox
        left join public.profiles sp on sp.id = smb.owner_id
        where m.thread_id = t.id), '[]'))
    from type.threads t where t.id = p_thread
  );
end $$;

-- Unread counts for the rail.
create function public.type_counts() returns jsonb
language sql stable security definer set search_path = type, public as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.type_inbox('unread', null, null, 100)),
    'cards', (select count(*) from type.inbox_cards c join type.mailboxes mb on mb.id = c.mailbox_id
              where mb.owner_id = auth.uid() and c.read_at is null and c.archived_at is null))
$$;

-- People to write to: those you have written with, and ELUM people found by name or address.
create function public.type_contacts(p_query text default null, p_limit integer default 30)
returns table (address text, name text, is_elum boolean, color text, last_contact_at timestamptz)
language plpgsql stable security definer set search_path = type, elum, public as $$
declare
  v_me uuid := type.require_me();
  v_q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
begin
  return query
  with known as (
    select p.address, max(p.name) as name, bool_or(p.mailbox_id is not null) as is_elum, max(t.last_message_at) as last_at,
           (array_agg(pm.owner_id) filter (where pm.owner_id is not null))[1] as owner
    from type.participants p
    join type.threads t on t.id = p.thread_id
    left join type.mailboxes pm on pm.id = p.mailbox_id
    where p.thread_id in (select type.my_threads()) and not p.hidden
      and (p.mailbox_id is null or p.mailbox_id not in (select type.my_mailboxes()))
    group by p.address
  ), people as (
    select coalesce((select a.address from elum.addresses a where a.account_id = pr.id and a.kind = 'type'), lower(pr.email)) as address,
           pr.name, true as is_elum, null::timestamptz as last_at, pr.id as owner
    from public.profiles pr
    where v_q is not null and char_length(v_q) >= 2 and pr.id <> v_me and pr.status = 'active'
      and (lower(pr.name) like '%' || v_q || '%' or lower(pr.email) like v_q || '%' or pr.handle like v_q || '%')
  ), merged as (
    select k.address, k.name, k.is_elum, k.last_at, k.owner from known k
    where v_q is null or lower(k.address) like '%' || v_q || '%' or lower(coalesce(k.name, '')) like '%' || v_q || '%'
    union all
    select pe.address, pe.name, pe.is_elum, pe.last_at, pe.owner from people pe where pe.address not in (select k2.address from known k2)
  )
  select mg.address, mg.name, mg.is_elum, pr.color, mg.last_at
  from merged mg left join public.profiles pr on pr.id = mg.owner
  order by mg.last_at desc nulls last, mg.name
  limit least(greatest(p_limit, 1), 100);
end $$;

create function public.type_drafts() returns jsonb
language sql stable security definer set search_path = type, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'mailboxId', d.mailbox_id, 'threadId', d.thread_id, 'to', d.to_list, 'cc', d.cc_list,
                                               'bcc', d.bcc_list, 'subject', d.subject, 'text', d.body_text, 'html', d.body_html,
                                               'version', d.version, 'updatedAt', d.updated_at,
                                               'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'path', a.path, 'name', a.name, 'mime', a.mime, 'bytes', a.bytes))
                                                                        from type.attachments a where a.draft_id = d.id), '[]'))
                            order by d.updated_at desc), '[]')
  from type.drafts d where d.mailbox_id in (select type.my_mailboxes())
$$;

create function public.type_inbox_cards(p_before timestamptz default null, p_limit integer default 50, p_archived boolean default false)
returns table (id uuid, service_id text, title text, body text, action_label text, action_url text, created_at timestamptz,
               read_at timestamptz, archived_at timestamptz, actor jsonb)
language sql stable security definer set search_path = type, public as $$
  select c.id, c.service_id, c.title, c.body, c.action_label, c.action_url, c.created_at, c.read_at, c.archived_at,
         case when a.id is null then null else jsonb_build_object('id', a.id, 'name', a.name, 'color', a.color) end
  from type.inbox_cards c left join public.profiles a on a.id = c.actor_id
  where c.mailbox_id in (select type.my_mailboxes())
    and (p_before is null or c.created_at < p_before)
    and ((c.archived_at is not null) = p_archived)
  order by c.created_at desc
  limit least(greatest(p_limit, 1), 100)
$$;

-- ------------------------------------------------------- writing (apps)

-- Sends a message as one of your mailboxes. p_id is chosen by the app (the draft's id), so a
-- retried send returns the first result. ELUM recipients get it instantly; outside addresses
-- are queued for the type-send function.
create function public.type_send_message(
  p_id uuid,
  p_mailbox uuid,
  p_thread uuid default null,
  p_to jsonb default '[]',
  p_cc jsonb default '[]',
  p_bcc jsonb default '[]',
  p_subject text default null,
  p_body_text text default '',
  p_body_html text default null
) returns jsonb
language plpgsql security definer set search_path = type, elum, public as $$
declare
  v_me uuid := type.require_me();
  mb type.mailboxes;
  v_existing type.messages;
  v_thread uuid := p_thread;
  v_kind text;
  v_subject text := nullif(left(btrim(coalesce(p_subject, '')), 300), '');
  v_text text := coalesce(p_body_text, '');
  v_reply_to text;
  v_external integer;
  v_total integer;
  v_bytes bigint;
  v_has_files boolean;
  rec record;
begin
  select * into mb from type.mailboxes where id = p_mailbox and owner_id = v_me;
  if mb.id is null then
    raise exception using errcode = 'PT403', message = 'You can only send from your own addresses.';
  end if;
  if p_id is null then
    raise exception using errcode = 'PT400', message = 'Every message needs an id.';
  end if;

  select * into v_existing from type.messages where id = p_id;
  if v_existing.id is not null then
    if v_existing.sender_mailbox = mb.id then
      return jsonb_build_object('messageId', v_existing.id, 'threadId', v_existing.thread_id, 'status', v_existing.status);
    end if;
    raise exception using errcode = 'PT409', message = 'That message id is already used.';
  end if;

  -- Who it goes to.
  create temporary table if not exists pg_temp.send_to (address text primary key, name text, kind text, mailbox uuid) on commit drop;
  truncate pg_temp.send_to;
  insert into pg_temp.send_to (address, name, kind) select address, name, 'to' from type.recipients(p_to) on conflict do nothing;
  insert into pg_temp.send_to (address, name, kind) select address, name, 'cc' from type.recipients(p_cc) on conflict do nothing;
  insert into pg_temp.send_to (address, name, kind) select address, name, 'bcc' from type.recipients(p_bcc) on conflict do nothing;
  select count(*) into v_total from pg_temp.send_to;
  if v_total = 0 then
    raise exception using errcode = 'PT400', message = 'Add someone to send to.';
  end if;
  if v_total > 50 then
    raise exception using errcode = 'PT400', message = 'You can send to up to 50 people at once.';
  end if;
  for rec in select address from pg_temp.send_to loop
    perform type.check_address(rec.address);
  end loop;
  update pg_temp.send_to s set mailbox = type.mailbox_for_address(s.address);
  update pg_temp.send_to s set name = coalesce(s.name, (select display_name from type.mailboxes where id = s.mailbox)) where s.mailbox is not null;
  select count(*) into v_external from pg_temp.send_to where mailbox is null;

  select coalesce(sum(bytes), 0), count(*) > 0 into v_bytes, v_has_files from type.attachments where draft_id = p_id;
  if btrim(v_text) = '' and not v_has_files then
    raise exception using errcode = 'PT400', message = 'Write something first.';
  end if;
  if v_bytes > 25 * 1024 * 1024 then
    raise exception using errcode = 'PT400', message = 'Attachments can add up to 25 MB.';
  end if;

  if v_external > 0 and not mb.can_email then
    raise exception using errcode = 'PT403', message = 'Get an ELUM address to email people outside ELUM.';
  end if;
  if not elum.take_rate_limit('type.send', 600, 3600) then
    raise exception using errcode = 'PT429', message = 'You have sent a lot in the last hour. Try again later.';
  end if;
  for rec in select address from pg_temp.send_to where mailbox is null loop
    if not elum.take_rate_limit('type.external', 200, 86400) then
      raise exception using errcode = 'PT429', message = 'You have emailed a lot of outside addresses today. Try again tomorrow.';
    end if;
  end loop;

  -- The conversation: a reply keeps its thread; a new message starts one.
  if v_thread is not null then
    if not exists (select 1 from type.participants where thread_id = v_thread and mailbox_id = mb.id) then
      raise exception using errcode = 'PT404', message = 'This conversation does not exist or was deleted.';
    end if;
    select m.message_id into v_reply_to from type.messages m join type.message_recipients r on r.message_id = m.id and r.mailbox_id = mb.id
    where m.thread_id = v_thread order by m.created_at desc limit 1;
    if v_external > 0 then update type.threads set kind = 'email' where id = v_thread; end if;
    select coalesce(v_subject, subject) into v_subject from type.threads where id = v_thread;
  else
    v_kind := case when v_external > 0 then 'email' else 'elum' end;
    insert into type.threads (kind, subject) values (v_kind, v_subject) returning id into v_thread;
  end if;

  insert into type.messages (id, thread_id, sender_address, sender_name, sender_mailbox, to_list, cc_list, subject, body_text, body_html,
                             snippet, message_id, in_reply_to, status, has_attachments, sent_at)
  values (p_id, v_thread, mb.address, mb.display_name, mb.id,
          coalesce((select jsonb_agg(jsonb_build_object('address', address, 'name', name)) from pg_temp.send_to where kind = 'to'), '[]'),
          coalesce((select jsonb_agg(jsonb_build_object('address', address, 'name', name)) from pg_temp.send_to where kind = 'cc'), '[]'),
          v_subject, v_text, nullif(p_body_html, ''), type.snippet(v_text),
          '<' || p_id || '@' || type.domain() || '>', v_reply_to,
          case when v_external > 0 then 'queued' else 'sent' end, v_has_files, now());

  update type.attachments set message_id = p_id, draft_id = null where draft_id = p_id;
  delete from type.drafts where id = p_id;

  -- The sender's own copy, read and in their inbox.
  insert into type.message_recipients (message_id, mailbox_id, kind) values (p_id, mb.id, 'from');
  insert into type.participants (thread_id, address, mailbox_id, name, last_read_at)
  values (v_thread, mb.address, mb.id, mb.display_name, now())
  on conflict (thread_id, address) do update
    set last_read_at = now(), hidden = false, updated_at = now(),
        folder = case when type.participants.folder in ('archive', 'trash') then 'inbox' else type.participants.folder end;

  -- Outside people join the thread as addresses, and their copies wait in the outbox.
  insert into type.participants (thread_id, address, name)
  select v_thread, address, name from pg_temp.send_to where mailbox is null and kind <> 'bcc'
  on conflict (thread_id, address) do update set name = coalesce(type.participants.name, excluded.name);
  insert into type.outbox (message_id, address, name, kind)
  select p_id, address, name, kind from pg_temp.send_to where mailbox is null;

  for rec in select address, name, kind, mailbox from pg_temp.send_to where mailbox is not null loop
    perform type.deliver(p_id, rec.mailbox, rec.kind);
  end loop;
  -- Vacation replies come back to the sender.
  for rec in select distinct mailbox from pg_temp.send_to where mailbox is not null and mailbox <> mb.id loop
    perform type.vacation_reply(rec.mailbox, v_thread, mb.address, mb.display_name, v_subject);
  end loop;

  update type.threads set last_message_at = now() where id = v_thread;
  return jsonb_build_object('messageId', p_id, 'threadId', v_thread, 'status', case when v_external > 0 then 'queued' else 'sent' end);
end $$;

-- Saves a draft as people type. p_version is the version the app last saw (0 for a new draft);
-- a mismatch is a conflict whose detail is the current version.
create function public.type_save_draft(
  p_id uuid,
  p_mailbox uuid,
  p_version integer,
  p_thread uuid default null,
  p_to jsonb default '[]',
  p_cc jsonb default '[]',
  p_bcc jsonb default '[]',
  p_subject text default null,
  p_body_text text default '',
  p_body_html text default null
) returns jsonb
language plpgsql security definer set search_path = type, public as $$
declare
  v_me uuid := type.require_me();
  d type.drafts;
begin
  if not exists (select 1 from type.mailboxes where id = p_mailbox and owner_id = v_me) then
    raise exception using errcode = 'PT403', message = 'You can only write from your own addresses.';
  end if;
  if p_thread is not null and not exists (select 1 from type.participants where thread_id = p_thread and mailbox_id = p_mailbox) then
    raise exception using errcode = 'PT404', message = 'This conversation does not exist or was deleted.';
  end if;
  select * into d from type.drafts where id = p_id;
  if d.id is null then
    if exists (select 1 from type.messages where id = p_id) then
      raise exception using errcode = 'PT409', message = 'This message was already sent.', detail = '0';
    end if;
    insert into type.drafts (id, mailbox_id, thread_id, to_list, cc_list, bcc_list, subject, body_text, body_html)
    values (p_id, p_mailbox, p_thread, coalesce(p_to, '[]'), coalesce(p_cc, '[]'), coalesce(p_bcc, '[]'),
            nullif(left(p_subject, 300), ''), coalesce(p_body_text, ''), nullif(p_body_html, ''))
    returning * into d;
  else
    if d.mailbox_id not in (select type.my_mailboxes()) then
      raise exception using errcode = 'PT404', message = 'That draft does not exist.';
    end if;
    if d.version <> coalesce(p_version, 0) then
      raise exception using errcode = 'PT409', message = 'This draft changed on another device.', detail = d.version::text;
    end if;
    update type.drafts set mailbox_id = p_mailbox, thread_id = p_thread, to_list = coalesce(p_to, '[]'), cc_list = coalesce(p_cc, '[]'),
                           bcc_list = coalesce(p_bcc, '[]'), subject = nullif(left(p_subject, 300), ''), body_text = coalesce(p_body_text, ''),
                           body_html = nullif(p_body_html, ''), version = version + 1, updated_at = now()
    where id = p_id returning * into d;
  end if;
  return jsonb_build_object('id', d.id, 'version', d.version, 'updatedAt', d.updated_at);
end $$;

create function public.type_delete_draft(p_id uuid) returns void
language plpgsql security definer set search_path = type, public as $$
begin
  perform type.require_me();
  delete from type.drafts where id = p_id and mailbox_id in (select type.my_mailboxes());
end $$;

-- Registers a file the app uploaded to type-attachments/<draft id>/<file>.
create function public.type_add_attachment(p_draft uuid, p_path text, p_name text, p_mime text, p_bytes integer) returns uuid
language plpgsql security definer set search_path = type, public as $$
declare
  v_id uuid;
begin
  perform type.require_me();
  if not type.owns_draft(p_draft) then
    raise exception using errcode = 'PT404', message = 'Save the message first, then attach files.';
  end if;
  if p_path !~ ('^' || p_draft || '/[^/]+$') then
    raise exception using errcode = 'PT400', message = 'That file is in the wrong place.';
  end if;
  if p_bytes > 25 * 1024 * 1024 or (select coalesce(sum(bytes), 0) from type.attachments where draft_id = p_draft) + p_bytes > 25 * 1024 * 1024 then
    raise exception using errcode = 'PT400', message = 'Attachments can add up to 25 MB.';
  end if;
  insert into type.attachments (draft_id, path, name, mime, bytes) values (p_draft, p_path, left(p_name, 255), left(p_mime, 200), p_bytes)
  returning id into v_id;
  return v_id;
end $$;

create function public.type_remove_attachment(p_id uuid) returns text
language plpgsql security definer set search_path = type, public as $$
declare
  v_path text;
begin
  perform type.require_me();
  delete from type.attachments a where a.id = p_id and a.draft_id is not null and type.owns_draft(a.draft_id) returning a.path into v_path;
  return v_path;
end $$;

-- Marks a conversation read (or unread again).
create function public.type_mark_read(p_thread uuid, p_read boolean default true) returns void
language plpgsql security definer set search_path = type, public as $$
begin
  perform type.require_me();
  update type.participants set last_read_at = case when p_read then now() end, updated_at = now()
  where thread_id = p_thread and mailbox_id in (select type.my_mailboxes());
end $$;

-- Moves conversations between inbox, archive, spam and trash. Returns how many moved.
create function public.type_move(p_threads uuid[], p_folder text) returns integer
language plpgsql security definer set search_path = type, public as $$
declare
  v_count integer;
begin
  perform type.require_me();
  if p_folder not in ('inbox', 'archive', 'trash', 'spam') then
    raise exception using errcode = 'PT400', message = 'Choose inbox, archive, spam or trash.';
  end if;
  update type.participants set folder = p_folder, updated_at = now()
  where thread_id = any (p_threads) and mailbox_id in (select type.my_mailboxes());
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function public.type_set_muted(p_thread uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = type, public as $$
begin
  perform type.require_me();
  update type.participants set muted = p_muted, updated_at = now()
  where thread_id = p_thread and mailbox_id in (select type.my_mailboxes());
end $$;

create function public.type_update_mailbox(p_mailbox uuid, p_display_name text default null, p_signature text default null) returns void
language plpgsql security definer set search_path = type, public as $$
begin
  perform type.require_me();
  if p_display_name is not null and char_length(btrim(p_display_name)) not between 1 and 80 then
    raise exception using errcode = 'PT400', message = 'Names are 1 to 80 characters.';
  end if;
  update type.mailboxes set display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
                            signature = case when p_signature is null then signature else nullif(left(p_signature, 2000), '') end
  where id = p_mailbox and owner_id = auth.uid();
  if not found then
    raise exception using errcode = 'PT404', message = 'That address is not yours.';
  end if;
end $$;

-- Changes Type settings. Keys left out stay as they are.
create function public.type_update_preferences(p_patch jsonb, p_version integer) returns jsonb
language plpgsql security definer set search_path = type, public as $$
declare
  v_me uuid := type.require_me();
  pr type.preferences;
begin
  perform type.ensure_mailbox(v_me);
  select * into pr from type.preferences where account_id = v_me;
  if pr.version <> p_version then
    raise exception using errcode = 'PT409', message = 'Your settings changed on another device.', detail = pr.version::text;
  end if;
  if p_patch ? 'defaultMailbox' and not exists (select 1 from type.mailboxes where id = (p_patch ->> 'defaultMailbox')::uuid and owner_id = v_me) then
    raise exception using errcode = 'PT400', message = 'Choose one of your addresses.';
  end if;
  if p_patch ? 'loadImages' and p_patch ->> 'loadImages' not in ('ask', 'always') then
    raise exception using errcode = 'PT400', message = 'Choose ask or always.';
  end if;
  update type.preferences set
    default_mailbox = case when p_patch ? 'defaultMailbox' then (p_patch ->> 'defaultMailbox')::uuid else default_mailbox end,
    load_images = coalesce(p_patch ->> 'loadImages', load_images),
    vacation_on = coalesce((p_patch ->> 'vacationOn')::boolean, vacation_on),
    vacation_subject = case when p_patch ? 'vacationSubject' then nullif(left(p_patch ->> 'vacationSubject', 200), '') else vacation_subject end,
    vacation_body = case when p_patch ? 'vacationBody' then nullif(left(p_patch ->> 'vacationBody', 4000), '') else vacation_body end,
    vacation_until = case when p_patch ? 'vacationUntil' then (p_patch ->> 'vacationUntil')::timestamptz else vacation_until end,
    version = version + 1, updated_at = now()
  where account_id = v_me returning * into pr;
  return jsonb_build_object('defaultMailbox', pr.default_mailbox, 'loadImages', pr.load_images, 'vacationOn', pr.vacation_on,
                            'vacationSubject', pr.vacation_subject, 'vacationBody', pr.vacation_body, 'vacationUntil', pr.vacation_until,
                            'version', pr.version);
end $$;

-- Always load (or stop loading) remote images from one sender.
create function public.type_allow_images(p_address text, p_allow boolean) returns void
language plpgsql security definer set search_path = type, public as $$
declare
  v_me uuid := type.require_me();
begin
  if p_allow then
    insert into type.image_senders (account_id, address) values (v_me, lower(btrim(p_address))) on conflict do nothing;
  else
    delete from type.image_senders where account_id = v_me and address = lower(btrim(p_address));
  end if;
end $$;

create function public.type_mark_card(p_id uuid, p_read boolean default null, p_archived boolean default null) returns void
language plpgsql security definer set search_path = type, public as $$
begin
  perform type.require_me();
  update type.inbox_cards set
    read_at = case when p_read is null then read_at when p_read then coalesce(read_at, now()) end,
    archived_at = case when p_archived is null then archived_at when p_archived then coalesce(archived_at, now()) end
  where id = p_id and mailbox_id in (select type.my_mailboxes());
end $$;

-- ------------------------------------------- server only (edge functions)

-- Stores an email that arrived for one or more Type addresses (called by type-inbound).
-- p: {id?, messageId, inReplyTo, references[], from {address, name}, to[], cc[], recipients[],
--     subject, text, html, headers, spam (bool), auto (bool), hasRemoteImages, attachments[{path, name, mime, bytes}]}
create function public.type_receive_email(p jsonb) returns jsonb
language plpgsql security definer set search_path = type, elum, public as $$
declare
  v_id uuid := coalesce(type.try_uuid(p ->> 'id'), gen_random_uuid());
  v_message_id text := nullif(btrim(p ->> 'messageId'), '');
  v_from text := lower(btrim(p #>> '{from,address}'));
  v_from_name text := nullif(left(btrim(p #>> '{from,name}'), 80), '');
  v_subject text := nullif(left(btrim(coalesce(p ->> 'subject', '')), 300), '');
  v_text text := left(coalesce(p ->> 'text', ''), 200000);
  v_spam boolean := coalesce((p ->> 'spam')::boolean, false);
  v_existing type.messages;
  v_thread uuid;
  v_new_thread boolean := false;
  v_mailboxes uuid[];
  v_refs text[];
  mbid uuid;
  rec record;
begin
  perform type.check_address(v_from);
  -- Only Type mailboxes receive outside mail.
  select array_agg(distinct mb.id) into v_mailboxes
  from type.recipients(p -> 'recipients') r join type.mailboxes mb on mb.address = r.address and mb.can_email;
  if v_mailboxes is null then
    return jsonb_build_object('stored', false, 'reason', 'no_recipient');
  end if;

  -- The same email arriving again (once per recipient, or a retry) adds copies, never a second message.
  if v_message_id is not null then
    select * into v_existing from type.messages where message_id = v_message_id;
  end if;
  if v_existing.id is not null then
    v_id := v_existing.id;
    v_thread := v_existing.thread_id;
  else
    -- Thread by In-Reply-To and References, only into conversations these mailboxes are already in
    -- and the sender is part of. A made-up In-Reply-To cannot push a stranger into a conversation.
    v_refs := array_remove(array[nullif(btrim(p ->> 'inReplyTo'), '')] ||
              coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'references', '[]')) x), '{}'), null);
    select m.thread_id into v_thread from type.messages m
    -- Our Message-ID, or the one the sending provider gave our message.
    where (m.message_id = any (v_refs) or exists (select 1 from type.outbox o where o.message_id = m.id and o.provider_id = any (v_refs)))
      and exists (select 1 from type.participants pp where pp.thread_id = m.thread_id and pp.mailbox_id = any (v_mailboxes))
      and exists (select 1 from type.participants pp where pp.thread_id = m.thread_id and pp.address = v_from)
    order by m.created_at desc limit 1;
    if v_thread is null then
      insert into type.threads (kind, subject) values ('email', v_subject) returning id into v_thread;
      v_new_thread := true;
    else
      update type.threads set kind = 'email' where id = v_thread;
    end if;

    insert into type.messages (id, thread_id, sender_address, sender_name, to_list, cc_list, subject, body_text, body_html, snippet,
                               headers, message_id, in_reply_to, status, has_attachments, has_remote_images, auto, sent_at)
    values (v_id, v_thread, v_from, v_from_name, coalesce(p -> 'to', '[]'), coalesce(p -> 'cc', '[]'), v_subject, v_text,
            nullif(left(p ->> 'html', 1000000), ''), type.snippet(v_text), p -> 'headers', v_message_id, nullif(p ->> 'inReplyTo', ''),
            'received', jsonb_array_length(coalesce(p -> 'attachments', '[]')) > 0, coalesce((p ->> 'hasRemoteImages')::boolean, false),
            coalesce((p ->> 'auto')::boolean, false), coalesce((p ->> 'date')::timestamptz, now()));
    insert into type.attachments (message_id, path, name, mime, bytes)
    select v_id, a ->> 'path', left(coalesce(nullif(a ->> 'name', ''), 'attachment'), 255), coalesce(a ->> 'mime', 'application/octet-stream'), (a ->> 'bytes')::integer
    from jsonb_array_elements(coalesce(p -> 'attachments', '[]')) a;

    -- The sender and anyone else on the email join the thread as addresses.
    insert into type.participants (thread_id, address, name) values (v_thread, v_from, v_from_name)
    on conflict (thread_id, address) do update set name = coalesce(excluded.name, type.participants.name);
    insert into type.participants (thread_id, address, name)
    select v_thread, r.address, r.name from (
      select * from type.recipients(coalesce(p -> 'to', '[]')) union select * from type.recipients(coalesce(p -> 'cc', '[]'))
    ) r
    where not exists (select 1 from type.mailboxes mb where mb.address = r.address)
    on conflict (thread_id, address) do nothing;
    update type.threads set last_message_at = now() where id = v_thread;
  end if;

  foreach mbid in array v_mailboxes loop
    perform type.deliver(v_id, mbid,
      case when exists (select 1 from type.recipients(coalesce(p -> 'cc', '[]')) r join type.mailboxes mb on mb.address = r.address where mb.id = mbid) then 'cc'
           when exists (select 1 from type.recipients(coalesce(p -> 'to', '[]')) r join type.mailboxes mb on mb.address = r.address where mb.id = mbid) then 'to'
           else 'bcc' end,
      case when v_spam and (v_new_thread or v_existing.id is not null and not exists (
             select 1 from type.participants pp where pp.thread_id = v_thread and pp.mailbox_id = mbid)) then 'spam' else 'inbox' end);
    if not v_spam and not coalesce((p ->> 'auto')::boolean, false) then
      perform type.vacation_reply(mbid, v_thread, v_from, v_from_name, v_subject);
    end if;
  end loop;

  return jsonb_build_object('stored', true, 'messageId', v_id, 'threadId', v_thread, 'mailboxes', to_jsonb(v_mailboxes));
end $$;

-- Takes a batch of outside deliveries for type-send, leased for p_lease_seconds.
create function public.type_claim_outbox(p_limit integer default 25, p_lease_seconds integer default 120, p_message uuid default null)
returns table (outbox_id bigint, attempts integer, address text, name text, kind text, message jsonb)
language plpgsql security definer set search_path = type, public as $$
begin
  return query
  with ready as (
    select o.id from type.outbox o
    where ((o.status = 'pending' and o.available_at <= now()) or (o.status = 'processing' and o.locked_until < now()))
      and (p_message is null or o.message_id = p_message)
    order by o.available_at
    limit least(greatest(p_limit, 1), 200)
    for update skip locked
  ), taken as (
    update type.outbox o set status = 'processing', attempts = o.attempts + 1, locked_until = now() + make_interval(secs => p_lease_seconds)
    from ready where o.id = ready.id
    returning o.id, o.attempts, o.address, o.name, o.kind, o.message_id
  )
  select taken.id, taken.attempts, taken.address, taken.name, taken.kind,
         jsonb_build_object('id', m.id, 'threadId', m.thread_id, 'from', jsonb_build_object('address', m.sender_address, 'name', m.sender_name),
                            'to', m.to_list, 'cc', m.cc_list, 'subject', m.subject, 'text', m.body_text, 'html', m.body_html,
                            'messageId', m.message_id, 'inReplyTo', m.in_reply_to, 'auto', m.auto,
                            'references', coalesce((select jsonb_agg(x.message_id order by x.created_at) from type.messages x
                                                    where x.thread_id = m.thread_id and x.created_at < m.created_at and x.message_id is not null), '[]'),
                            'signature', mb.signature,
                            'attachments', coalesce((select jsonb_agg(jsonb_build_object('path', a.path, 'name', a.name, 'mime', a.mime, 'bytes', a.bytes))
                                                     from type.attachments a where a.message_id = m.id), '[]'))
  from taken join type.messages m on m.id = taken.message_id left join type.mailboxes mb on mb.id = m.sender_mailbox
  order by taken.id;
end $$;

-- Records how an outside delivery went: sent, retry (backs off, fails after 8 tries) or failed.
create function public.type_finish_outbox(p_id bigint, p_status text, p_provider_id text default null, p_error text default null) returns void
language plpgsql security definer set search_path = type, public as $$
declare
  v_message uuid;
begin
  if p_status = 'sent' then
    update type.outbox set status = 'sent', sent_at = now(), provider_id = p_provider_id, locked_until = null, last_error = null
    where id = p_id returning message_id into v_message;
  elsif p_status = 'retry' then
    update type.outbox set status = case when attempts >= 8 then 'failed' else 'pending' end,
                           available_at = now() + least(make_interval(mins => power(2, greatest(attempts - 1, 0))::integer), interval '6 hours'),
                           locked_until = null, last_error = left(p_error, 1000)
    where id = p_id returning message_id into v_message;
  elsif p_status = 'failed' then
    update type.outbox set status = 'failed', locked_until = null, last_error = left(p_error, 1000) where id = p_id returning message_id into v_message;
  else
    raise exception using errcode = 'PT400', message = 'Status is sent, retry or failed.';
  end if;
  update type.messages m set status = case
      when exists (select 1 from type.outbox o where o.message_id = m.id and o.status = 'failed') then 'failed'
      when not exists (select 1 from type.outbox o where o.message_id = m.id and o.status <> 'sent') then 'delivered'
      else m.status end
  where m.id = v_message;
end $$;

-- Puts a platform event into someone's Type inbox as a card (called by type-inbox-worker). Idempotent per event.
create function public.type_add_card(p_event bigint, p_account uuid, p_service text, p_title text, p_body text default null,
                                     p_action_label text default null, p_action_url text default null, p_actor uuid default null)
returns uuid
language plpgsql security definer set search_path = type, public as $$
declare
  v_mailbox uuid := type.ensure_mailbox(p_account);
  v_id uuid;
begin
  if v_mailbox is null then return null; end if;
  insert into type.inbox_cards (mailbox_id, event_id, service_id, actor_id, title, body, action_label, action_url)
  values (v_mailbox, p_event, p_service, p_actor, left(p_title, 200), left(p_body, 1000), p_action_label, left(p_action_url, 500))
  on conflict (event_id) do nothing
  returning id into v_id;
  return coalesce(v_id, (select id from type.inbox_cards where event_id = p_event));
end $$;

-- Removes what Type holds for an account that is being deleted (elum.account.deleted).
-- Messages others received stay with them; the sender is kept as an address only.
create function public.type_forget_account(p_account uuid) returns void
language plpgsql security definer set search_path = type, public as $$
begin
  delete from type.image_senders where account_id = p_account;
  delete from type.preferences where account_id = p_account;
  update type.messages set sender_name = 'Former member' where sender_mailbox in (select id from type.mailboxes where owner_id = p_account);
  delete from type.mailboxes where owner_id = p_account;
end $$;

-- The domain Type addresses live on. Public: the sign-up form shows it before anyone has an account.
create function public.type_domain() returns text
language sql stable security definer set search_path = type, public as $$
  select type.domain()
$$;

-- Sign-up abuse limit for type-signup: 5 accounts an hour from one address (handoff 5.3).
create function public.type_signup_guard(p_ip text) returns boolean
language sql security definer set search_path = elum, public as $$
  select elum.take_rate_limit('type.signup:' || coalesce(nullif(btrim(p_ip), ''), 'unknown'), 5, 3600)
$$;

-- Starts confirming a recovery email: stores a hash of the code type-signup emails out.
create function public.type_recovery_start(p_account uuid, p_address text, p_code text) returns void
language plpgsql security definer set search_path = type, public as $$
begin
  perform type.check_address(lower(btrim(p_address)));
  insert into type.recovery_codes (account_id, address, code_hash)
  values (p_account, lower(btrim(p_address)), encode(sha256(convert_to(p_account || ':' || p_code, 'UTF8')), 'hex'))
  on conflict (account_id) do update
    set address = excluded.address, code_hash = excluded.code_hash, attempts = 0, expires_at = now() + interval '30 minutes', created_at = now();
end $$;

-- The signed-in person enters the code. Five tries, thirty minutes. On a match the address
-- becomes a verified alias on their ELUM account.
create function public.type_recovery_confirm(p_code text) returns text
language plpgsql security definer set search_path = type, elum, public as $$
declare
  v_me uuid := type.require_me();
  rc type.recovery_codes;
begin
  select * into rc from type.recovery_codes where account_id = v_me;
  if rc.account_id is null or rc.expires_at < now() then
    raise exception using errcode = 'PT404', message = 'That code has expired. Ask for a new one.';
  end if;
  if rc.attempts >= 5 then
    raise exception using errcode = 'PT429', message = 'Too many tries. Ask for a new code.';
  end if;
  if rc.code_hash <> encode(sha256(convert_to(v_me || ':' || btrim(coalesce(p_code, '')), 'UTF8')), 'hex') then
    update type.recovery_codes set attempts = attempts + 1 where account_id = v_me;
    raise exception using errcode = 'PT400', message = 'That code does not match. Check it and try again.';
  end if;
  perform elum.add_verified_address(v_me, rc.address, 'alias');
  perform elum.audit(v_me, 'address.added', 'type', jsonb_build_object('address', rc.address, 'kind', 'alias'));
  delete from type.recovery_codes where account_id = v_me;
  return rc.address;
end $$;

-- ------------------------------------------------------------------ storage

insert into storage.buckets (id, name, public, file_size_limit)
values ('type-attachments', 'type-attachments', false, 25 * 1024 * 1024)
on conflict (id) do nothing;

create function type.can_read_file(p_path text) returns boolean
language sql stable security definer set search_path = type, public as $$
  select exists (
    select 1 from type.attachments a
    where a.path = p_path and ((a.message_id is not null and type.sees_message(a.message_id)) or (a.draft_id is not null and type.owns_draft(a.draft_id)))
  )
$$;

create policy "type attachments: read with the message" on storage.objects
  for select to authenticated using (bucket_id = 'type-attachments' and type.can_read_file(name));
create policy "type attachments: upload to your drafts" on storage.objects
  for insert to authenticated with check (bucket_id = 'type-attachments' and type.owns_draft(type.try_uuid((storage.foldername(name))[1])));
create policy "type attachments: remove from your drafts" on storage.objects
  for delete to authenticated using (bucket_id = 'type-attachments' and type.owns_draft(type.try_uuid((storage.foldername(name))[1])));

-- ---------------------------------------------- row level security, grants

alter table type.mailboxes enable row level security;
alter table type.preferences enable row level security;
alter table type.image_senders enable row level security;
alter table type.threads enable row level security;
alter table type.participants enable row level security;
alter table type.messages enable row level security;
alter table type.message_recipients enable row level security;
alter table type.drafts enable row level security;
alter table type.attachments enable row level security;
alter table type.outbox enable row level security;
alter table type.inbox_cards enable row level security;
alter table type.vacation_log enable row level security;
alter table type.recovery_codes enable row level security;

-- Reads only; every write goes through the functions above.
create policy "your mailboxes" on type.mailboxes for select to authenticated using (owner_id = auth.uid());
create policy "your settings" on type.preferences for select to authenticated using (account_id = auth.uid());
create policy "your image senders" on type.image_senders for select to authenticated using (account_id = auth.uid());
create policy "threads you are in" on type.threads for select to authenticated using (id in (select type.my_threads()));
create policy "you, and the visible people in your threads" on type.participants for select to authenticated
  using (mailbox_id in (select type.my_mailboxes()) or (not hidden and thread_id in (select type.my_threads())));
create policy "messages sent to you" on type.messages for select to authenticated using (type.sees_message(id));
create policy "your copies" on type.message_recipients for select to authenticated using (mailbox_id in (select type.my_mailboxes()));
create policy "your drafts" on type.drafts for select to authenticated using (mailbox_id in (select type.my_mailboxes()));
create policy "files on messages you hold" on type.attachments for select to authenticated
  using ((message_id is not null and type.sees_message(message_id)) or (draft_id is not null and type.owns_draft(draft_id)));
create policy "your inbox cards" on type.inbox_cards for select to authenticated using (mailbox_id in (select type.my_mailboxes()));
-- type.outbox, type.vacation_log and type.recovery_codes: no client policies, server only.

revoke all on all tables in schema type from public, anon, authenticated;
grant select on type.mailboxes, type.preferences, type.image_senders, type.threads, type.participants, type.messages,
  type.message_recipients, type.drafts, type.attachments, type.inbox_cards to authenticated;
grant all on all tables in schema type to service_role;

revoke all on all functions in schema type from public, anon, authenticated;
grant execute on function type.my_mailboxes(), type.my_threads(), type.sees_message(uuid), type.owns_draft(uuid),
  type.try_uuid(text), type.can_read_file(text) to authenticated;
grant execute on all functions in schema type to service_role;

revoke all on function public.type_start(), public.type_inbox(text, text, timestamptz, integer), public.type_thread(uuid),
  public.type_counts(), public.type_contacts(text, integer), public.type_drafts(), public.type_inbox_cards(timestamptz, integer, boolean),
  public.type_send_message(uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, text),
  public.type_save_draft(uuid, uuid, integer, uuid, jsonb, jsonb, jsonb, text, text, text), public.type_delete_draft(uuid),
  public.type_add_attachment(uuid, text, text, text, integer), public.type_remove_attachment(uuid),
  public.type_mark_read(uuid, boolean), public.type_move(uuid[], text), public.type_set_muted(uuid, boolean),
  public.type_update_mailbox(uuid, text, text), public.type_update_preferences(jsonb, integer), public.type_allow_images(text, boolean),
  public.type_mark_card(uuid, boolean, boolean),
  public.type_receive_email(jsonb), public.type_claim_outbox(integer, integer, uuid), public.type_finish_outbox(bigint, text, text, text),
  public.type_add_card(bigint, uuid, text, text, text, text, text, uuid), public.type_forget_account(uuid),
  public.type_signup_guard(text), public.type_recovery_start(uuid, text, text), public.type_recovery_confirm(text)
  from public, anon, authenticated;

grant execute on function public.type_start(), public.type_inbox(text, text, timestamptz, integer), public.type_thread(uuid),
  public.type_counts(), public.type_contacts(text, integer), public.type_drafts(), public.type_inbox_cards(timestamptz, integer, boolean),
  public.type_send_message(uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, text),
  public.type_save_draft(uuid, uuid, integer, uuid, jsonb, jsonb, jsonb, text, text, text), public.type_delete_draft(uuid),
  public.type_add_attachment(uuid, text, text, text, integer), public.type_remove_attachment(uuid),
  public.type_mark_read(uuid, boolean), public.type_move(uuid[], text), public.type_set_muted(uuid, boolean),
  public.type_update_mailbox(uuid, text, text), public.type_update_preferences(jsonb, integer), public.type_allow_images(text, boolean),
  public.type_mark_card(uuid, boolean, boolean), public.type_recovery_confirm(text)
  to authenticated;
grant execute on function public.type_receive_email(jsonb), public.type_claim_outbox(integer, integer, uuid),
  public.type_finish_outbox(bigint, text, text, text), public.type_add_card(bigint, uuid, text, text, text, text, text, uuid),
  public.type_forget_account(uuid), public.type_signup_guard(text), public.type_recovery_start(uuid, text, text) to service_role;

grant execute on function public.type_domain() to anon, authenticated, service_role;

-- Live updates: new messages, inbox changes and cards reach open apps through Realtime.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table type.messages, type.participants, type.inbox_cards;
  end if;
end $$;
