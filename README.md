# BookEasy

Multi-tenant appointment booking SaaS UI built with React, Vite, React Router and Supabase.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and add only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Apply `supabase/schema.sql`, then apply `supabase/migrations/20261002_support_reliability.sql` and `supabase/migrations/20261003_stripe_subscriptions.sql` in order before using booking availability, support, or subscription features.

Never add service-role or OpenAI credentials to `VITE_*` variables. Deploy the Edge Functions after applying the migration:

```bash
supabase functions deploy ai-assistant
supabase functions deploy customer-assistant
supabase functions deploy customer-support
supabase functions deploy create-checkout
supabase functions deploy manage-subscription
supabase functions deploy stripe-webhook
supabase secrets set OPENAI_API_KEY="<OpenAI secret>"
```

Configure these server-side Stripe settings in Supabase Functions (names only here): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_BASE_URL`. Do not add them to `VITE_*` variables or commit their values. Register the Stripe webhook for `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.

BookEasy subscription Checkout explicitly uses Stripe's hosted `card` payment method and requests automatic 3D Secure authentication when Stripe requires it. This supports Visa and Mastercard when those networks are enabled and eligible for the Stripe account, customer, country, currency, and recurring subscription. In Stripe Dashboard, switch separately to Test mode and Live mode, then open Settings → Payments → Payment methods and confirm Cards is active in each mode. Test with a subscription price and API keys from the same mode; verify Visa and Mastercard in the hosted Checkout before enabling Live payments. Do not enable card logos in BookEasy based only on configuration. BookEasy does not collect or store card details. Subscription status is updated from signed, verified Stripe webhook events, not from the return page.

For Test mode, create monthly recurring test Prices in Stripe and use matching test-mode identifiers throughout the Checkout, subscription webhook, subscription-management allowlist, and SQL subscription-price validation. Those identifiers are currently fixed in the repository, so changing only `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` is not sufficient; use a separate test Supabase project and a reviewed migration/configuration update before testing. Configure that project's test-mode Stripe secrets, use a test `APP_BASE_URL`, and register the listed webhook events on a Stripe test endpoint. Do not replace Live secrets or price IDs in production without approval. The repository does not include credentials and cannot verify card-brand availability, merchant activation, or a real Test/Live transaction from this environment.

The existing `create-checkout` Edge Function now requires the request's valid Supabase user session and the server-side `APP_BASE_URL` (the app's HTTPS origin, without a path) for checkout return URLs. It ignores client email for identity and uses the verified account email. Configure `APP_BASE_URL` as a Supabase function secret/config value before enabling checkout.

Human requests appear in the professional inbox using Supabase Realtime, with polling as a fallback. Email notifications are optional and require server-side `RESEND_API_KEY` and `RESEND_FROM_EMAIL` secrets; without them, requests are still stored and visible in the inbox. The professional email is stored in an owner-only table and is only included in public AI answers when the business explicitly enables public visibility.

The service worker caches the static app shell, manifest, icons, and built assets only. Booking data, support conversations, and Supabase responses are not cached for offline use. On iOS, install from Safari's Share menu; Android and desktop browsers can offer their normal install prompt.

## Routes

- `/login` and `/register` for owner authentication flows
- `/dashboard` for the owner workspace
- `/b/:slug` for a public business booking page
- `/my-appointments` for customer bookings

## Mobile apps

BookEasy is packaged with Capacitor using the same React build and Supabase backend:

```bash
npm run cap:sync
npm run cap:android
npm run cap:ios
```

The native projects are in `android/` and `ios/`. Android uses package ID `com.bookeasy.app`; iOS uses the same Capacitor app identifier. Open the projects on a machine with Android Studio or Xcode to run them on a device or simulator.

Capacitor is already part of the project, so no additional native wrapper is needed. Keep the PWA stable first; native release signing, push-notification credentials, store metadata, and device testing remain platform-release steps.

## Error monitoring

Frontend render, global JavaScript, AI, booking, and support failures are sent through `reportCriticalError` with redacted context. An optional `window.Sentry` provider can be connected without changing feature code. No monitoring provider is configured in this repository, so remote alert delivery requires choosing a provider and supplying its credentials through deployment secrets.