-- ELUM Accounts: what account.elum.services lets people change, for every ELUM service.
--
--   Profile pictures  elum.pictures and the private `avatars` bucket (avatars/<account>/<file>).
--   People            elum.circles: Friends, Family, Work, Blocked. Anyone else is Unknown.
--   Privacy           elum.privacy: who may see your picture, find you by name, and message you.
--   Addresses         elum.address_codes: confirming another address with a 6-digit code.
--   Devices           read from Supabase Auth's sessions; recent activity from elum.audit_log.
--
-- A platform migration: services ask the platform through public.elum_* functions and
-- elum.allows(owner, viewer, what). Run after 20261020000000_elum_platform.sql. Safe to run once.

-- ------------------------------------------------------------------ privacy

create table elum.privacy (
  account_id uuid primary key references public.profiles (id) on delete cascade,
  -- everyone: any signed-in ELUM person (Unknown included)
  -- known:    people in your Friends, Family or Work
  -- close:    Friends and Family
  -- family:   Family only
  -- nobody:   no one but you
  picture text not null default 'everyone' check (picture in ('everyone', 'known', 'close', 'family', 'nobody')),
  findable text not null default 'everyone' check (findable in ('everyone', 'known', 'close', 'family', 'nobody')),
  messages text not null default 'everyone' check (messages in ('everyone', 'known', 'close', 'family', 'nobody')),
  updated_at timestamptz not null default now()
);

create table elum.circles (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  circle text not null check (circle in ('friends', 'family', 'work', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id),
  check (owner_id <> member_id)
);
create index circles_member_idx on elum.circles (member_id);

create table elum.pictures (
  account_id uuid primary key references public.profiles (id) on delete cascade,
  path text not null check (path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  updated_at timestamptz not null default now()
);

-- What circle `owner` has put `member` in, or null (Unknown).
create function elum.circle_of(p_owner uuid, p_member uuid) returns text
language sql stable security definer set search_path = elum, public as $$
  select circle from elum.circles where owner_id = p_owner and member_id = p_member
$$;

-- Whether `owner` lets `viewer` do `what` ('picture', 'find' or 'message'). You always may see
-- yourself; people you blocked never may. Every service asks this, so a choice made in the
-- account pages holds in Write, Type and the rest.
create function elum.allows(p_owner uuid, p_viewer uuid, p_what text) returns boolean
language plpgsql stable security definer set search_path = elum, public as $$
declare
  v_rule text;
  v_circle text;
begin
  if p_owner is null or p_viewer is null then return false; end if;
  if p_owner = p_viewer then return true; end if;
  v_circle := elum.circle_of(p_owner, p_viewer);
  if v_circle = 'blocked' then return false; end if;
  select case p_what when 'picture' then picture when 'find' then findable when 'message' then messages end
    into v_rule from elum.privacy where account_id = p_owner;
  v_rule := coalesce(v_rule, 'everyone');
  -- Unknown people have no circle; coalesce so they get a clear no rather than null.
  return coalesce(case v_rule
    when 'everyone' then true
    when 'known' then v_circle in ('friends', 'family', 'work')
    when 'close' then v_circle in ('friends', 'family')
    when 'family' then v_circle = 'family'
    else false
  end, false);
end $$;

-- ------------------------------------------------------- address codes

-- Another address waiting for its code (an alias, or a recovery email). Only a hash is kept.
create table elum.address_codes (
  account_id uuid not null references public.profiles (id) on delete cascade,
  address text not null check (address = lower(btrim(address))),
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now(),
  primary key (account_id, address)
);

create function elum.code_hash(p_account uuid, p_code text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_account || ':' || btrim(coalesce(p_code, '')), 'UTF8')), 'hex')
$$;

-- --------------------------------------------------------------- helpers

create function elum.require_me() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then
    raise exception using errcode = 'PT401', message = 'Your session has ended. Sign in again.';
  end if;
  return auth.uid();
end $$;

-- A person as other people may see them: the picture only when allowed.
create function elum.person(p_id uuid, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = elum, public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'email', p.email, 'color', p.color, 'handle', p.handle,
    'address', coalesce((select a.address from elum.addresses a where a.account_id = p.id and a.kind = 'type'), lower(p.email)),
    'picture', case when elum.allows(p.id, p_viewer, 'picture') then (select path from elum.pictures where account_id = p.id) end,
    'circle', elum.circle_of(p_viewer, p.id))
  from public.profiles p where p.id = p_id and p.status = 'active'
$$;

-- ------------------------------------------------------------ public API

