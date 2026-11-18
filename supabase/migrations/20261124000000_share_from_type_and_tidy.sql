-- Share from Type, share news by email and in Type for every ELUM app, and a nightly tidy.
-- Safe to run more than once. Each part checks that the app it touches is installed.

-- ================================================================ Share from Type
-- What you own across ELUM, newest first, for the "Share from ELUM" window in Type. Only the
-- owner's own things; shares are made afterwards with each app's own share function, which checks
-- everything again.
create or replace function public.type_shareable_items(p_query text default null, p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path = public as $body$
declare
  v_me uuid := auth.uid();
  v_q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_out jsonb := '[]'::jsonb;
  v_part jsonb;
  v_sources constant text[][] := array[
    array['write',   'public.documents', 'title', '/d/'],
    array['make',    'make.designs',     'title', '/m/'],
    array['inquire', 'inquire.forms',    'title', '/forms/'],
    array['capture', 'capture.albums',   'name',  '/albums/'],
    array['code',    'code.projects',    'name',  '/p/'],
    array['tune',    'tune.playlists',   'title', '/playlist/']
  ];
  i integer;
begin
  if v_me is null then
    raise exception using errcode = '42501', message = 'Sign in first.';
  end if;
  for i in 1 .. array_length(v_sources, 1) loop
    continue when to_regclass(v_sources[i][2]) is null;
    begin
      execute format(
        'select coalesce(jsonb_agg(x), ''[]''::jsonb) from (
           select jsonb_build_object(''app'', %L, ''id'', t.id, ''title'', t.%I, ''updatedAt'', t.updated_at, ''path'', %L || t.id) as x
             from %s t
            where t.owner_id = $1 and ($2 is null or lower(t.%I) like ''%%'' || $2 || ''%%'')
            order by t.updated_at desc limit $3) s',
        v_sources[i][1], v_sources[i][3], v_sources[i][4], v_sources[i][2], v_sources[i][3])
        into v_part using v_me, v_q, least(greatest(coalesce(p_limit, 40), 1), 100);
      v_out := v_out || coalesce(v_part, '[]'::jsonb);
    exception when undefined_column or undefined_table then
      -- An app on an older version: leave it out rather than fail.
      null;
    end;
  end loop;
  return coalesce((select jsonb_agg(e order by (e ->> 'updatedAt') desc) from (select e from jsonb_array_elements(v_out) e limit 200) s), '[]'::jsonb);
end $body$;
revoke all on function public.type_shareable_items(text, integer) from public, anon;
grant execute on function public.type_shareable_items(text, integer) to authenticated;

