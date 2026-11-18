-- ELUM Type: conversations with ELUM Support, sender pictures, and spam rules that learn.
\set ON_ERROR_STOP on
\set QUIET on

\set rae '00000000-0000-0000-0000-0000000000e1'
\set fen '00000000-0000-0000-0000-0000000000e2'
\set staff '00000000-0000-0000-0000-0000000000e9'

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  (:'rae', 'rae@elum.space', now(), '{"name": "Rae Reed"}'),
  (:'fen', 'fen@elum.space', now(), '{"name": "Fen Field"}'),
  (:'staff', 'sam@elum.space', now(), '{"name": "Sam Support"}');
select elum.assign_type_address(:'rae', 'rae'), elum.assign_type_address(:'fen', 'fen');
update elum.consumers set active = true;

-- ------------------------------------------------------------ ELUM Support
select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select elum_join_service('type'), type_start();
select expect_error($$select type_support_start('a')$$, 'PT400', 'a conversation needs a short title');
create temp table t as select (type_support_start('  My   photos will not upload ') ->> 'id')::uuid as id;
select expect((select type_support_list() #>> '{0,title}') = 'My photos will not upload', 'it starts with just a title');
select expect((select (type_support_list() #>> '{0,unread}')::boolean) = false, 'nothing unread yet');
select expect((select jsonb_array_length(type_support_thread((select id from t)) -> 'messages')) = 0, 'no messages until someone writes');
select expect((select jsonb_array_length(type_support_send((select id from t), 'They stop at 90%.') -> 'messages')) = 1, 'the person writes');
select expect_error(format('select type_support_send(%L, %L)', (select id from t), ''), 'PT400', 'an empty message is not sent');
reset role;

-- The team answers from the Console, and leaves a note for each other.
insert into elum.support_replies (ticket_id, author_id, body, internal) values
  ((select id from t), :'staff', 'Thanks. Which browser?', false),
  ((select id from t), :'staff', 'Looks like the upload limit.', true);
update inquire.responses set status = 'done' where id = (select id from t);

set role authenticated;
select expect((select (type_support_list() #>> '{0,unread}')::boolean), 'the answer is unread');
select expect((select type_support_thread((select id from t)) #>> '{messages,1,author}') = 'Sam', 'it is from the team, by first name');
select expect((select (type_support_thread((select id from t)) #>> '{messages,1,fromStaff}')::boolean), 'and marked as ELUM Support');
select expect((select jsonb_array_length(type_support_thread((select id from t)) -> 'messages')) = 2, 'internal notes are never shown');
select expect((select (type_support_list() #>> '{0,unread}')::boolean) = false, 'opening it marks it read');
select type_support_send((select id from t), 'Firefox.');
select expect((select type_support_list() #>> '{0,status}') = 'open', 'writing again opens a closed conversation');
reset role;

select set_config('request.jwt.claim.sub', :'fen', false);
set role authenticated;
select expect((select jsonb_array_length(type_support_list())) = 0, 'nobody else sees it');
select expect_error(format('select type_support_thread(%L)', (select id from t)), 'PT404', 'or can open it');
select expect_error(format('select type_support_send(%L, %L)', (select id from t), 'hi'), 'PT404', 'or write in it');
reset role;

-- ------------------------------------------------------------------ pictures
insert into elum.pictures (account_id, path) values (:'rae', '00000000-0000-0000-0000-0000000000e1/rae.png');
select set_config('request.jwt.claim.sub', :'fen', false);
set role authenticated;
select expect((select picture from type_pictures(array['RAE@elum.space', 'nobody@example.org'])) = '00000000-0000-0000-0000-0000000000e1/rae.png',
              'ELUM people show their picture');
reset role;
insert into elum.privacy (account_id, picture) values (:'rae', 'nobody')
  on conflict (account_id) do update set picture = 'nobody';
set role authenticated;
select expect((select count(*) from type_pictures(array['rae@elum.space'])) = 0, 'a private picture stays private');
reset role;
select expect(type_sender_picture('rae@elum.space') is null, 'and never goes out on email');
update elum.privacy set picture = 'everyone' where account_id = :'rae';
select expect(type_sender_picture('rae@elum.space') is not null, 'a picture shown to everyone goes out on email');

-- ---------------------------------------------------------------- spam rules
create temp table r1 as select type_receive_email(jsonb_build_object(
  'messageId', '<s1@example.org>', 'from', jsonb_build_object('address', 'deals@example.org', 'name', 'Deals'),
  'to', '["rae@elum.space"]'::jsonb, 'recipients', '["rae@elum.space"]'::jsonb,
  'subject', 'Hello', 'text', 'Hi there', 'spam', false)) as r;
select r ->> 'threadId' as th1 from r1 \gset
select expect((select folder from type.participants where thread_id = :'th1'::uuid and mailbox_id is not null) = 'inbox',
              'mail arrives in the inbox');

select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select type_move(array[:'th1'::uuid], 'spam');
reset role;
select expect((select rule from type.sender_rules where address = 'deals@example.org') = 'block', 'marking it spam blocks the sender');

create temp table r2 as select type_receive_email(jsonb_build_object(
  'messageId', '<s2@example.org>', 'from', jsonb_build_object('address', 'deals@example.org'),
  'to', '["rae@elum.space"]'::jsonb, 'recipients', '["rae@elum.space"]'::jsonb,
  'subject', 'Another deal', 'text', 'Buy now', 'spam', false)) as r;
select r ->> 'threadId' as th2 from r2 \gset
select expect((select folder from type.participants where thread_id = :'th2'::uuid and mailbox_id is not null) = 'spam',
              'their next email goes to Spam');

set role authenticated;
select type_move(array[:'th2'::uuid], 'inbox');
reset role;
select expect((select rule from type.sender_rules where address = 'deals@example.org') = 'allow', 'moving it out of Spam allows them again');

create temp table r3 as select type_receive_email(jsonb_build_object(
  'messageId', '<s3@example.org>', 'from', jsonb_build_object('address', 'deals@example.org'),
  'to', '["rae@elum.space"]'::jsonb, 'recipients', '["rae@elum.space"]'::jsonb,
  'subject', 'Your code', 'text', 'Your code is 123456', 'spam', true)) as r;
select expect((select folder from type.participants where thread_id = (select (r ->> 'threadId')::uuid from r3) and mailbox_id is not null) = 'inbox',
              'an allowed sender stays out of Spam');

select 'support tests passed' as result;
