# AGENTS.md

Guidance for AI agents working on this codebase.

## Commands

- `npm run dev` — starts API server (:4010 from `.env` PORT) and Vite dev server (:5173, proxies `/api` → :4010) concurrently
- `npm run build` — production build via Vite (outputs to `dist/`)
- `npm start` — production: Node serves `dist/` + API on :4010
- `npm run preview` — Vite preview

## Architecture

- **`server/index.js`** — single-file Node/Express backend. Holds the Bitrix24 webhook (from `.env`, secret) and serves `dist/` in production.
  - KPI registry (`KPIS` map): each KPI has its own TTL — cheap KPIs 60s, heavy ones (`heavyRefreshSeconds`, 300s) — with single-flight fetch + stale-while-revalidate (expired KPIs are served from cache while refreshing in the background).
  - **Shared inventory scan** (`scan` KPI): one parallel `batch` pagination pass over all 529 inventory items with extended `select`. `kpiPersons` + all listing-derived KPIs (inventoryValue, topCommunities, inventoryMix, rentalHealth, saleRentListings) consume it. `parents` KPI resolves community/property names via `crm.item.get` batches.
  - Snapshot persistence: every `snapshotIntervalMs` (15 min) the current payload is appended to `data/snapshots.jsonl` (gitignored). `history.deltas` in the API = "vs last week" comparison (closest snapshot to 7 days ago, ±6h window). Needs ~7 days of uptime to populate.
  - `GET /api/kpis` returns `ETag` + `Cache-Control: no-cache`; sends 304 when `If-None-Match` matches (etag is stable because `updatedAt` comes from the assembled payload, not per-request time).
- **`src/`** — React 18 + Vite frontend. Polls `GET /api/kpis` every 60s via `src/hooks/useKpiData.js` (sends `If-None-Match`, honors 304, refetches on window focus only if stale >30s). `src/App.jsx` defines the KPI card configs (`CARDS` — cards may render a zero-dependency chart via `chart(kpi)`); `src/components/KpiCard.jsx` renders a card (shows "no access" when `ok:false`, and a ▲/▼ "vs last week" chip when `history.deltas` has an entry); `src/components/VBarChart.jsx` (vertical bars, dealsMonthly) and `src/components/HBars.jsx` (horizontal rows, communities/bedrooms/sources); `src/components/PersonsTable.jsx` renders the responsible-persons table + skeleton (skeleton markup is inline in `App.jsx`).
- Frontend never calls Bitrix24 directly — always through the API server.
- Header shows an "Updated Xm ago" chip (auto-refresh only; no manual refresh button).

## Bitrix24 specifics (verified against kestates.bitrix24.com)

- Property Inventory SPA = entityTypeId **1032** (entity 1037 does NOT exist in this CRM).
- Categories on 1032: **17** = Sales Listings, **57** = Rental Listings.
- Custom fields on 1032 (all in CFG.fields): `ufCrm9_1739781164039` = price as `"6364000|AED"` string, `ufCrm6_1724863930215` = Bedrooms (enum), `ufCrm10_1725613911` = Property type (enum), `parentId1052`/`parentId1036` = Community/Property (SPAs 1052/1036), `ufCrmClosedate` = "Finished on" (currently empty everywhere), `ufCrm10_1726036398659`/`...06424806` = Rented/Notice Served (`Y`/`N`), `ufCrm10_1726035902221` = Listing Date. Enums resolved at runtime via `crm.item.fields`; source names via `crm.status.list` (`ENTITY_ID=SOURCE`).
- `crm.item.list` date filters must use `>createdTime` / `>updatedTime` — `>=` or `>DATE_MODIFY` are ignored (returns unfiltered total).
- `crm.item.list` returns `total` only when `start=0` (no `start=-1` support).
- `tasks.task.list` fails with `401 insufficient_scope` for this webhook — Tasks app is not accessible via REST (no card uses it).
- `user.get` (not `user.list`) returns user info incl. `ACTIVE` flag; `crm.item.list` `assignedById` = responsible person.
- Timeline comments on inventory items use `ENTITY_TYPE=dynamic_1032`.
- Stage IDs on 1032 (via `crm.status.list` with `filter[ENTITY_ID]=DYNAMIC_1032_STAGE_{17|57}`): cat 17 → `DT1032_17:NEW` = "For Sale (Offline)", `DT1032_17:UC_BU9FIW` = "For Sale (Online)"; cat 57 → `DT1032_57:PREPARATION` = "Rent (Offline)", `DT1032_57:CLIENT` = "Rent (Online)". Pocket listings = the two *Offline* stages.
- MEETING (TYPE_ID 1) and CALL (TYPE_ID 2) activities show ~0 in last 7 days from this webhook (visibility limitation).
- CRM-wide `crm.timeline.comment.list` is not supported — comments are counted per-lead via `batch` (`filter[ENTITY_ID]=X&filter[ENTITY_TYPE]=lead`), 50 leads per batch.
- **Batch (`batch` API) pagination quirks (critical — verified empirically):**
  - `crm.item.list` inside batch honors `start` and returns sub-results as `{ items: [...] }`.
  - Old-API lists (`crm.deal.list`, `crm.lead.list`, `crm.activity.list`) return plain arrays inside batch **and silently ignore `start` whenever a comparison-operator filter (`>=` etc.) is present** — pages would duplicate. Use `pagedCollect` (sequential direct POST pagination) for these, never batch pagination.
  - In batch cmd strings, comparison symbols in filter KEYS (`>=DATE_CREATE`) must be percent-encoded (`filter[%3E%3DDATE_CREATE]=...`) or the filter is silently ignored (see `encodeKey` in `batchQuery`); `[]` brackets must stay literal. This applies to `crm.lead.list` batch pages too.

## Conventions

- Plain JavaScript, ESM (`"type": "module"`), Node 20+ (global `fetch` used in server).
- No TypeScript, no lint config — match existing style (single quotes, no semicolons-free blocks, 2-space indent).
- KPI response shape: `{ ok, value, ...extra }`; on failure `{ ok:false, value:null, error }`. Add new KPIs by adding a collector in `server/index.js`, registering it in the `KPIS` registry with a TTL, and adding a card config in `src/App.jsx`.
- All CRM settings live in the CONFIG block at the top of `server/index.js`.
- `.env` (webhook token) and `data/` (snapshots) are gitignored — never commit them.
