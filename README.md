# ShiftTracker server

API and live dashboard for the ShiftTracker app.

```
lib/core.js                 API logic (shared)
netlify/functions/api.mjs   Netlify Function: serves /api/*, stores data in Netlify Blobs
server.js                   Local Node server: same API, stores data in data.json
public/index.html           Dashboard (static)
```

## Deploy to Netlify

1. In Netlify: **Add new site → Import an existing project → GitHub** → pick this repo.
2. Leave the build settings empty; `netlify.toml` already sets them (publish `public`, functions `netlify/functions`).
3. Deploy. The dashboard is at `https://mvptrackerserver.netlify.app` and the API at `https://mvptrackerserver.netlify.app/api/...`.
4. The app already uses `https://mvptrackerserver.netlify.app` as its default server.

Netlify Blobs needs no setup. Each site gets its own store automatically.

## Run locally

```bash
npm install
npm start          # plain Node on :4000, use the printed LAN URL on a phone
npm run dev        # Netlify emulation (function + Blobs sandbox) on :8888
npm run simulate   # fake employee; set API_URL=https://mvptrackerserver.netlify.app to target production
```

Demo logins: `alex@acme.co`, `priya@acme.co`, `sam@acme.co` with password `password123`.
This is a demo: the passwords are hard-coded and the dashboard has no login.