-- Everything the account pages show, in one call.
create function public.elum_account() returns jsonb
language plpgsql stable security definer set search_path = elum, public as $$
declare
  v_me uuid := elum.require_me();
begin
  return public.elum_me() || jsonb_build_object(
    'picture', (select path from elum.pictures where account_id = v_me),
    'privacy', coalesce((select jsonb_build_object('picture', picture, 'findable', findable, 'messages', messages) from elum.privacy where account_id = v_me),
                        jsonb_build_object('picture', 'everyone', 'findable', 'everyone', 'messages', 'everyone')),
    'circles', (select jsonb_build_object(
                  'friends', count(*) filter (where circle = 'friends'), 'family', count(*) filter (where circle = 'family'),
                  'work', count(*) filter (where circle = 'work'), 'blocked', count(*) filter (where circle = 'blocked'))
                from elum.circles where owner_id = v_me),
    'pendingAddresses', coalesce((select jsonb_agg(address order by created_at) from elum.address_codes where account_id = v_me and expires_at > now()), '[]'));
end $$;

-- Name, avatar colour, language and time zone.
create function public.elum_update_profile(p_name text default null, p_color text default null, p_locale text default null, p_time_zone text default null)
returns jsonb
language plpgsql security definer set search_path = elum, public as $$
declare
  v_me uuid := elum.require_me();
begin
  if p_name is not null and char_length(btrim(p_name)) not between 1 and 80 then
    raise exception using errcode = 'PT400', message = 'Names are 1 to 80 characters.';
  end if;
  if p_color is not null and lower(p_color) not in ('#f59a52', '#3fc4a0', '#9b84ee', '#ec7fa9', '#e9b949', '#7093f8') then
    raise exception using errcode = 'PT400', message = 'Choose one of the ELUM colours.';
  end if;
  if p_locale is not null and p_locale !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' then
    raise exception using errcode = 'PT400', message = 'Choose a language from the list.';
  end if;
  if p_time_zone is not null and not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise exception using errcode = 'PT400', message = 'Choose a time zone from the list.';
  end if;
  update public.profiles set
    name = coalesce(nullif(btrim(p_name), ''), name),
    color = coalesce(lower(p_color), color),
    locale = coalesce(p_locale, locale),
    time_zone = coalesce(p_time_zone, time_zone),
    updated_at = now()
  where id = v_me;
  perform elum.audit(v_me, 'profile.updated', 'elum', jsonb_strip_nulls(jsonb_build_object('name', p_name, 'locale', p_locale, 'timeZone', p_time_zone)));
  return public.elum_account();
end $$;

-- Records the picture the app uploaded to avatars/<you>/<file>. Returns the old path, for removal.
create function public.elum_set_picture(p_path text) returns text
language plpgsql security definer set search_path = elum, public as $$
declare
  v_me uuid := elum.require_me();
  v_old text;
begin
  if p_path is null or split_part(p_path, '/', 1) <> v_me::text then
    raise exception using errcode = 'PT400', message = 'That picture is in the wrong place.';
  end if;
  select path into v_old from elum.pictures where account_id = v_me;
  insert into elum.pictures (account_id, path) values (v_me, p_path)
  on conflict (account_id) do update set path = excluded.path, updated_at = now();
  perform elum.audit(v_me, 'profile.picture_changed', 'elum');
  return case when v_old is distinct from p_path then v_old end;
end $$;

create function public.elum_remove_picture() returns text
language plpgsql security definer set search_path = elum, public as $$
declare
  v_me uuid := elum.require_me();
  v_old text;
begin
  delete from elum.pictures where account_id = v_me returning path into v_old;
  return v_old;
end $$;

-- Pictures of these people that the signed-in person may see (for avatars in any app).
create function public.elum_pictures(p_ids uuid[]) returns table (id uuid, picture text)
language sql stable security definer set search_path = elum, public as $$
  select pc.account_id, pc.path from elum.pictures pc
  where pc.account_id = any (p_ids[1:200]) and elum.allows(pc.account_id, auth.uid(), 'picture')
$$;

create function public.elum_set_privacy(p_picture text default null, p_findable text default null, p_messages text default null) returns jsonb
language plpgsql security definer set search_path = elum, public as $$
declare
  v_me uuid := elum.require_me();
  allowed text[] := array['everyone', 'known', 'close', 'family', 'nobody'];
