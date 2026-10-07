# OrbitalView

Interactive 3D map of satellites in Earth orbit.

## Deploy on Vercel

1. Upload this project to GitHub (everything in this folder except `node_modules` if present).
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
3. Framework: **Next.js** (auto-detected). Click **Deploy**.

No environment variables needed. Vercel runs `npm install` and `npm run build` automatically.

The satellite catalog under `public/data` is baked daily by GitHub Actions (`npm run fetch:sats`).

## What's in this folder

| Path | Purpose |
|------|---------|
| `src/` | App code |
| `public/` | Earth texture + Starlink fallback data |
| `package.json` | Dependencies (Vercel reads this) |
| `next.config.ts` | Next.js config |
| `tsconfig.json` | TypeScript config |

Satellite data is fetched from [CelesTrak](https://celestrak.org) at runtime and cached for 2 hours.