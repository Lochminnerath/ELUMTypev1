# Running ELUM Type on Supabase

Type shares one Supabase project with Write and every other ELUM service. It adds the `type`
schema, the `type-attachments` bucket and four edge functions. The service role key lives only in
edge function secrets, never in the app.

## 1. The database

The platform comes first. In the Write repository's `supabase/migrations/`, run every migration up
to `20261020000000_elum_platform.sql`. Then, in order:

1. `platform-changes/20261020120000_elum_platform_for_type.sql`: a platform fix Type sign-ups need
   (see docs/TYPE.md). It belongs in the platform migrations; until it moves, run it from here.
2. `platform-changes/20261021120000_elum_services_domain.sql`: the family domain is elum.services.
3. `migrations/20261021000000_type_schema.sql`: the `type` schema. It also opens Type as a beta
   service and adds the `type-attachments` bucket.
4. ELUMAccountsV1's `migrations/20261022000000_elum_accounts.sql` (pictures, circles, privacy), then
   `migrations/20261022100000_type_privacy.sql`: Type respects who may message and find each person.
5. `migrations/20261023000000_type_move_to_services_domain.sql`: moves Type accounts made on
   type.elum.example to type.elum.services, so they can sign in with their handle again. Safe to
   run more than once.

Then set where Type lives, for links in notifications:

```sql
update elum.services set url = 'https://typebyelum.netlify.app' where id = 'type';
```

Type reads its data through `public.type_*` functions, so the `type` schema does **not** need to be
exposed in the API settings. Realtime needs nothing else: the migration adds `type.messages`,
`type.participants` and `type.inbox_cards` to the publication, under row level security.

## 2. The mail domain

Type addresses live on `type.elum.services` (run `platform-changes/20261021120000_elum_services_domain.sql`
if your database still says `type.elum.example`). Settle the mail domain before anyone takes a handle;
addresses are permanent.

In DNS for that domain: MX to Brevo inbound, SPF including Brevo, Brevo's DKIM keys, and DMARC
`p=quarantine` (later `reject`). Authenticate the domain in Brevo so any address on it can send.
`postmaster@` and `abuse@` are reserved handles; route them to the team in Brevo.

## 3. Edge functions

```sh
supabase functions deploy type-signup --no-verify-jwt
supabase functions deploy type-inbound --no-verify-jwt
supabase functions deploy type-send
supabase functions deploy type-inbox-worker --no-verify-jwt
supabase secrets set BREVO_API_KEY=... CRON_SECRET=<long random> INBOUND_SECRET=<long random> \
  TYPE_EMAIL_FROM="ELUM Type <hello@type.your-domain>" APP_URL=https://type.your-domain \
  ELUM_WRITE_URL=https://write.your-domain
# Optional: CAPTCHA_PROVIDER=turnstile CAPTCHA_SECRET=... (once the sign-up form shows the widget)
```

| Function | Does | Called by |
| --- | --- | --- |
| `type-signup` | Creates Type accounts; sends recovery codes | The sign-up form, and Settings ("Send a new code") |
| `type-send` | Sends queued outside email through Brevo | pg_cron every minute, and the app right after sending |
| `type-inbound` | Stores email for Type addresses | Brevo inbound parsing: `https://<ref>.functions.supabase.co/type-inbound?token=<INBOUND_SECRET>` |
| `type-inbox-worker` | Turns platform events into inbox cards; cleans up deleted accounts | pg_cron every minute |

## 4. Schedules

Turn on `pg_cron` and `pg_net` (Database, Extensions), then:

```sql
select cron.schedule('type-send', '* * * * *', $$
  select net.http_post(url := 'https://<ref>.functions.supabase.co/type-send',
                       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'))
$$);
select cron.schedule('type-inbox-worker', '* * * * *', $$
  select net.http_post(url := 'https://<ref>.functions.supabase.co/type-inbox-worker',
                       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'))
$$);
```

Only once `type-inbox-worker` is deployed, switch its consumer on, so nothing queues for a worker
that does not exist:

```sql
update elum.consumers set active = true where id = 'type-inbox';
```

## 5. Auth settings

Add Type's URL to Auth's Redirect URLs. Keep email confirmation on (for external accounts), minimum
password length 8, and leaked password protection on. Set `VITE_ELUM_COOKIE_DOMAIN` to the family
domain in every ELUM app so one sign-in covers them all.

## Watching it

Outside mail that will not go: `select * from type.outbox where status = 'failed' or (status = 'pending' and available_at < now() - interval '1 hour');`
Platform events Type has not handled: the same check on `elum.deliveries where consumer_id = 'type-inbox'`.

## Tests

`tests/run.sh` creates a throwaway database for each `*.test.sql`, applies a small stand-in for
Supabase's `auth` and `storage` schemas (`tests/supabase-stub.sql`, from Write), the copies of the
platform migrations in `platform/`, `platform-changes/`, then `migrations/`, and runs the test.
`type.test.sql` checks every access rule: who sees which message, Bcc, drafts, files, outside mail,
threading, spam, cards, vacation replies, recovery codes and account deletion.

```sh
PGHOST=localhost PGUSER=postgres sh supabase/tests/run.sh
```

`platform/` must match the Write repository. When the platform changes there, copy it again.