begin
  if (p_picture is not null and p_picture <> all (allowed)) or (p_findable is not null and p_findable <> all (allowed))
     or (p_messages is not null and p_messages <> all (allowed)) then
    raise exception using errcode = 'PT400', message = 'Choose everyone, people you know, friends and family, family or nobody.';
  end if;
  insert into elum.privacy (account_id, picture, findable, messages)
  values (v_me, coalesce(p_picture, 'everyone'), coalesce(p_findable, 'everyone'), coalesce(p_messages, 'everyone'))
  on conflict (account_id) do update set
    picture = coalesce(p_picture, elum.privacy.picture),
    findable = coalesce(p_findable, elum.privacy.findable),
    messages = coalesce(p_messages, elum.privacy.messages),
    updated_at = now();
  perform elum.audit(v_me, 'privacy.changed', 'elum', jsonb_strip_nulls(jsonb_build_object('picture', p_picture, 'findable', p_findable, 'messages', p_messages)));
  return (select jsonb_build_object('picture', picture, 'findable', findable, 'messages', messages) from elum.privacy where account_id = v_me);
end $$;

-- People in your circles (one circle, or all of them).
create function public.elum_people(p_circle text default null) returns jsonb
language sql stable security definer set search_path = elum, public as $$
  select coalesce(jsonb_agg(elum.person(c.member_id, auth.uid()) || jsonb_build_object('addedAt', c.created_at) order by p.name), '[]')
  from elum.circles c join public.profiles p on p.id = c.member_id
  where c.owner_id = auth.uid() and (p_circle is null or c.circle = p_circle) and p.status = 'active'
$$;

-- Puts someone in a circle, moves them, or (null) takes them out so they are Unknown again.
create function public.elum_set_circle(p_person uuid, p_circle text) returns void
language plpgsql security definer set search_path = elum, public as $$
declare
  v_me uuid := elum.require_me();
begin
  if p_person = v_me then
    raise exception using errcode = 'PT400', message = 'You are always in your own circle.';
  end if;
  if p_circle is null then
    delete from elum.circles where owner_id = v_me and member_id = p_person;
    return;
  end if;
  if p_circle not in ('friends', 'family', 'work', 'blocked') then
    raise exception using errcode = 'PT400', message = 'Choose friends, family, work or blocked.';
  end if;
  if not exists (select 1 from public.profiles where id = p_person and status = 'active') then
    raise exception using errcode = 'PT404', message = 'We could not find that person.';
  end if;
  insert into elum.circles (owner_id, member_id, circle) values (v_me, p_person, p_circle)
  on conflict (owner_id, member_id) do update set circle = excluded.circle;
  if p_circle = 'blocked' then perform elum.audit(v_me, 'people.blocked', 'elum', jsonb_build_object('person', p_person)); end if;
end $$;

