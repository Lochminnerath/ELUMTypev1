-- ELUM Type: privacy from ELUM Account (who may message you, who may find you).
--
-- Type now asks the platform's elum.allows before delivering a message from one ELUM person to
-- another, and before listing someone in contact search. Someone who blocked the sender simply does
-- not receive it; someone who takes messages only from people they know is named in the error.
-- Email from outside ELUM is unchanged (it follows the spam rules).
--
-- Run after 20261022000000_elum_accounts.sql (ELUMAccountsV1). Safe to run once.

create or replace function public.type_send_message(
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
  create temporary table if not exists pg_temp.send_to (address text primary key, name text, kind text, mailbox uuid, skip boolean not null default false) on commit drop;
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

  -- Each person's choice of who may message them (ELUM Account, Privacy). Someone who blocked you
  -- simply does not receive it; someone who only takes messages from people they know says so.
  for rec in select s.address, s.name, mbx.owner_id from pg_temp.send_to s join type.mailboxes mbx on mbx.id = s.mailbox where mbx.owner_id <> v_me loop
    if elum.circle_of(rec.owner_id, v_me) = 'blocked' then
      update pg_temp.send_to set skip = true where address = rec.address;
    elsif not elum.allows(rec.owner_id, v_me, 'message') then
      raise exception using errcode = 'PT403', message = format('%s only accepts messages from people they know.', coalesce(rec.name, rec.address));
    end if;
  end loop;

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

  for rec in select address, name, kind, mailbox from pg_temp.send_to where mailbox is not null and not skip loop
    perform type.deliver(p_id, rec.mailbox, rec.kind);
  end loop;
  -- Vacation replies come back to the sender.
  for rec in select distinct mailbox from pg_temp.send_to where mailbox is not null and mailbox <> mb.id and not skip loop
    perform type.vacation_reply(rec.mailbox, v_thread, mb.address, mb.display_name, v_subject);
  end loop;

  update type.threads set last_message_at = now() where id = v_thread;
  return jsonb_build_object('messageId', p_id, 'threadId', v_thread, 'status', case when v_external > 0 then 'queued' else 'sent' end);
end $$;

create or replace function public.type_contacts(p_query text default null, p_limit integer default 30)
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
      and (elum.allows(pr.id, v_me, 'find') or elum.circle_of(v_me, pr.id) in ('friends', 'family', 'work'))
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
