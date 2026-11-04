-- Moving Type to elum.space: accounts made on an old Type domain move, and keep their mail.
\set ON_ERROR_STOP on
\set QUIET on

\set theo '00000000-0000-0000-0000-0000000000f1'

-- A database as it was before elum.space: Type addresses on type.elum.services.
update elum.config set value = 'type.elum.services' where key = 'type_domain';
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  (:'theo', 'theo@type.elum.services', now(), '{"name": "Theo Tide"}');
select elum.assign_type_address(:'theo', 'theo');
update elum.consumers set active = true;
select set_config('request.jwt.claim.sub', :'theo', false);
set role authenticated;
select elum_join_service('type');
select expect((select type_start() #>> '{mailboxes,0,address}') = 'theo@type.elum.services', 'starts on the old domain');
reset role;

\i ../migrations/20261105000000_type_move_to_elum_space.sql

select expect(type_domain() = 'elum.space', 'Type addresses now live on elum.space');
select expect((select email from auth.users where id = :'theo') = 'theo@elum.space', 'the sign-in address moved');
select expect((select address from type.mailboxes where owner_id = :'theo') = 'theo@elum.space', 'the mailbox moved');
select expect(exists (select 1 from elum.addresses where account_id = :'theo' and address = 'theo@elum.space'), 'the address book moved');
select expect(not exists (select 1 from elum.addresses where address like '%@type.elum.services'), 'nothing is left on the old domain');
select expect(exists (select 1 from elum.reserved_handles where handle = 'www'), 'more names are reserved');

-- Running it again changes nothing and fails nothing.
\i ../migrations/20261105000000_type_move_to_elum_space.sql
select expect((select email from auth.users where id = :'theo') = 'theo@elum.space', 'a second run keeps everything in place');

\echo 'Move checks passed.'
