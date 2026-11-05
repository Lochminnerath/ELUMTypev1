-- FOR TESTS ONLY. The few tables Type's ELUM Support conversation reads, as ELUM Inquire
-- (inquire.forms, inquire.responses) and the ELUM Console (elum.support_replies) make them.
-- Production gets the real ones from those apps' migrations.
create schema if not exists inquire;
create table if not exists inquire.forms (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  owner_id uuid references public.profiles (id) on delete cascade
);
create table if not exists inquire.responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references inquire.forms (id) on delete cascade,
  answers jsonb not null default '{}',
  context jsonb not null default '{}',
  account_id uuid references public.profiles (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'open', 'done')),
  created_at timestamptz not null default now()
);
create table if not exists elum.support_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references inquire.responses (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
insert into inquire.forms (id, slug, owner_id) values ('5c0a7a11-0000-4000-8000-000000000001', 'support', null) on conflict do nothing;
