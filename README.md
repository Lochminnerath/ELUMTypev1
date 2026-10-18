# ELUM Type

Messages and email in one calm inbox. Built by people. Runs without AI.

Type is ELUM's messaging app. It sits on the same ELUM platform as [Write](https://github.com/Lochminnerath/ELUMWritev1): one account, one sign-in, one notification bell, one design system.

- **ELUM conversations**: between ELUM people, delivered the moment they are sent, shown as bubbles.
- **Email**: to and from anyone, through Brevo, shown as cards. Each Type account has an address such as `ada@type.elum.services`.
- **Inbox cards**: when someone shares a Write document with you, it arrives in your inbox with *Open in Write*.
- **Private by default**: remote images in email stay hidden until you allow them; received HTML is cleaned twice and shown without scripts; Bcc stays Bcc.

## Run it

```sh
npm install
npm run dev        # http://localhost:5174
```

With no settings, Type runs in **preview mode**: accounts and messages live in this browser, three demo people are there to talk to, and email to outside addresses is simulated (one demo contact writes back). Create two accounts to message between them.

To run on the ELUM platform, copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. [supabase/README.md](supabase/README.md) covers the database, edge functions, mail domain and schedules.

## Checks

```sh
npm run typecheck
npm test                       # app and edge-function helpers (vitest)
npm run test:db                # every database access rule, against Postgres (needs psql)
npm run build
```

## Where things are

| Path | What |
| --- | --- |
| `src/api/` | `TypeApi`, the one interface the UI talks to; `SupabaseApi` (the platform) and `LocalApi` (preview) behind it |
| `src/inbox`, `src/thread`, `src/compose`, `src/pages` | The screens: inbox, conversation, composer, contacts, settings, sign-in |
| `src/components`, `src/styles` | The shared ELUM components and tokens (from Write), with Type's mint accent |
| `src/lib/sanitize.ts` | How received email is made safe to show |
| `supabase/migrations/` | The `type` schema: tables, row level security, the `type_*` functions |
| `supabase/functions/` | Edge functions: `type-signup`, `type-send`, `type-inbound`, `type-inbox-worker` |
| `supabase/tests/` | SQL tests for every access rule |
| `supabase/platform/` | Copies of Write's and the platform's migrations, applied only in tests |
| `supabase/platform-changes/` | Platform changes Type needs, to move into the platform migrations |
| `docs/TYPE.md` | How Type works with the platform and with Write |
