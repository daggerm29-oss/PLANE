# WORLDVIEW OSINT — Progress Log

> Hand-off file. Any AI/dev continuing this work: read this first, then continue from **Next steps**.
> Source repo: https://github.com/daggerm29-oss/sky8 (branch `main`, imported into the v0 workspace without `.git`).

## Architecture (as found)

```
next dev (port 3000, scripts/dev.mjs)  --rewrites /*-->  Vite dev server (5173)
                                                           artifacts/worldview (React 19 + MapLibre GL v5 + Cesium + three)
                                                           vite.config.ts mounts the Express routers from
                                                           artifacts/api-server/src/routes (proxy.ts, cctv.ts) at /api
Express proxy (/api/proxy/*)  --> upstream maritime backend (SHIPS_UPSTREAM_URL) + adsb.lol + CelesTrak + CCTV feeds
```

- `artifacts/worldview/src/pages/WorldviewMap.tsx` (~2.5k lines) — main map page, state, layers, toolbar.
- `components/ShipsLayer.tsx`, `SatelliteLayer.tsx`, `PlaybackLayer.tsx`, `CctvLayer.tsx` — MapLibre layers.
- `components/CesiumFollowCam.tsx` — Cesium 3D follow camera (pre-existing, aircraft only).
- `components/CinematicOverlay.tsx`, `FloatingPanel.tsx`, `MaritimePanel.tsx`, `MasterToolbar.tsx`.
- `artifacts/api-server/src/routes/proxy.ts` — all upstream proxies (ships, dark-fleet, oil, status, playback, adsb).
- 3D models in `artifacts/worldview/public/`: `aeroplane.glb`, `military-aircraft.glb`, `satellite.glb`, `iss.glb`, `ship.glb`, `tanker.glb`.
- npm workspaces (root `package.json`); install with `npm install` at repo root.

## New backend: https://worldview-intel.ai.studio

Verified live 2026-10-17 (same JSON schema as the old Render backend):
- `/api/status` → `{live_vessels, dark_ships_tracked, ais:{...}, uptime_min}`
- `/api/radar` → `[{mmsi, vessel_name, lat, lon, sog, cog, last_updated, dwt, est_barrels, category, source}]` (~3.3 MB)
- `/api/live` → same without dwt/category
- `/api/dark-fleet` → `[{mmsi, ship_name, last_known_lat, last_known_lon, time_went_dark, last_sog, last_cog}]`
- `/api/analytics/live-oil`, `/api/playback/config` → OK

## Step log

- [x] **Step 1** — Cloned repo, mapped architecture, probed new backend (all endpoints 200).
- [x] **Step 2** — Imported repo into v0 workspace; removed conflicting v0 template files.
- [x] **Step 3** — Backend migration: `proxy.ts` default `SHIPS_UPSTREAM_URL` → `https://worldview-intel.ai.studio`,
      `.env.example` + `replit.md` updated. `grep -r onrender` is clean.
- [ ] **Step 4** — Single-click → right-side info panel (ship / aircraft / satellite).
- [ ] **Step 5** — Double-click → cinematic 3D follow view with GLB models; Esc/exit zooms out.
- [ ] **Step 6** — Install deps, run dev server, browser-verify.

## Design for steps 4–5

New / changed files:
- `src/lib/tracked-entity.ts` — `EntityRef = {kind:"aircraft"|"ship"|"satellite", id}`, `FollowTarget`
  (lat, lon, altM, headingDeg, speedMs), model-URL/scale picker per entity.
- `src/components/EntityInfoPanel.tsx` — right-side panel (top-right, zIndex 30) with live name / position /
  movement / intel fields + "TRACK 3D" / "EXIT 3D" button. Stays visible during tracking.
- `src/components/CinematicTracker.tsx` — generic Cesium follow-cam (replaces aircraft-only CesiumFollowCam usage):
  camera.lookAt each frame with own drag/wheel orbit, dead-reckoning between samples (heading+speed),
  intro zoom-in + fade, exit zoom-out + fade then `onExited`. Trail polyline behind the model.
- `ShipsLayer.tsx` — `onSelect(ship)` on click, `onTrack(ship)` on dblclick.
- `SatelliteLayer.tsx` — `onSelect` + `onTrack` (dblclick) via the projected hit test.
- `WorldviewMap.tsx` — `selectedEntity` + `trackedEntity` state.

Models: `aeroplane.glb` (civil), `military-aircraft.glb` (mil — old code pointed at a missing `jet.glb`),
`ship.glb`, `tanker.glb` (TANKER), `satellite.glb`, `iss.glb` (ISS/ZARYA). All ~1.9 units long on X →
same `heading - 90°` orientation; scale per kind.

## Session 2 (resumed from https://github.com/daggerm29-oss/PLAND)

- [x] Re-imported PLAND repo into v0 workspace (rsync, removed v0 template `components/`, `app/globals.css`,
      `lib/utils.ts`, `postcss.config.mjs`, pnpm files). `npm install` at repo root.
- [x] 4a `src/lib/tracked-entity.ts` (EntityRef, FollowTarget, modelSpecFor, geo helpers)
- [x] 4b `src/components/EntityInfoPanel.tsx` (PanelEntity union; TRACK/EXIT button)
- [x] 4c ShipsLayer `onSelect`/`onTrack` (layer `ships-dot`) + SatelliteLayer `onTrack` (dblclick hit test;
      single-click still goes through `onToggleSelect`)
- [x] 5a `src/components/CinematicTracker.tsx` (props: target, model, exiting, onExited)
- [ ] 5b WorldviewMap wiring (`selectedEntity`, `trackedEntity`, `exitingTrack`)
- [ ] 6 dev server + browser check

## Next steps

See unchecked items above.
