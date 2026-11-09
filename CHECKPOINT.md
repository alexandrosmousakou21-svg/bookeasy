# BookEasy checkpoint — 2026-11-09

Base commit before this checkpoint: `e0cc45c`. Nothing pushed, deployed, or applied to production. Production Supabase untouched.

## Completed
- **AI bot**: root cause found (production runs a stale `ai-assistant` build returning `createClient is not defined`; `customer-assistant`, `customer-support`, `create-checkout` return 404; production DB lacks all migrations after the base schema, which also explains `list_active_plus_businesses` PGRST202). Code rewritten as testable handler `supabase/functions/_shared/professionalAi.ts` (per-user rate limits, history, EN/GR, typed error codes, no mock replies). `customer-assistant` got language + history support. Frontend shows specific AI errors.
- **Booking integrity (prepared, NOT applied)**: migration `20261109000000_booking_integrity_atomic_saves.sql` (server-side booking validation trigger; atomic `replace_working_hours`, `replace_business_media`, `save_business_profile`). Frontend already calls these RPCs, so migrations must be applied before deploying this frontend.
- **Push retry (prepared, NOT applied)**: `20261109000001_push_delivery_retry.sql` + reclaim logic in `send-professional-push`.
- **Bundle**: vendor chunk split in `vite.config.js`; 3D chunk stays lazy.
- **UI redesign**: brand palette tokens (`design-system.css`), new `brand.css`, `ui.jsx` (toasts, confirm dialog, skeleton, empty state, status dot), collapsible sidebar, mobile tab bars, dashboard insights from real data, booking stepper, customer greeting/rebook, scene recolored with day/night tone.
- **Test tooling**: `tests/run-db-tests.sh` + `tests/db/*` run schema + all migrations in a disposable local Postgres.

## Incomplete / not started
- **Phase 5 UI audit report was NOT delivered** (audit scripts ran, report not written). Findings gathered so far, all unfixed:
  - Critical: deleting a service or staff member cascades to their appointments (schema `on delete cascade`); the new confirm dialogs do not warn about that. Consider soft-delete via `is_active`.
  - Editor modal (`Editor` in `src/App.jsx`) has no dialog role/aria-modal/label, no focus move, no Escape, no focus trap, close button has no accessible name. Mobile drawer: no focus move, no Escape.
  - Axe: unlabeled `<input type="time">` in hours editors; icon-only delete buttons on service/staff cards without names; `aria-label` on `<strong>` in `WeeklyActivity.jsx`; no `<main>` on 10 auth/public pages; calendar scroll region not keyboard focusable; no skip link; slot buttons lack `aria-pressed`.
  - Insights: heading "Έσοδα κρατήσεων" (`App.jsx` ~L1234) is booked value, not revenue; month uses device timezone; `today` uses UTC (`~L978`); price taken from current service price; `useData` has no pagination (default 1000-row cap skews metrics); "customers" defined differently in Overview (customer_id) vs Customers page (email); sidebar "Ραντεβού" badge counts all-time incl. cancelled.
  - Off-brand leftovers: `index.html` theme-color and `public/manifest.webmanifest` (`#C9A98F`, `#F6EFE6`), `public/icons/*.svg` beige/brown, `customer.css` `#eee/#ddd`, `ambient.css:37` `rgba(246,248,251)`. Dead code in `App.jsx`: `WorkingHours`, `PublicBooking`, `CustomerAppointments`; large commented legacy HTML block in `index.html`; root `app.js`/`styles.css` unused.
  - Scene: renders continuously (~40 fps desktop / 20 mobile); `slowFrames` never decays; resize handler not debounced; no `forceContextLoss` on disable. No leaks, one GL context, context loss/restore works, pauses when hidden.
  - Android: `values/colors.xml` missing (styles.xml references `@color/colorPrimary` etc.) so the native build will likely fail.
- Super Admin, password reset, account deletion/export, privacy/terms pages, email outbox worker, reminders: not implemented.
- Edge Function code (Deno) not unit-tested; no real OpenAI/Stripe/push calls were made.

## Files changed (tracked, modified)
`src/App.jsx`, `src/ambient.css`, `src/ambientScene.js`, `src/customer.css`, `src/customer.jsx`, `src/design-system.css`, `src/functional.css`, `src/lib/functions.js`, `src/main.jsx`, `src/styles.css`, `vite.config.js`, `supabase/functions/ai-assistant/index.ts`, `supabase/functions/customer-assistant/index.ts`, `supabase/functions/send-professional-push/index.ts`

## Files added
`src/brand.css`, `src/ui.jsx`, `supabase/functions/_shared/professionalAi.ts`, `supabase/migrations/20261109000000_booking_integrity_atomic_saves.sql`, `supabase/migrations/20261109000001_push_delivery_retry.sql`, `tests/ai-assistant.test.js`, `tests/run-db-tests.sh`, `tests/db/*`, `CHECKPOINT.md`

Deliberately excluded from Git: `bookeasy.zip` (contains `.env.local`). `.env.local` is gitignored.

## Verification at checkpoint
- `npm run build`: passed. `git diff --check`: clean.
- JS tests: 15/15 passed (`node --test tests/*.test.js`).
- DB suite (`./tests/run-db-tests.sh`, local Postgres only): passed (migration chain, booking integrity, atomic saves, push retry).
- Earlier this session (local fixtures, not re-run now): 21 interaction checks passed; layout checks at 1440/768/390/340 clean; axe and contrast audits as listed above.
- Not verified: real login/booking/checkout, production behavior, Android/iOS builds, real AI provider calls.
- Secret-pattern scan of all changed/new files: no matches.

## How to continue
1. `git log --oneline -3` should show the checkpoint commit on top of `e0cc45c`.
2. Run `npm run build`, `node --test tests/*.test.js`, `./tests/run-db-tests.sh`.
3. Dev preview: `npm run dev -- --host 0.0.0.0 --port 4173 --strictPort`.
4. Next step (needs approval): write the Phase 5 audit report from the findings above, then fix in order: cascade-delete warning/soft-delete, modal/drawer accessibility, metric labels and timezone, palette leftovers (manifest/icons/theme-color), dead code removal.
5. Before any deploy: review and apply migrations `20261002`…`20261109000001` to staging first, deploy Edge Functions, set secrets (`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, Stripe, VAPID), then the frontend.
