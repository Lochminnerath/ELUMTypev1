# How ELUM Type works

This builds on the platform handoff (Write's `docs/ELUM-PLATFORM.md`) and says what Type does with it. Read section 8 of the handoff first.

## The pieces

```
 type.elum.example (this app)
   │  supabase.rpc('type_*')       Type's own functions: inbox, threads, send, drafts, settings
   │  supabase.rpc('elum_*')       the platform: join the service, the bell, handle checks
   │  Realtime                     type.messages, type.participants, type.inbox_cards, elum.notifications
   │  Storage                      type-attachments bucket
   │  functions.invoke             type-signup (new Type accounts), type-send (send outside mail now)
   ▼
 one Supabase project
   type.*   Type's tables (this repository's migration)        elum.*   the platform (Write repository)
   ▲                                                             │ events → deliveries
   │ type_receive_email                                          ▼
 type-inbound  ◀── Brevo inbound (mail for @type domain)     type-inbox-worker  (consumer 'type-inbox')
 type-send     ──▶ Brevo outbound (mail to anyone else)      email worker (platform, not built yet)
```

The app never imports Supabase directly: every call goes through `TypeApi` (`src/api/client.ts`). `SupabaseApi` implements it on the platform; `LocalApi` implements the same rules in the browser for previews and tests.

## Accounts and sign-in

- **One account.** Type never has its own user table. It reads `public.profiles` and calls `elum_join_service('type')` on every start (`TypeApi.start()`), which emits `elum.service.joined` the first time.
- **Shared sign-in.** With `VITE_ELUM_COOKIE_DOMAIN=.elum.example`, the session is stored in cookies on the family domain under the key `elum-auth`, using Write's `cookieStorage.ts` unchanged. Signing in to Write signs you in here, and signing out anywhere signs out everywhere.
- **Type accounts** are created by `type-signup` (service role): captcha, `type_signup_guard` (5 an hour per IP), `elum_handle_available`, `auth.admin.createUser` with `handle@<type domain>` already confirmed, then `elum_assign_type_address`. The app then signs in with the password. A recovery email gets a 6-digit code (stored hashed in `type.recovery_codes`); the person enters it under Settings and it becomes a verified alias on the account.
- **External accounts** (people who signed up with Gmail and so on) can use Type too. Their mailbox is their login address and reaches ELUM people only: emailing outside from a Gmail address through Brevo would fail DMARC, so Type says "Get an ELUM address" instead.
- **Handles** are checked as people type: the format locally (`src/api/validation.ts`, same rules as the database), availability with `elum_handle_available`.

## Mailboxes, threads and copies

| Table | Holds |
| --- | --- |
| `type.mailboxes` | An account's addresses in Type. `can_email` is true for Type addresses. |
| `type.threads` | A conversation: `elum` (ELUM people only) or `email` (anyone outside is in it). |
| `type.participants` | Who is in a thread, and each mailbox's folder, read time and mute. `hidden` marks people who were only Bcc'd. |
| `type.messages` | Each message once, with its To and Cc as shown on the message. |
| `type.message_recipients` | Which mailboxes hold a copy. **People see a message only if it was sent to them.** |
| `type.outbox` | One row per outside address, drained by `type-send`. Bcc addresses live only here. |
| `type.drafts`, `type.attachments` | Drafts saved as people type (with a version), and files in `type-attachments/<message or draft id>/<file>`. |
| `type.inbox_cards` | Platform events shown in the inbox, one per event. |

Per-message copies (instead of "everyone in the thread sees everything") is what keeps a Bcc private, and stops someone added later, or a spoofed reply, from reading what came before.

Changes from the draft in the handoff, and why:

- `type.message_recipients` and `type.outbox` were added for the reason above.
- Drafts have their own table (a new message has no thread yet) and a `version` for "keep mine / load theirs".
- Attachments are stored under the message (or draft) id rather than the thread, because access is per message.
- Messages record `snippet`, `in_reply_to`, `auto` (vacation replies) and `has_remote_images`.

## Sending

`type_send_message(id, mailbox, thread, to, cc, bcc, subject, text, html)` is the only way to send. It checks that the mailbox is yours, that every address is an address, the limits (600 messages an hour; 200 outside addresses a day), and that an external-account mailbox is not emailing outside. Then each recipient address goes through `elum.account_for_address`:

- **An ELUM account** (by Type address, login email or verified alias): its mailbox gets a copy straight away. Realtime tells their open apps, and `elum.emit('type.message.received')` puts "Rae sent you a message" in their bell in every ELUM app. Muted threads skip the notification.
- **Anyone else**: a row in `type.outbox`. The app pokes `type-send`, which sends through Brevo within a second (and the minute schedule catches anything missed). Delivery status comes back as `delivered` or "Not delivered to …".

The app chooses the message id (it is the draft id), so a retried send returns the first result instead of sending twice.

## Receiving email

Brevo's inbound parsing posts each message to `type-inbound?token=<INBOUND_SECRET>`. The function reads the payload (`fromBrevoInbound` in `_shared/mail.ts`), downloads attachments into Storage, cleans the HTML with `sanitize-html`, and calls `type_receive_email`, which:

- delivers only to mailboxes that can receive mail (Type addresses);
- treats the same Message-ID arriving twice as one message;
- threads a reply by `In-Reply-To` and `References`, matching our Message-IDs or the one Brevo gave our message, but **only into a thread the sender is already part of**, so a made-up header cannot push a stranger into a conversation;
- sends new threads judged as spam (DMARC fail, SPF and DKIM both failing, or a high spam score) to Spam, without notifications;
- sends vacation replies, never to automatic mail (`Auto-Submitted`, `Precedence: bulk`, list headers, no-reply senders) and at most once every four days per sender.

In the app, received HTML is cleaned again with DOMPurify and shown in an `<iframe sandbox>` with no `allow-scripts` and a `default-src 'none'` content security policy. Remote images and CSS backgrounds are removed until the person chooses "Show images" or "Always from this sender" (or sets images to "Always show").

## Working with Write

Write needs no changes for any of this.

1. Ola shares "Field notes" with `ada@type.elum.example` in Write. `share_by_email` resolves the Type address to Ada's account and emits `write.document.shared`.
2. The platform puts the notification in Ada's bell and a delivery in the `type-inbox` consumer's queue. Write's `send-share-emails` already skips Type accounts, so no email is sent.
3. `type-inbox-worker` claims the delivery. Its channel is `type_inbox`, so `cardFor` (`_shared/cards.ts`) makes "Ola Owner shared “Field notes” with you" with **Open in Write** linking to `https://write.elum.example/d/<id>`, and `type_add_card` stores it, once per event.
4. The other way: a Type message emits `type.message.received`, so Write's bell shows "Rae sent you a message", linking to `https://type.elum.example/t/<thread>` (the link uses `elum.services.url` for Type once it is set).
5. `elum.account.deleted` reaches the worker too; `type_forget_account` removes the mailboxes, drafts and settings. Messages other people received stay with them, signed "Former member".

## Design

The app copies Write's tokens, base CSS and components (Menu, Popover, Dialog, Toast, TooltipLayer, Avatar, Loader, NotificationBell) and sets the accent once:

```css
:root { --accent: var(--type); --accent-deep: var(--type-deep); --accent-mist: var(--type-mist); --accent-line: var(--type-line); }
```

- Layout (handoff 8.3): 64px app bar (Type lockup, search, app switcher, bell, theme, avatar), 60px rail (Inbox, Unread, Archived, Contacts, Settings; active item on `type-mist` with a 3px mint bar), the list at 320 to 380px, then the conversation. Under 860px it is one column with a back button; under 560px the rail becomes a bottom tab bar.
- The product pill (`elum-btn--product`, mint with ink text) is used once per view: **Compose** in the list, **Send** in the composer and the reply dock.
- ELUM messages are bubbles (yours on `type-mist` with a `type-line` border); email is a card on `page` with headers on demand. Unread rows are bold with a mint dot; ELUM people carry a `badge-check`.
- The reply dock is the floating glass bar from Write (52px, 20px radius, 86% surface, 16px blur).
- Icons are Lucide with the handoff's mapping (`square-pen`, `send-horizontal`, `reply`, `reply-all`, `forward`, `archive`, `paperclip`, `bell-off`, `shield-alert`, `image-off`, `badge-check` …).
- Loaders: the Type loader in the app, the brand loader on sign-in. Reduced motion shows the still mark.

## Platform changes Type needs

`supabase/platform-changes/20261020120000_elum_platform_for_type.sql` belongs in the platform migrations (the Write repository today):

1. **A fix to `elum.assign_type_address`.** As shipped, every Type sign-up fails with "That name is taken": `type-signup` creates the user with the Type address as its email, so the login-address trigger has already stored that address before `assign_type_address` inserts it again. The fix turns the account's own login row into its Type address.
2. **`elum.add_verified_address`**, so a confirmed recovery email becomes a verified alias without Type writing platform tables.

## Not done yet

- The platform email worker, and the central account pages at `account.elum.example` (the app links to them).
- Presence and "seen" in ELUM conversations.
- Captcha in the sign-up form: `type-signup` checks a token when `CAPTCHA_SECRET` is set, but the form does not render a widget yet. Leave `CAPTCHA_SECRET` unset until it does.
- Brevo field names in `fromBrevoInbound` follow Brevo's inbound parsing documentation; check them against a real delivery before launch, and whether Brevo keeps our `Message-Id` header (replies thread either way).
