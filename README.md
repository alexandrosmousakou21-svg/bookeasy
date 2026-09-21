# BookEasy

Multi-tenant appointment booking SaaS UI built with React, Vite, React Router and Supabase.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local`, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then apply `supabase/schema.sql` in the Supabase SQL editor before running the app.

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