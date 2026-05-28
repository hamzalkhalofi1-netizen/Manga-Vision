# MangaVerse

A React Native/Expo manga reading app with AI translation (Arabic/English), source switching, and a cloud API proxy layer.

## Run & Operate

- **Primary workflow**: `MangaVerse` — runs `start.sh` which starts both:
  - Dev proxy on port 5000 (webview) — routes `/api/*` → API server (port 3000), `*` → Expo dev server (port 5001)
  - Expo dev server on port 5001 (Metro bundler)
- **API server**: `API Server` workflow — `PORT=3000 pnpm --filter @workspace/api-server run dev`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **Mobile**: Expo SDK 54, React Native 0.81, expo-router v3
- **API**: Express 5, port 3000
- **DB**: PostgreSQL + Drizzle ORM
- **AI**: Google Gemini (manga page OCR + translation)
- **Proxy**: Zero-dependency Node.js proxy (`artifacts/mobile/server/proxy.js`)

## Where things live

- `artifacts/mobile/` — Expo mobile app
  - `app/(tabs)/` — tab screens (Home, Explore, Library, Profile)
  - `app/reader.tsx` — manga reader screen
  - `app/manga.tsx` — manga detail screen
  - `services/sources/` — manga source adapters (MangaDex, Comick, etc.)
  - `server/proxy.js` — dev proxy
  - `server/start.sh` — starts proxy + Expo together
- `artifacts/api-server/` — Express API
  - `src/routes/source-proxy.ts` — CORS proxy for source APIs
  - `src/routes/translate-image.ts` — Gemini translation endpoint

## Architecture decisions

- **Single-origin dev proxy**: Browser makes relative `/api/...` calls → proxy on port 5000 routes to API server on port 3000. Solves CORS without modifying production domains. Expo serves web app on port 5001, proxied through port 5000.
- **`DANGEROUSLY_DISABLE_HOST_CHECK=true`** is mandatory in `start.sh` and the `dev` npm script. Without it, Metro rejects requests where the `Host` header is the Replit external domain (not `localhost`), causing an endless reload loop.
- **Proxy host override**: The proxy explicitly sets `host: localhost:{targetPort}` on all forwarded requests as belt-and-suspenders against Metro's host check.
- **GlobalWebViewBridge**: Persistent hidden WebViews (native only) accumulate CF cookies for Cloudflare-protected sources. On web, bridge returns "idle" immediately via `useState` lazy initializer + `useEffect` (never in render body).
- **All API calls use relative URLs** (`/api/...`) — no `EXPO_PUBLIC_DOMAIN` env var needed. Works across localhost, Replit proxy, and custom domains.

## Product

- Browse trending/latest manga across 10+ sources (MangaDex, Comick, MangaFire, Asura Scans, Bato.to, etc.)
- Read chapters with vertical or horizontal scrolling
- AI translation overlay (manga page OCR via Gemini → Arabic/English text rendered as SVG speech bubbles)
- Library with reading progress tracking
- Download chapters for offline reading (native only)
- Cloudflare challenge handling for CF-protected sources (native only via WebView bridge)

## User preferences

_Populate as you build._

## Gotchas

- **Always keep `DANGEROUSLY_DISABLE_HOST_CHECK=true`** in both `start.sh` and the `dev` npm script. Removing it breaks the Replit webview (Metro rejects the Replit domain Host header → endless reconnect loop).
- **Port 5001 is not a Replit workflow-supported port**. Never configure `artifacts/mobile: expo` as a standalone workflow with `waitForPort: 5001`. Run Expo as a subprocess inside `MangaVerse` via `start.sh` instead.
- The `artifacts/mobile: expo` artifact workflow will show "failed" in the Replit dashboard — this is expected and harmless. `MangaVerse` is the actual running workflow.
- `pnpm --filter @workspace/db run push` requires `DATABASE_URL` env var set.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
