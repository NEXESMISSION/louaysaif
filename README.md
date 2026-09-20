# 1K Challenge 🏁

A two-player money race. First one to **+1000 TND net** wins.

Both players log every dinar that comes **in (＋)** and goes **out (−)**. The app keeps a
running net for each side, shows who is ahead and by how much, and updates live on both
phones. Installable as a PWA, so it sits on the home screen and works offline.

## How it works

- **Two players, two passwords.** Each person creates their own login on the Join screen
  using a shared invite code. A database trigger enforces both the code and a hard cap of
  two players — a third signup is rejected in Postgres, not just in the UI.
- **Everyone sees everything.** Both players read the full ledger (that is the point of the
  race), but Row Level Security allows writes only to your own rows. You cannot add, edit
  or delete an entry on your rival's side.
- **Live.** Supabase Realtime pushes every new entry to the other phone immediately.

## Stack

Plain HTML, CSS and JavaScript — no framework, no build step, no dependencies to install.
Supabase provides auth, Postgres and realtime. The Supabase client is vendored in
`vendor/` so the app still boots with no network.

```
index.html              app shell
css/styles.css          styles
js/app.js               all app logic
js/config.js            project URL + anon key (public by design — RLS does the guarding)
sw.js                   service worker: caches the shell, never caches data
manifest.webmanifest    PWA manifest
icons/                  generated app icons
vercel.json             static hosting headers
```

## Run it locally

```bash
npx serve .
```

Then open the printed URL. Any static file server works — the app is just files.

## Deploy

Push to GitHub and import the repo on [Vercel](https://vercel.com/new). No build command,
no output directory, no environment variables: it deploys as a static site as-is.

## Database

The schema lives in Supabase (`profiles`, `transactions`, `app_config`) with RLS enabled on
all three tables. Goal, start date and optional deadline are editable in-app from the
**Me** tab.

## A note on keys

`js/config.js` holds the Supabase URL and the **anon** key. Those are meant to be public —
they identify the project, and every table is locked down by Row Level Security. The
`service_role` key and any personal access token must never appear in this repo.
