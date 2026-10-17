-- ELUM Type: mailboxes, sending, receiving, drafts, attachments, cards, and every access rule.
\set ON_ERROR_STOP on
\set QUIET on

\set rae '00000000-0000-0000-0000-0000000000e1'
\set fen '00000000-0000-0000-0000-0000000000e2'
\set ola '00000000-0000-0000-0000-0000000000e3'
\set stan '00000000-0000-0000-0000-0000000000e4'
\set m1 '20000000-0000-0000-0000-000000000001'
\set m2 '20000000-0000-0000-0000-000000000002'
\set m3 '20000000-0000-0000-0000-000000000003'
\set m4 '20000000-0000-0000-0000-000000000004'
\set m5 '20000000-0000-0000-0000-000000000005'
\set m6 '20000000-0000-0000-0000-000000000006'
\set m7 '20000000-0000-0000-0000-000000000007'

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  (:'rae', 'rae@type.elum.example', now(), '{"name": "Rae Reed"}'),
  (:'fen', 'fen@type.elum.example', now(), '{"name": "Fen Field"}'),
  (:'ola', 'ola@example.org', now(), '{"name": "Ola Owner"}'),
  (:'stan', 'stan@type.elum.example', now(), '{"name": "Stan Stranger"}');
-- What type-signup does after creating each auth user.
select elum.assign_type_address(:'rae', 'rae'), elum.assign_type_address(:'fen', 'fen'), elum.assign_type_address(:'stan', 'stan');
update elum.consumers set active = true;

select expect((select status from elum.services where id = 'type') = 'beta', 'Type opens as a beta service');