-- Finds ELUM people by name or address, among those who let you find them.
create function public.elum_find_people(p_query text, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = elum, public as $$
declare
  v_me uuid := elum.require_me();
  v_q text := lower(btrim(coalesce(p_query, '')));
begin
  if char_length(v_q) < 2 then return '[]'; end if;
  return coalesce((
    select jsonb_agg(elum.person(x.id, v_me)) from (
      select p.id from public.profiles p
      where p.id <> v_me and p.status = 'active'
        and (lower(p.name) like '%' || v_q || '%' or lower(p.email) like v_q || '%' or p.handle like v_q || '%'
             or exists (select 1 from elum.addresses a where a.account_id = p.id and a.address = v_q and (a.verified_at is not null or a.kind = 'login')))
        and (elum.allows(p.id, v_me, 'find') or elum.circle_of(v_me, p.id) is not null)
      order by p.name
      limit least(greatest(p_limit, 1), 50)
    ) x), '[]');
end $$;

-- Removes an alias. The sign-in address and the Type address stay.
create function public.elum_remove_address(p_address text) returns void
language plpgsql security definer set search_path = elum, public as $$
declare
  v_me uuid := elum.require_me();
begin
  delete from elum.addresses where account_id = v_me and address = lower(btrim(p_address)) and kind = 'alias';
  if not found then
    raise exception using errcode = 'PT400', message = 'Only added addresses can be removed. Your sign-in and Type addresses stay.';
  end if;
  delete from elum.address_codes where account_id = v_me and address = lower(btrim(p_address));
  perform elum.audit(v_me, 'address.removed', 'elum', jsonb_build_object('address', lower(btrim(p_address))));
end $$;

-- Server only (the account-address function): stores the code it emails to a new address.
create function public.elum_address_code_start(p_account uuid, p_address text, p_code text) returns void
language plpgsql security definer set search_path = elum, public as $$
declare
  v_address text := lower(btrim(p_address));
begin
  if v_address !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception using errcode = 'PT400', message = 'Enter a valid email address.';
  end if;
  if exists (select 1 from elum.addresses where address = v_address and account_id = p_account) then
    raise exception using errcode = 'PT409', message = 'That address is already on your account.';
  end if;
  if exists (select 1 from elum.addresses where address = v_address and account_id <> p_account and (verified_at is not null or kind = 'login')) then
    raise exception using errcode = 'PT409', message = 'That address belongs to another account.';
  end if;
  if (select count(*) from elum.addresses where account_id = p_account and kind = 'alias') >= 10 then
    raise exception using errcode = 'PT400', message = 'You can add up to 10 addresses.';
  end if;
  insert into elum.address_codes (account_id, address, code_hash) values (p_account, v_address, elum.code_hash(p_account, p_code))
  on conflict (account_id, address) do update set code_hash = excluded.code_hash, attempts = 0, expires_at = now() + interval '30 minutes', created_at = now();
end $$;

-- The signed-in person enters the code: five tries, thirty minutes. The address becomes theirs.
create function public.elum_confirm_address(p_address text, p_code text) returns text
language plpgsql security definer set search_path = elum, public as $$
declare
  v_me uuid := elum.require_me();
  c elum.address_codes;
begin
  select * into c from elum.address_codes where account_id = v_me and address = lower(btrim(p_address));
  if c.account_id is null or c.expires_at < now() then
    raise exception using errcode = 'PT404', message = 'That code has expired. Ask for a new one.';
  end if;
  if c.attempts >= 5 then
    raise exception using errcode = 'PT429', message = 'Too many tries. Ask for a new code.';
  end if;
  if c.code_hash <> elum.code_hash(v_me, p_code) then
    update elum.address_codes set attempts = attempts + 1 where account_id = v_me and address = c.address;
    raise exception using errcode = 'PT400', message = 'That code does not match. Check it and try again.';
  end if;
  perform elum.add_verified_address(v_me, c.address, 'alias');
  perform elum.audit(v_me, 'address.added', 'elum', jsonb_build_object('address', c.address, 'kind', 'alias'));
  delete from elum.address_codes where account_id = v_me and address = c.address;
  return c.address;
end $$;

-- Every notification type, with the signed-in person's choice.
create function public.elum_notification_settings() returns jsonb
language sql stable security definer set search_path = elum, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'type', t.type, 'service', t.service_id, 'serviceName', s.name, 'description', t.description,
      'inApp', coalesce(ns.in_app, true), 'outside', coalesce(ns.outside, true)) order by s.sort, t.type), '[]')
  from elum.event_types t join elum.services s on s.id = t.service_id
  left join elum.notification_settings ns on ns.type = t.type and ns.account_id = auth.uid()
  where t.notify
$$;

-- Recent security-relevant changes on the account.
create function public.elum_activity(p_limit integer default 30) returns jsonb
language sql stable security definer set search_path = elum, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'service', a.service_id, 'detail', a.detail, 'at', a.created_at) order by a.created_at desc), '[]')
  from (select * from elum.audit_log where account_id = auth.uid() order by created_at desc limit least(greatest(p_limit, 1), 100)) a
$$;

-- Devices signed in to this account (Supabase Auth sessions). The current one is marked.
create function public.elum_devices() returns jsonb
language plpgsql stable security definer set search_path = elum, public, auth as $$
declare
  v_me uuid := elum.require_me();
  v_current text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'userAgent', s.user_agent, 'ip', host(s.ip), 'signedInAt', s.created_at,
                                        'lastActiveAt', coalesce(s.refreshed_at, s.updated_at, s.created_at), 'current', s.id::text = v_current)
                     order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc)
    from auth.sessions s where s.user_id = v_me and (s.not_after is null or s.not_after > now())), '[]');
end $$;

-- Server only (account-delete): marks the account deleted and tells every service to clean up.
create function public.elum_mark_deleted(p_account uuid) returns bigint
language plpgsql security definer set search_path = elum, public as $$
begin
  update public.profiles set status = 'deleted', updated_at = now() where id = p_account;
  perform elum.audit(p_account, 'account.deleted', 'elum');
  return elum.emit('elum.account.deleted', p_account, p_account, '{}', 'elum:account:' || p_account, 'elum.account.deleted:' || p_account);
end $$;

