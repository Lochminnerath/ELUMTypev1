-- ELUM Write: settings that follow a person to every device.
--
-- Custom colours, the personal spelling dictionary and spelling settings live with the
-- account instead of in one browser. Only the person themself can read or change them.
--
-- Run after 20261018000000_accounts_and_invites.sql. Safe to run once.

create table public.user_preferences (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  preferences jsonb not null default '{}'
    check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) < 262144),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon, authenticated;
-- Changes go through update_preferences(), which merges them.
grant select on public.user_preferences to authenticated;
create policy "people see their own preferences" on public.user_preferences
  for select to authenticated using (user_id = auth.uid());

-- Merges a change into the signed-in person's preferences and returns all of them.
-- Top-level keys in the change replace the stored ones; others are kept.
create function public.update_preferences(patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_result jsonb;
begin
  if v_me is null then
    raise exception using errcode = 'PT401', message = 'Your session has ended. Sign in again.';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception using errcode = 'PT400', message = 'Preferences must be an object.';
  end if;
  if pg_column_size(patch) >= 262144 then
    raise exception using errcode = 'PT400', message = 'That is too much to save.';
  end if;
  insert into public.user_preferences as up (user_id, preferences)
  values (v_me, patch)
  on conflict (user_id) do update
    set preferences = up.preferences || excluded.preferences, updated_at = now()
  returning preferences into v_result;
  return v_result;
end $$;

revoke all on function public.update_preferences(jsonb) from public, anon;
grant execute on function public.update_preferences(jsonb) to authenticated;
