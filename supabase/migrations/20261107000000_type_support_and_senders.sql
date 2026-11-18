-- ELUM Type: ELUM Support as a conversation, sender pictures, and spam rules that learn.
--
-- ELUM Support, on ELUM's own network. Someone starts a conversation with just a title. It is a
-- request to ELUM Support (the support form's answers, inquire.responses, as the Console already
-- shows them). Every message after that, from the person or from the ELUM team, is a reply on it
-- (elum.support_replies). The Console answers as before; Type shows the whole thing as a chat with
-- verified ELUM Support. Notes the team marks internal are never shown.
--
-- Sender pictures. type_pictures() gives the profile picture of each ELUM address, only where its
-- owner's privacy lets the viewer see it. type_sender_picture() is for type-send: a picture is
-- put on outside email only when its owner shows it to everyone.
--
-- Spam rules. Moving a conversation to Spam blocks its outside senders for that person; moving it
-- out of Spam allows them. type_receive_email then follows those rules, and never treats mail
-- from someone you have written to as spam.
--
-- Safe to run more than once.

-- --------------------------------------------------------------- ELUM Support

-- ELUM Support's tables come from ELUM Inquire (inquire.responses) and the Console
-- (elum.support_replies). Where they are not set up (Type's own tests), this part waits for them.
do $$ begin
  if to_regclass('elum.support_replies') is not null and to_regclass('inquire.responses') is not null then
    alter table elum.support_replies add column if not exists from_person boolean not null default false;
    create table if not exists elum.support_seen (
      ticket_id uuid primary key references inquire.responses (id) on delete cascade,
      seen_at timestamptz not null default now()
    );
    alter table elum.support_seen enable row level security;
    revoke all on elum.support_seen from public, anon, authenticated;
  end if;
end $$;

drop function if exists public.type_support_chat();

/** The title of a support request: what it was started with in Type, or what the form asked. */
create or replace function type.support_title(p_answers jsonb) returns text
language sql immutable set search_path = pg_catalog as $$
  select coalesce(nullif(btrim(p_answers ->> 'title'), ''), nullif(btrim(p_answers ->> 'what'), ''), 'Your request to ELUM Support')
$$;

/** The caller's conversations with ELUM Support: open ones first, then the last month's closed ones. */
create or replace function public.type_support_list() returns jsonb
language plpgsql stable security definer set search_path = type, elum, inquire, public, pg_catalog as $$
declare
  v_me uuid := type.require_me();
begin
  return coalesce((
    select jsonb_agg(x.j order by x.open desc, x.last_at desc)
    from (
      select r.status <> 'done' as open,
             coalesce(last.created_at, r.created_at) as last_at,
             jsonb_build_object(
               'id', r.id,
               'title', type.support_title(r.answers),
               'status', r.status,
               'createdAt', r.created_at,
               'lastAt', coalesce(last.created_at, r.created_at),
               'snippet', left(coalesce(last.body, nullif(btrim(r.answers ->> 'details'), ''), ''), 140),
               'unread', coalesce(last.from_staff, false) and last.created_at > coalesce(s.seen_at, '-infinity')) as j
        from inquire.responses r
        join inquire.forms f on f.id = r.form_id and f.slug = 'support' and f.owner_id is null
        left join elum.support_seen s on s.ticket_id = r.id
        left join lateral (
          select sr.body, sr.created_at, not sr.from_person as from_staff
            from elum.support_replies sr
           where sr.ticket_id = r.id and not sr.internal
           order by sr.created_at desc limit 1) last on true
       where r.account_id = v_me
         and (r.status <> 'done' or coalesce(last.created_at, r.created_at) > now() - interval '30 days')
    ) x), '[]');
end $$;

/** One conversation with ELUM Support, oldest message first. Opening it marks it seen. */
create or replace function public.type_support_thread(p_id uuid) returns jsonb
language plpgsql security definer set search_path = type, elum, inquire, public, pg_catalog as $$
declare
  v_me uuid := type.require_me();
  r record;
  v_first text;
begin
  select * into r from inquire.responses where id = p_id and account_id = v_me;
  if r.id is null or not exists (select 1 from inquire.forms f where f.id = r.form_id and f.slug = 'support' and f.owner_id is null) then
    raise exception using errcode = 'PT404', message = 'That conversation is not there.';
  end if;
  insert into elum.support_seen (ticket_id, seen_at) values (r.id, now())
  on conflict (ticket_id) do update set seen_at = now();
  -- What the support form said, when it was started there.
  v_first := nullif(btrim(concat_ws(E'\n\n', nullif(btrim(r.answers ->> 'details'), ''), nullif(btrim(r.context ->> 'message'), ''))), '');
  return jsonb_build_object(
    'id', r.id,
    'title', type.support_title(r.answers),
    'status', r.status,
    'createdAt', r.created_at,
    'messages',
      (case when v_first is null then '[]'::jsonb
            else jsonb_build_array(jsonb_build_object('id', r.id, 'fromStaff', false, 'author', null, 'body', v_first, 'createdAt', r.created_at)) end)
      || coalesce((select jsonb_agg(jsonb_build_object(
                     'id', sr.id,
                     'fromStaff', not sr.from_person,
                     'author', case when sr.from_person then null else (select split_part(p.name, ' ', 1) from public.profiles p where p.id = sr.author_id) end,
                     'body', sr.body,
                     'createdAt', sr.created_at) order by sr.created_at)
                   from elum.support_replies sr where sr.ticket_id = r.id and not sr.internal), '[]'));
end $$;

/** A message from the person to ELUM Support. A closed conversation opens again. */
create or replace function public.type_support_send(p_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = type, elum, inquire, public, pg_catalog as $$
declare
  v_me uuid := type.require_me();
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not exists (select 1 from inquire.responses r join inquire.forms f on f.id = r.form_id and f.slug = 'support' and f.owner_id is null
                  where r.id = p_id and r.account_id = v_me) then
    raise exception using errcode = 'PT404', message = 'That conversation is not there.';
  end if;
  if char_length(v_body) not between 1 and 5000 then
    raise exception using errcode = 'PT400', message = 'Write a message of up to 5000 characters.';
  end if;
  if not elum.take_rate_limit('support_send:' || v_me, 60, 600) then
    raise exception using errcode = 'PT429', message = 'That is a lot of messages in a short time. Wait a few minutes, then send again.';
  end if;
  insert into elum.support_replies (ticket_id, author_id, body, internal, from_person) values (p_id, v_me, v_body, false, true);
  update inquire.responses set status = 'open' where id = p_id and status = 'done';
  return public.type_support_thread(p_id);
end $$;

/** Starts a conversation with ELUM Support. All it needs is a title. */
create or replace function public.type_support_start(p_title text) returns jsonb
language plpgsql security definer set search_path = type, elum, inquire, public, pg_catalog as $$
declare
  v_me uuid := type.require_me();
  v_title text := left(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), 120);
  v_form uuid;
  v_id uuid;
begin
  if char_length(v_title) < 3 then
    raise exception using errcode = 'PT400', message = 'Give your conversation a short title.';
  end if;
  if not elum.take_rate_limit('support_start:' || v_me, 5, 3600) then
    raise exception using errcode = 'PT429', message = 'You started a few conversations already. Carry on in one of them, or try again in an hour.';
  end if;
  select id into v_form from inquire.forms where slug = 'support' and owner_id is null;
  if v_form is null then
    raise exception using errcode = 'PT503', message = 'ELUM Support is not taking messages right now. Please try again later.';
  end if;
  insert into inquire.responses (form_id, answers, context, account_id, status)
  values (v_form,
          jsonb_build_object('title', v_title, 'what', v_title, 'app', 'type',
                             'email', (select u.email from auth.users u where u.id = v_me)),
          jsonb_build_object('app', 'type', 'from', 'type'),
          v_me, 'new')
  returning id into v_id;
  return public.type_support_thread(v_id);
end $$;

-- ------------------------------------------------------------------ pictures

/** Pictures for ELUM addresses the caller sees in Type, as their owners' privacy allows. */
create or replace function public.type_pictures(p_addresses text[]) returns table (address text, picture text)
language sql stable security definer set search_path = type, elum, public, pg_catalog as $$
  with wanted as (select distinct lower(btrim(a)) as address from unnest(p_addresses[1:200]) a),
  owners as (
    select w.address, mb.owner_id from wanted w join type.mailboxes mb on mb.address = w.address
    union
    select w.address, ea.account_id from wanted w join elum.addresses ea on ea.address = w.address and ea.verified_at is not null
  )
  select distinct on (o.address) o.address, pc.path
    from owners o join elum.pictures pc on pc.account_id = o.owner_id
   where auth.uid() is not null and elum.allows(o.owner_id, auth.uid(), 'picture')
$$;

/** For type-send: the sender's picture, only when they show it to everyone. */
create or replace function public.type_sender_picture(p_address text) returns text
language sql stable security definer set search_path = type, elum, public, pg_catalog as $$
  with owner as (
    select mb.owner_id as id from type.mailboxes mb where mb.address = lower(btrim(p_address))
    union
    select ea.account_id from elum.addresses ea where ea.address = lower(btrim(p_address)) and ea.verified_at is not null
  )
  select pc.path
    from owner o
    join elum.pictures pc on pc.account_id = o.id
    left join elum.privacy pv on pv.account_id = o.id
   where coalesce(pv.picture, 'everyone') = 'everyone'
   limit 1
$$;

-- ---------------------------------------------------------------- spam rules

create table if not exists type.sender_rules (
  account_id uuid not null references public.profiles (id) on delete cascade,
  address text not null check (address = lower(btrim(address))),
  rule text not null check (rule in ('allow', 'block')),
  updated_at timestamptz not null default now(),
  primary key (account_id, address)
);
alter table type.sender_rules enable row level security;
revoke all on type.sender_rules from public, anon, authenticated;

/** Moving a conversation into or out of Spam teaches Type about its outside senders. */
create or replace function type.learn_senders() returns trigger
language plpgsql security definer set search_path = type, public, pg_catalog as $$
declare
  v_owner uuid;
begin
  if new.mailbox_id is null or new.folder is not distinct from old.folder or not (old.folder = 'spam' or new.folder = 'spam') then
    return new;
  end if;
  select owner_id into v_owner from type.mailboxes where id = new.mailbox_id;
  -- Only the person themselves: not mail arriving, not someone else's send.
  if v_owner is null or v_owner is distinct from auth.uid() then
    return new;
  end if;
  insert into type.sender_rules (account_id, address, rule)
  select v_owner, p.address, case when new.folder = 'spam' then 'block' else 'allow' end
    from type.participants p
   where p.thread_id = new.thread_id and p.mailbox_id is null
  on conflict (account_id, address) do update set rule = excluded.rule, updated_at = now();
  return new;
end $$;

drop trigger if exists participants_learn_senders on type.participants;
create trigger participants_learn_senders after update of folder on type.participants
for each row execute function type.learn_senders();

/** Whether mail from p_from to this mailbox goes to Spam, given what the provider and Type's checks said. */
create or replace function type.spam_for(p_mailbox uuid, p_from text, p_spam boolean) returns boolean
language sql stable security definer set search_path = type, public, pg_catalog as $$
  select case
    when sr.rule = 'block' then true
    when sr.rule = 'allow' then false
    -- Someone this mailbox has written to is never spam.
    when exists (select 1 from type.messages m join type.participants pp on pp.thread_id = m.thread_id and pp.address = p_from
                  where m.sender_mailbox = p_mailbox) then false
    else coalesce(p_spam, false) end
  from (select 1) one
  left join type.sender_rules sr on sr.account_id = (select owner_id from type.mailboxes where id = p_mailbox) and sr.address = p_from
$$;

create or replace function public.type_receive_email(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'type', 'elum', 'public'
as $function$
declare
  v_id uuid := coalesce(type.try_uuid(p ->> 'id'), gen_random_uuid());
  v_message_id text := nullif(btrim(p ->> 'messageId'), '');
  v_from text := lower(btrim(p #>> '{from,address}'));
  v_from_name text := nullif(left(btrim(p #>> '{from,name}'), 80), '');
  v_subject text := nullif(left(btrim(coalesce(p ->> 'subject', '')), 300), '');
  v_text text := left(coalesce(p ->> 'text', ''), 200000);
  v_spam boolean := coalesce((p ->> 'spam')::boolean, false);
  v_box_spam boolean;
  v_existing type.messages;
  v_thread uuid;
  v_new_thread boolean := false;
  v_mailboxes uuid[];
  v_refs text[];
  mbid uuid;
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
    -- This person's own rules first: senders they blocked or allowed, and people they write to.
    v_box_spam := type.spam_for(mbid, v_from, v_spam);
    perform type.deliver(v_id, mbid,
      case when exists (select 1 from type.recipients(coalesce(p -> 'cc', '[]')) r join type.mailboxes mb on mb.address = r.address where mb.id = mbid) then 'cc'
           when exists (select 1 from type.recipients(coalesce(p -> 'to', '[]')) r join type.mailboxes mb on mb.address = r.address where mb.id = mbid) then 'to'
           else 'bcc' end,
      case when v_box_spam and (v_new_thread or v_existing.id is not null and not exists (
             select 1 from type.participants pp where pp.thread_id = v_thread and pp.mailbox_id = mbid)) then 'spam' else 'inbox' end);
    if not v_box_spam and not coalesce((p ->> 'auto')::boolean, false) then
      perform type.vacation_reply(mbid, v_thread, v_from, v_from_name, v_subject);
    end if;
  end loop;

  return jsonb_build_object('stored', true, 'messageId', v_id, 'threadId', v_thread, 'mailboxes', to_jsonb(v_mailboxes));
end $function$;

-- ------------------------------------------------------------------- access

revoke all on function public.type_support_list(), public.type_support_thread(uuid), public.type_support_send(uuid, text),
  public.type_support_start(text), public.type_pictures(text[]), public.type_sender_picture(text),
  type.spam_for(uuid, text, boolean), type.support_title(jsonb) from public, anon;
grant execute on function public.type_support_list(), public.type_support_thread(uuid), public.type_support_send(uuid, text),
  public.type_support_start(text), public.type_pictures(text[]) to authenticated;
grant execute on function public.type_sender_picture(text) to service_role;
grant execute on function type.support_title(jsonb) to authenticated, service_role;

-- Check: seven rows.
select proname from pg_proc
 where proname in ('type_support_list', 'type_support_thread', 'type_support_send', 'type_support_start', 'type_pictures', 'type_sender_picture', 'spam_for')
 order by proname;