-- ================================================================ Share news, inside and outside
-- Type accounts get a card in their Type inbox for anything shared with them, from every app.
-- Everyone else gets an email (the 'email' consumer, sent by Type's elum-share-mail function).
-- Write keeps sending its own share emails, so write.* stays out of the email consumer.
do $$
begin
  if to_regclass('elum.consumers') is null then
    return;
  end if;
  update elum.consumers
     set patterns = array['write.%', 'elum.account.%', 'make.design.shared', 'capture.album.shared', 'code.project.shared',
                          'inquire.form.shared', 'tune.playlist.shared', 'tune.release.shared', 'tune.session.invited']
   where id = 'type-inbox';
  update elum.consumers
     set patterns = array['make.design.shared', 'capture.album.shared', 'code.project.shared', 'inquire.form.shared',
                          'tune.playlist.shared', 'tune.release.shared', 'tune.session.invited'],
         active = true,
         description = 'Emails people whose channel is email when something is shared with them in any ELUM app except Write (which sends its own). Sent by Type''s elum-share-mail function.'
   where id = 'email';
end $$;

-- ================================================================ Nightly tidy
-- Keeps the database lean by removing what is no longer needed. Each rule matches the privacy
-- policy; nothing a person made is ever removed here.
--   notifications (the bell)            7 days
--   platform events and deliveries      30 days
--   sign-in approval records            90 days
--   passkey, address and check codes    1 day after they expire
--   rate limit counters                 2 days
--   the record of changes to accounts   1 year
--   saved versions of the site wording  180 days, keeping the last 20
--   Type: sent or failed outbox rows    30 days; vacation reply log 30 days
--   Tune: ended listening sessions      1 day; where-you-left-off older than 180 days; listens older than 400 days
create or replace function elum.tidy_rule(p_table text, p_where text) returns bigint
language plpgsql security definer set search_path = pg_catalog, public as $body$
declare
  v_count bigint := 0;
begin
  if to_regclass(p_table) is null then
    return 0;
  end if;
  execute format('delete from %s where %s', p_table, p_where);
  get diagnostics v_count = row_count;
  return v_count;
exception when undefined_column then
  return 0;
end $body$;

create or replace function elum.tidy() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $body$
declare
  v jsonb := '{}'::jsonb;
begin
  v := v || jsonb_build_object('notifications', elum.tidy_rule('elum.notifications', $w$created_at < now() - interval '7 days'$w$));
  v := v || jsonb_build_object('deliveries', elum.tidy_rule('elum.deliveries', $w$coalesce(finished_at, available_at) < now() - interval '30 days'$w$));
  v := v || jsonb_build_object('events', elum.tidy_rule('elum.events', $w$created_at < now() - interval '30 days'$w$));
  v := v || jsonb_build_object('sign_ins', elum.tidy_rule('elum.sign_ins', $w$created_at < now() - interval '90 days'$w$));
  v := v || jsonb_build_object('passkey_challenges', elum.tidy_rule('elum.passkey_challenges', $w$expires_at < now() - interval '1 day'$w$));
  v := v || jsonb_build_object('ensure_challenges', elum.tidy_rule('elum.ensure_challenges', $w$expires_at < now() - interval '1 day'$w$));
  v := v || jsonb_build_object('ensure_passes', elum.tidy_rule('elum.ensure_passes', $w$expires_at < now() - interval '1 day'$w$));
  v := v || jsonb_build_object('ensure_events', elum.tidy_rule('elum.ensure_events', $w$at < now() - interval '30 days'$w$));
  v := v || jsonb_build_object('address_codes', elum.tidy_rule('elum.address_codes', $w$expires_at < now() - interval '1 day'$w$));
  v := v || jsonb_build_object('rate_limits', elum.tidy_rule('elum.rate_limits', $w$window_start < now() - interval '2 days'$w$));
  v := v || jsonb_build_object('audit_log', elum.tidy_rule('elum.audit_log', $w$created_at < now() - interval '1 year'$w$));
  v := v || jsonb_build_object('site_content_history', elum.tidy_rule('elum.site_content_history',
         $w$saved_at < now() - interval '180 days' and ctid not in (select ctid from elum.site_content_history order by saved_at desc limit 20)$w$));
  v := v || jsonb_build_object('type_outbox', elum.tidy_rule('type.outbox', $w$status in ('sent', 'failed') and coalesce(sent_at, available_at) < now() - interval '30 days'$w$));
  v := v || jsonb_build_object('type_vacation_log', elum.tidy_rule('type.vacation_log', $w$sent_at < now() - interval '30 days'$w$));
  v := v || jsonb_build_object('tune_sessions', elum.tidy_rule('tune.sessions', $w$ended_at < now() - interval '1 day'$w$));
  v := v || jsonb_build_object('tune_now_playing', elum.tidy_rule('tune.now_playing', $w$updated_at < now() - interval '180 days'$w$));
  v := v || jsonb_build_object('tune_listens', elum.tidy_rule('tune.listens', $w$created_at < now() - interval '400 days'$w$));
  return v;
end $body$;

revoke all on function elum.tidy_rule(text, text), elum.tidy() from public, anon, authenticated;

-- Every night at 03:41 UTC, once pg_cron is on (Database > Extensions).
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('elum-tidy') where exists (select 1 from cron.job where jobname = 'elum-tidy');
  perform cron.schedule('elum-tidy', '41 3 * * *', 'select elum.tidy()');
exception when others then
  raise notice 'pg_cron is not available (%). Turn it on under Database > Extensions, then run this file again.', sqlerrm;
end $$;

-- Run once now.
select elum.tidy();