-- Server only: deleted accounts whose clean-up every service has finished (safe to remove from Auth).
create function public.elum_deletions_done() returns setof uuid
language sql stable security definer set search_path = elum, public as $$
  select p.id from public.profiles p
  join elum.events e on e.type = 'elum.account.deleted' and e.recipient_id = p.id
  where p.status = 'deleted'
    and not exists (select 1 from elum.deliveries d where d.event_id = e.id and d.status not in ('done', 'skipped'))
$$;

-- Write's people search (sharing a document) finds only people who let you find them, plus the
-- people in your circles. A platform change to a Write function, as share_by_email was.
create or replace function public.search_users(q text)
returns table (id uuid, name text, email text, color text)
language sql stable security definer set search_path = public, elum as $$
  select p.id, p.name, p.email, p.color
  from public.profiles p
  where auth.uid() is not null
    and char_length(btrim(q)) >= 2
    and p.id <> auth.uid()
    and p.status = 'active'
    and (p.name ilike '%' || btrim(q) || '%' or p.email ilike '%' || btrim(q) || '%')
    and (elum.allows(p.id, auth.uid(), 'find') or elum.circle_of(auth.uid(), p.id) in ('friends', 'family', 'work'))
  order by (p.name ilike btrim(q) || '%' or p.email ilike btrim(q) || '%') desc, p.name
  limit 8
$$;

-- Server only: rate limits for the account edge functions (handoff, address codes).
create function public.elum_take_rate_limit(p_key text, p_limit integer, p_window_seconds integer) returns boolean
language sql security definer set search_path = elum, public as $$
  select elum.take_rate_limit(p_key, p_limit, p_window_seconds)
$$;

-- ------------------------------------------------------------------ storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2 * 1024 * 1024, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create function elum.can_see_picture_file(p_name text) returns boolean
language sql stable security definer set search_path = elum, public as $$
  select exists (select 1 from elum.pictures pc where pc.path = p_name and elum.allows(pc.account_id, auth.uid(), 'picture'))
$$;

create policy "avatars: people who may see them" on storage.objects
  for select to authenticated using (bucket_id = 'avatars' and (elum.can_see_picture_file(name) or (storage.foldername(name))[1] = auth.uid()::text));
create policy "avatars: your own folder" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: remove your own" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------------ grants

alter table elum.privacy enable row level security;
alter table elum.circles enable row level security;
alter table elum.pictures enable row level security;
alter table elum.address_codes enable row level security;
revoke all on elum.privacy, elum.circles, elum.pictures, elum.address_codes from public, anon, authenticated;
grant all on elum.privacy, elum.circles, elum.pictures, elum.address_codes to service_role;

revoke all on function elum.circle_of(uuid, uuid), elum.allows(uuid, uuid, text), elum.code_hash(uuid, text), elum.require_me(),
  elum.person(uuid, uuid), elum.can_see_picture_file(text) from public, anon, authenticated;
grant execute on function elum.circle_of(uuid, uuid), elum.allows(uuid, uuid, text), elum.code_hash(uuid, text), elum.require_me(),
  elum.person(uuid, uuid), elum.can_see_picture_file(text) to service_role;
-- Storage policies run as the signed-in person.
grant execute on function elum.can_see_picture_file(text) to authenticated;

revoke all on function public.elum_account(), public.elum_update_profile(text, text, text, text), public.elum_set_picture(text),
  public.elum_remove_picture(), public.elum_pictures(uuid[]), public.elum_set_privacy(text, text, text), public.elum_people(text),
  public.elum_set_circle(uuid, text), public.elum_find_people(text, integer), public.elum_remove_address(text),
  public.elum_address_code_start(uuid, text, text), public.elum_confirm_address(text, text), public.elum_notification_settings(),
  public.elum_activity(integer), public.elum_devices(), public.elum_mark_deleted(uuid), public.elum_deletions_done(),
  public.elum_take_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.elum_account(), public.elum_update_profile(text, text, text, text), public.elum_set_picture(text),
  public.elum_remove_picture(), public.elum_pictures(uuid[]), public.elum_set_privacy(text, text, text), public.elum_people(text),
  public.elum_set_circle(uuid, text), public.elum_find_people(text, integer), public.elum_remove_address(text),
  public.elum_confirm_address(text, text), public.elum_notification_settings(), public.elum_activity(integer), public.elum_devices()
  to authenticated;
grant execute on function public.elum_address_code_start(uuid, text, text), public.elum_mark_deleted(uuid), public.elum_deletions_done(),
  public.elum_take_rate_limit(text, integer, integer) to service_role;
