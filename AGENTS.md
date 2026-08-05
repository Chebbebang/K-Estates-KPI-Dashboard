# AGENTS.md

Guidance for AI agents working on this codebase.

## Commands

- `npm run dev` — starts API server (:4010 from `.env` PORT) and Vite dev server (:5173, proxies `/api` → :4010) concurrently
- `npm run build` — production build via Vite (outputs to `dist/`)
- `npm start` — production: Node serves `dist/` + API on :4010
- `npm run preview` — Vite preview

## Architecture

- **`server/index.js`** — single-file Node/Express backend. Holds the Bitrix24 webhook (from `.env`, secret), fetches KPIs from Bitrix24 REST, caches results in memory for 60s (single-flight refresh), serves `dist/` in production.
- **`src/`** — React 18 + Vite frontend. Polls `GET /api/kpis` every 60s via `src/hooks/useKpiData.js` (also refetches on window focus). `src/App.jsx` defines the KPI card configs; `src/components/KpiCard.jsx` renders a card (shows "no access" state when `ok:false`); `src/components/PersonsTable.jsx` renders the responsible-persons table + skeleton (skeleton markup is inline in `App.jsx`).
- Frontend never calls Bitrix24 directly — always through the API server.
- Header has no live chip / refresh button / footer — auto-refresh only.

## Bitrix24 specifics (verified against kestates.bitrix24.com)

- Property Inventory SPA = entityTypeId **1032** (entity 1037 does NOT exist in this CRM).
- Categories on 1032: **17** = Sales Listings, **57** = Rental Listings.
- `crm.item.list` date filters must use `>createdTime` / `>updatedTime` — `>=` or `>DATE_MODIFY` are ignored (returns unfiltered total).
- `crm.item.list` returns `total` only when `start=0` (no `start=-1` support).
- `tasks.task.list` fails with `401 insufficient_scope` for this webhook — Tasks app is not accessible via REST (no card uses it).
- `user.get` (not `user.list`) returns user info incl. `ACTIVE` flag; `crm.item.list` `assignedById` = responsible person.
- Timeline comments on inventory items use `ENTITY_TYPE=dynamic_1032`.
- Stage IDs on 1032 (via `crm.status.list` with `filter[ENTITY_ID]=DYNAMIC_1032_STAGE_{17|57}`): cat 17 → `DT1032_17:NEW` = "For Sale (Offline)", `DT1032_17:UC_BU9FIW` = "For Sale (Online)"; cat 57 → `DT1032_57:PREPARATION` = "Rent (Offline)", `DT1032_57:CLIENT` = "Rent (Online)". Pocket listings = the two *Offline* stages.
- MEETING (TYPE_ID 1) and CALL (TYPE_ID 2) activities show ~0 in last 7 days from this webhook (visibility limitation).
- CRM-wide `crm.timeline.comment.list` is not supported — comments are counted per-lead via `batch` (`filter[ENTITY_ID]=X&filter[ENTITY_TYPE]=lead`), 50 leads per batch.

## Conventions

- Plain JavaScript, ESM (`"type": "module"`), Node 20+ (global `fetch` used in server).
- No TypeScript, no lint config — match existing style (single quotes, no semicolons-free blocks, 2-space indent).
- KPI response shape: `{ ok, value, ...extra }`; on failure `{ ok:false, value:null, error }`. Add new KPIs by adding a collector in `server/index.js` + a card config in `src/App.jsx`.
- All CRM settings live in the CONFIG block at the top of `server/index.js`.
- `.env` (webhook token) is gitignored — never commit it.