-- --------------------------------------------------------------- mailboxes
select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select expect((select elum_join_service('type') ->> 'joined') = 'true', 'Type can be joined');
select expect((select type_start() #>> '{mailboxes,0,address}') = 'rae@type.elum.example', 'a Type account gets its Type address');
select expect((select (type_start() #>> '{mailboxes,0,canEmail}')::boolean), 'and can email anyone');
select expect((select count(*) from type.mailboxes) = 1, 'people see only their own mailboxes');
select expect_error($$insert into type.threads (kind) values ('elum')$$, '42501', 'apps cannot write tables directly');
select expect_error($$select type_receive_email('{}')$$, '42501', 'apps cannot store received mail');
select expect_error($$select * from type.outbox$$, '42501', 'the outbox is server only');
reset role;

select set_config('request.jwt.claim.sub', :'ola', false);
set role authenticated;
select expect((select type_start() #>> '{mailboxes,0,address}') = 'ola@example.org', 'an external account writes from its login address');
select expect(not (select (type_start() #>> '{mailboxes,0,canEmail}')::boolean), 'but cannot email outside ELUM');
reset role;

set role anon;
select expect_error($$select * from type_inbox()$$, '42501', 'signed-out visitors read nothing');
select expect(type_domain() = 'type.elum.example', 'but can see the Type domain, for the sign-up form');
reset role;

create temporary table ids (who text primary key, mailbox uuid);
grant all on ids to authenticated;
insert into ids select 'rae', id from type.mailboxes where owner_id = :'rae';
insert into ids select 'ola', id from type.mailboxes where owner_id = :'ola';

-- ------------------------------------------------------------ ELUM to ELUM
select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select expect((select type_send_message(:'m1', (select mailbox from ids where who = 'rae'), null, '["Fen@Type.Elum.Example"]', '[]', '[]',
                                        'Lunch', 'Lunch on Friday?') ->> 'status') = 'sent', 'ELUM messages are sent at once');
select expect((select type_send_message(:'m1', (select mailbox from ids where who = 'rae'), null, '["fen@type.elum.example"]', '[]', '[]',
                                        'Lunch', 'Lunch on Friday?') ->> 'messageId') = :'m1', 'a retried send is the same message');
select expect((select count(*) from type.messages) = 1, 'and makes no second copy');
select expect((select kind from type.threads) = 'elum', 'a thread between ELUM people is an ELUM conversation');
select expect_error(format($$select type_send_message(gen_random_uuid(), '%s', null, '["fen@type.elum.example"]', '[]', '[]', null, 'hi')$$,
                           (select mailbox from ids where who = 'ola')), 'PT403', 'nobody sends from someone else''s address');
select expect_error(format($$select type_send_message(gen_random_uuid(), '%s', null, '[]', '[]', '[]', null, 'hi')$$,
                           (select mailbox from ids where who = 'rae')), 'PT400', 'a message needs a recipient');
select expect_error(format($$select type_send_message(gen_random_uuid(), '%s', null, '["not an address"]', '[]', '[]', null, 'hi')$$,
                           (select mailbox from ids where who = 'rae')), 'PT400', 'recipients must be addresses');
select expect_error(format($$select type_send_message(gen_random_uuid(), '%s', null, '["fen@type.elum.example"]', '[]', '[]', null, '  ')$$,
                           (select mailbox from ids where who = 'rae')), 'PT400', 'a message needs words or a file');
select expect((select count(*) from elum_notifications()) = 0, 'the sender gets no notification');
reset role;

select expect((select count(*) from elum.events where type = 'type.message.received' and recipient_id = :'fen') = 1, 'the recipient''s event');
select expect((select count(*) from elum.deliveries d join elum.events e on e.id = d.event_id where e.type = 'type.message.received') = 0,
              'Type''s own events are not fed back to its consumers');

select set_config('request.jwt.claim.sub', :'fen', false);
set role authenticated;
select type_start();
select expect((select title from elum_notifications()) = 'Rae Reed sent you a message', 'the bell, in every app');
select expect((select link from elum_notifications()) like '/t/%', 'linking to the conversation');
select expect((select count(*) from type_inbox()) = 1 and (select unread from type_inbox()), 'it is in the inbox, unread');
select expect((select count(*) from type.messages) = 1, 'Realtime sees the message (row level security)');
select expect((select subject from type_inbox('elum')) = 'Lunch', 'From ELUM filter');
select expect((select count(*) from type_inbox('email')) = 0, 'Email filter');
select type_mark_read((select thread_id from type_inbox()));
select expect(not (select unread from type_inbox()), 'reading clears unread');
select expect((select count(*) from type_inbox('unread')) = 0, 'Unread filter');
-- Fen replies in the thread.
select type_send_message(:'m2', (select id from type.mailboxes), (select thread_id from type_inbox()), '["rae@type.elum.example"]', '[]', '[]', null, 'Yes please');
select expect((select jsonb_array_length(type_thread((select thread_id from type_inbox())) -> 'messages')) = 2, 'replies stay in the thread');
select expect((select type_thread((select thread_id from type_inbox())) #>> '{messages,1,mine}')::boolean, 'and show as mine');
reset role;

-- A stranger sees none of it.
select set_config('request.jwt.claim.sub', :'stan', false);
set role authenticated;
select type_start();
select expect((select count(*) from type.messages) = 0 and (select count(*) from type.threads) = 0 and (select count(*) from type.participants) = 0,
              'people outside a thread see nothing of it');
reset role;
select set_config('ids.thread', (select thread_id::text from type.messages where id = :'m1'), false);
set role authenticated;
select expect_error($$select type_thread(current_setting('ids.thread')::uuid)$$, 'PT404', 'not even by id');
reset role;

-- --------------------------------------------------------------------- Bcc
select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select type_send_message(:'m3', (select mailbox from ids where who = 'rae'), (select thread_id from type.messages where id = :'m1'),
                         '["fen@type.elum.example"]', '[]', '["stan@type.elum.example"]', null, 'Booked for noon');
select expect((select type_thread((select thread_id from type.messages where id = :'m1')) #>> '{messages,2,bcc,0,address}') = 'stan@type.elum.example',
              'the sender sees who was Bcc''d');
reset role;

select set_config('request.jwt.claim.sub', :'fen', false);
set role authenticated;
select expect((select jsonb_array_length(type_thread((select thread_id from type.messages where id = :'m1')) #> '{messages,2,bcc}')) = 0,
              'others never see a Bcc');
select expect(not exists (select 1 from type.participants where address = 'stan@type.elum.example'), 'nor the Bcc''d person in the thread');
reset role;

select set_config('request.jwt.claim.sub', :'stan', false);
set role authenticated;
select expect((select count(*) from type.messages) = 1, 'a Bcc''d person sees only the message sent to them');
select expect((select count(*) from type_inbox()) = 1, 'and has the thread in their inbox');
reset role;

-- --------------------------------------------------------------- outside mail
select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select expect((select type_send_message(:'m4', (select mailbox from ids where who = 'rae'), null, '[{"address": "Kai@Outside.org", "name": "Kai"}]',
                                        '[]', '[]', 'Hello', 'Nice to meet you.') ->> 'status') = 'queued', 'outside mail is queued');
select expect((select kind from type.threads t join type.messages m on m.thread_id = t.id where m.id = :'m4') = 'email', 'as an email thread');
select expect((select message_id from type.messages where id = :'m4') = '<' || :'m4' || '@type.elum.example>', 'with a Message-ID on the Type domain');
reset role;
select expect((select address from type.outbox where message_id = :'m4') = 'kai@outside.org', 'the outbox holds the outside address');

select set_config('request.jwt.claim.sub', :'ola', false);
set role authenticated;
select expect_error(format($$select type_send_message(gen_random_uuid(), '%s', null, '["kai@outside.org"]', '[]', '[]', null, 'hi')$$,
                           (select mailbox from ids where who = 'ola')), 'PT403', 'external accounts cannot email outside ELUM');
select expect((select type_send_message(:'m5', (select mailbox from ids where who = 'ola'), null, '["rae@type.elum.example"]', '[]', '[]', null,
                                        'Hi Rae') ->> 'status') = 'sent', 'but they can message ELUM people');
reset role;

-- type-send drains the outbox.
set role service_role;
select expect((select count(*) from type_claim_outbox(10)) = 1, 'type-send claims the delivery');
select expect((select count(*) from type_claim_outbox(10)) = 0, 'claims are leased');
select type_finish_outbox((select id from type.outbox where message_id = :'m4'), 'sent', 'brevo-1');
select expect((select status from type.messages where id = :'m4') = 'delivered', 'all sent means delivered');

-- An outside reply threads into the conversation.
select expect((select type_receive_email(jsonb_build_object(
  'messageId', '<reply-1@outside.org>', 'inReplyTo', '<' || :'m4' || '@type.elum.example>',
  'from', jsonb_build_object('address', 'kai@outside.org', 'name', 'Kai'),
  'to', '["rae@type.elum.example"]'::jsonb, 'recipients', '["rae@type.elum.example"]'::jsonb,
  'subject', 'Re: Hello', 'text', 'Likewise!', 'html', '<p>Likewise!</p>',
  'attachments', jsonb_build_array(jsonb_build_object('path', '30000000-0000-0000-0000-000000000001/notes.pdf', 'name', 'notes.pdf', 'mime', 'application/pdf', 'bytes', 1200))
)) ->> 'threadId')::uuid = (select thread_id from type.messages where id = :'m4'), 'replies thread by In-Reply-To');
select type_receive_email(jsonb_build_object('messageId', '<reply-1@outside.org>', 'from', jsonb_build_object('address', 'kai@outside.org'),
                                             'recipients', '["rae@type.elum.example"]'::jsonb, 'text', 'Likewise!'));
select expect((select count(*) from type.messages where message_id = '<reply-1@outside.org>') = 1, 'the same email twice is one message');
select expect((select type_receive_email('{"from": {"address": "kai@outside.org"}, "recipients": ["nobody@type.elum.example"], "text": "x"}') ->> 'stored') = 'false',
              'mail for unknown addresses is not stored');
select expect((select type_receive_email('{"from": {"address": "kai@outside.org"}, "recipients": ["ola@example.org"], "text": "x"}') ->> 'stored') = 'false',
              'only Type addresses receive outside mail');
-- A spoofed In-Reply-To cannot reach into someone else's conversation.
select type_receive_email(jsonb_build_object('messageId', '<sneak@outside.org>', 'inReplyTo', '<' || :'m1' || '@type.elum.example>',
                                             'from', jsonb_build_object('address', 'eve@outside.org'), 'recipients', '["stan@type.elum.example"]'::jsonb,
                                             'subject', 'Re: Lunch', 'text', 'let me in', 'spam', true));
select expect((select thread_id from type.messages where message_id = '<sneak@outside.org>') <> (select thread_id from type.messages where id = :'m1'),
              'replies join only threads their sender is already in');
select expect((select kind from type.threads t join type.messages m on m.thread_id = t.id where m.id = :'m1') = 'elum'
              and not exists (select 1 from type.participants p join type.messages m on m.thread_id = p.thread_id
                              where m.id = :'m1' and p.address = 'eve@outside.org'), 'and leave the conversation untouched');
reset role;

select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select expect((select count(*) from type_inbox('email')) = 1, 'Rae has the email thread');
select expect((select type_thread((select thread_id from type_inbox('email'))) #>> '{messages,1,attachments,0,name}') = 'notes.pdf', 'with its attachment');
select expect(exists (select 1 from type.attachments where name = 'notes.pdf'), 'attachment rows follow the message');
select expect((select title from elum_notifications() order by created_at desc limit 1) = 'Kai sent you a message', 'outside mail notifies too');
reset role;

select set_config('request.jwt.claim.sub', :'fen', false);
set role authenticated;
select expect(not exists (select 1 from type.messages where message_id = '<reply-1@outside.org>'), 'Fen never sees Rae''s email');
select expect(not exists (select 1 from type.attachments), 'nor its files');
reset role;

select set_config('request.jwt.claim.sub', :'stan', false);
set role authenticated;
select expect((select count(*) from type_inbox('spam')) = 1, 'spam from a new sender goes to Spam');
select expect(not exists (select 1 from elum_notifications() where title like 'eve%'), 'and does not ring the bell');
reset role;

-- ------------------------------------------------------------------- drafts
select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select expect((select (type_save_draft(:'m6', (select mailbox from ids where who = 'rae'), 0, null, '["fen@type.elum.example"]', '[]', '[]', 'Plan', 'Fir') ->> 'version')::int) = 1,
              'a new draft is version 1');
select expect_error(format($$select type_save_draft('%s', '%s', 0, null, '[]', '[]', '[]', 'Plan', 'First')$$, :'m6', (select mailbox from ids where who = 'rae')),
                    'PT409', 'a stale save is a conflict');
select expect((select (type_save_draft(:'m6', (select mailbox from ids where who = 'rae'), 1, null, '["fen@type.elum.example"]', '[]', '[]', 'Plan', 'First draft') ->> 'version')::int) = 2,
              'saves move the version on');
reset role;

-- Files go only into your own drafts.
select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
insert into storage.objects (bucket_id, name) values ('type-attachments', :'m6' || '/plan.png');
select type_add_attachment(:'m6', :'m6' || '/plan.png', 'plan.png', 'image/png', 2048);
select expect_error(format($$select type_add_attachment('%s', 'elsewhere/plan.png', 'plan.png', 'image/png', 10)$$, :'m6'), 'PT400', 'files stay in the draft''s folder');
select expect_error(format($$select type_add_attachment('%s', '%s/big.bin', 'big.bin', 'application/octet-stream', 27000000)$$, :'m6', :'m6'), 'PT400', '25 MB at most');
select expect((select count(*) from storage.objects where name = :'m6' || '/plan.png') = 1, 'you can read your draft''s files');
reset role;

select set_config('request.jwt.claim.sub', :'fen', false);
set role authenticated;
select expect_error(format($$insert into storage.objects (bucket_id, name) values ('type-attachments', '%s/evil.png')$$, :'m6'), '42501', 'nobody uploads into someone else''s draft');
select expect((select count(*) from storage.objects where bucket_id = 'type-attachments') = 0, 'or reads its files');
select expect_error(format($$select type_save_draft('%s', (select id from type.mailboxes), 2, null, '[]', '[]', '[]', 'x', 'x')$$, :'m6'), 'PT404', 'or saves over it');
select expect((select jsonb_array_length(type_drafts())) = 0, 'drafts are private');
reset role;

select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select type_send_message(:'m6', (select mailbox from ids where who = 'rae'), null, '["fen@type.elum.example"]', '[]', '[]', 'Plan', 'First draft');
select expect((select jsonb_array_length(type_drafts())) = 0, 'sending removes the draft');
reset role;

select set_config('request.jwt.claim.sub', :'fen', false);
set role authenticated;
select expect((select count(*) from storage.objects where name = :'m6' || '/plan.png') = 1, 'recipients can open the sent file');
select expect((select type_thread((select thread_id from type.messages where id = :'m6')) #>> '{messages,0,attachments,0,name}') = 'plan.png', 'and see it in the thread');
reset role;

-- ------------------------------------------------- folders, mute, vacation
select set_config('request.jwt.claim.sub', :'fen', false);
set role authenticated;
select expect(type_move(array[(select thread_id from type.messages where id = :'m1')], 'archive') = 1, 'archive');
select expect((select count(*) from type_inbox('archive')) = 1, 'Archived view');
select type_set_muted((select thread_id from type.messages where id = :'m1'), true);
select type_update_preferences('{"vacationOn": true, "vacationBody": "Back Monday."}', (select (type_start() #>> '{preferences,version}')::int));
reset role;

select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select type_send_message(:'m7', (select mailbox from ids where who = 'rae'), (select thread_id from type.messages where id = :'m1'),
                         '["fen@type.elum.example"]', '[]', '[]', null, 'One more thing');
select expect((select count(*) from type.messages where auto and body_text = 'Back Monday.') = 1, 'vacation replies come back');
select type_send_message(gen_random_uuid(), (select mailbox from ids where who = 'rae'), (select thread_id from type.messages where id = :'m1'),
                         '["fen@type.elum.example"]', '[]', '[]', null, 'And another');
select expect((select count(*) from type.messages where auto) = 1, 'once per sender');
reset role;

select expect((select count(*) from elum.notifications n join elum.events e on e.id = n.event_id
               where n.account_id = :'fen' and e.payload ->> 'messageId' = :'m7') = 0, 'muted threads stay quiet');
select set_config('request.jwt.claim.sub', :'fen', false);
set role authenticated;
select expect((select count(*) from type_inbox('inbox') where thread_id = (select thread_id from type.messages where id = :'m1')) = 1,
              'a new message brings an archived thread back');
select expect_error($$select type_move(array[gen_random_uuid()], 'nowhere')$$, 'PT400', 'only known folders');
reset role;

-- --------------------------------------------------------------- inbox cards
set role service_role;
select type_add_card(9001, :'fen', 'write', 'Ola Owner shared “Field notes” with you', 'You can comment.', 'Open in Write', 'https://write.elum.example/d/x', :'ola');
select type_add_card(9001, :'fen', 'write', 'again', null, null, null, null);
reset role;
select expect((select count(*) from type.inbox_cards) = 1, 'one card per event');

select set_config('request.jwt.claim.sub', :'fen', false);
set role authenticated;
select expect((select title from type_inbox_cards()) = 'Ola Owner shared “Field notes” with you', 'cards show in the inbox');
select expect((select (type_counts() ->> 'cards')::int) = 1, 'and count as unread');
select type_mark_card((select id from type_inbox_cards()), true, true);
select expect((select count(*) from type_inbox_cards()) = 0 and (select count(*) from type_inbox_cards(null, 50, true)) = 1, 'archived cards move aside');
reset role;

select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select expect((select count(*) from type.inbox_cards) = 0, 'cards are private');
select expect((select count(*) from type_contacts()) >= 2, 'contacts: people you wrote with');
select expect((select name from type_contacts('stan')) = 'Stan Stranger', 'contacts: ELUM people by name');
select expect((select address from type_contacts('stan')) = 'stan@type.elum.example', 'found at their Type address');
reset role;

-- ----------------------------------------------------- provider Message-IDs
-- Brevo may give our message its own Message-ID; replies to that still thread.
set role service_role;
select type_finish_outbox((select id from type.outbox where message_id = :'m4'), 'sent', '<brevo-123@smtp-relay.example>');
select expect((type_receive_email(jsonb_build_object('messageId', '<reply-2@outside.org>', 'inReplyTo', '<brevo-123@smtp-relay.example>',
                'from', '{"address": "kai@outside.org"}'::jsonb, 'recipients', '["rae@type.elum.example"]'::jsonb, 'text', 'Again')) ->> 'threadId')::uuid
              = (select thread_id from type.messages where id = :'m4'), 'replies thread by the provider''s Message-ID too');
reset role;

-- ---------------------------------------------------------- recovery emails
set role service_role;
select expect(type_signup_guard('203.0.113.9'), 'sign-ups are rate limited per address');
select type_signup_guard('203.0.113.9') from generate_series(1, 4);
select expect(not type_signup_guard('203.0.113.9'), 'five an hour');
select type_recovery_start(:'stan', 'Stan@Personal.example', '123456');
reset role;
select set_config('request.jwt.claim.sub', :'stan', false);
set role authenticated;
select expect((type_start() ->> 'pendingRecovery') = 'stan@personal.example', 'the app knows a code is waiting');
select expect_error($$select type_recovery_confirm('000000')$$, 'PT400', 'a wrong code is refused');
select expect(type_recovery_confirm(' 123456 ') = 'stan@personal.example', 'the right code confirms it');
select expect((select count(*) from jsonb_array_elements(elum_me() -> 'addresses') a where a ->> 'address' = 'stan@personal.example' and (a ->> 'verified')::boolean) = 1,
              'and it becomes a verified address on the account');
select expect_error($$select type_recovery_confirm('123456')$$, 'PT404', 'codes work once');
reset role;
select expect(elum.account_for_address('stan@personal.example') = :'stan', 'the recovery address reaches the account');

-- ------------------------------------------------------- deleting accounts
set role service_role;
select type_forget_account(:'fen');
reset role;
select expect(not exists (select 1 from type.mailboxes where owner_id = :'fen'), 'deleting an account removes its mailboxes');
select expect(exists (select 1 from type.messages where id = :'m2'), 'messages others received stay');

\echo 'Type checks passed.'
