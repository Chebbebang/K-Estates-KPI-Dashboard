# K-Estates KPI Dashboard

Real-time KPI dashboard for K-Estates, pulling live metrics from Bitrix24.

- **Frontend:** React 18 + Vite (plain JS `fetch` polling)
- **Backend:** Node.js + Express proxy that holds the Bitrix24 webhook token server-side (never exposed to the browser)
- **Real-time:** dashboard polls every 60 seconds (with `If-None-Match` / 304 support), per-card error badges, and an "Updated Xm ago" chip
- **Resilient:** per-KPI cache with different TTLs, single-flight fetch, stale-while-revalidate — expired data is served from cache while refreshing in the background

## KPIs

### Number cards

| KPI | Source |
|---|---|
| New Listings (this week) | Property Inventory SPA (`crm.item.list`, entityTypeId 1032) |
| Listings (last 7 days) | Property Inventory created/updated in last 7 days |
| Total Listings | Property Inventory split by Sales (cat 17) / Rental (cat 57) |
| Inventory Value | Sum of "Amount and currency" (`ufCrm9_1739781164039`) over all listings, split sale/rent |
| Deals (Year to Date) | Won deals since Jan 1, count + sum of OPPORTUNITY |
| Viewings (last 7 days) | MEETING activities (`crm.activity.list`, TYPE_ID 1) |
| Pocket Listings (Sale / Rent) | Items in stage "For Sale (Offline)" / "Rent (Offline)" only |
| Rental Health | Rent items flagged as rented / notice served (`ufCrm10_1726036398659` / `...06424806`) |
| Comments (last 7 days) | Timeline comments created in the last 7 days on recently modified leads (batched per-lead) |
| Call Logs (last 7 days) | CALL activities (`crm.activity.list`, TYPE_ID 2), inbound/outbound split |

### Trends & Breakdowns (charts section)

| Card | Source |
|---|---|
| Won Deals (Monthly) | Won deals by `CLOSEDATE` over the last 12 months (bar chart) + average deal size + lost YTD |
| Top Communities | Listings per community (`parentId1052` / `parentId1036`, names via `crm.item.get`) |
| Inventory Mix | Bedroom distribution + property-type mix (enums resolved via `crm.item.fields`) |
| Leads by Source (30 days) | Leads created in the last 30 days grouped by `SOURCE_ID` (`crm.status.list`) |

Cards whose data source is unavailable show a "no access" badge instead of failing the whole dashboard.

### Responsible Persons table

Below the KPIs, a compact table lists every **active** responsible person who owns
Property Inventory listings, with the number of:

- Listings they own
- New listings (created in the last 7 days)
- Timeline comments created in the last 7 days on their listings
  (`crm.timeline.comment.list` with `ENTITY_TYPE=dynamic_1032`)

People can be hidden by adding their user ID to `excludedResponsibleIds` in the CONFIG block.

## "Vs last week" deltas

The server appends a payload snapshot to `data/snapshots.jsonl` (gitignored) every 15 minutes.
Once ~7 days of snapshots have accumulated, cards show a ▲/▼ chip comparing the current value
with the snapshot closest to 7 days ago (±6h window).

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure the webhook (required)
cp .env.example .env
# edit .env and set BITRIX_WEBHOOK=https://your-domain.bitrix24.com/rest/USER_ID/WEBHOOK_TOKEN/
#   and optionally PORT (default 4010)

# 3. Run in development (Vite on :5173, API on PORT from .env, default :4010)
npm run dev

# 4. Production
npm run build
npm start        # serves app + API on :4010
```

Open http://localhost:5173 (dev) or http://localhost:4010 (production).

## Project structure

```
├── server/index.js       # Express API: KPI registry w/ per-KPI TTLs + SWR cache,
│                         #   Bitrix24 collectors, JSONL snapshots, config block at top
├── src/
│   ├── App.jsx           # layout: header, number-card grid, charts section, persons table
│   ├── App.css           # styles (Inter font, cards, charts, skeletons)
│   ├── components/KpiCard.jsx       # card w/ auto-shrinking values + vs-last-week chip
│   ├── components/PersonsTable.jsx  # active responsible persons breakdown
│   ├── components/VBarChart.jsx     # vertical bars (won deals monthly)
│   ├── components/HBars.jsx         # horizontal bar rows (communities / mix / sources)
│   └── hooks/useKpiData.js  # polls /api/kpis every 60s, honors 304, focus refetch
├── data/snapshots.jsonl # snapshot history (gitignored, generated at runtime)
├── index.html
└── vite.config.js        # proxies /api to localhost:4010
```

## Configuration

All Bitrix24 data-source settings live in the **CONFIG block at the top of `server/index.js`**
(entity type ids, sale/rent categories, offline pocket-listing stage ids, cache lifetimes,
comment window, snapshot interval, excluded responsible people, custom-field ids). No frontend
changes needed when the CRM setup changes.

## Security

- The Bitrix24 webhook token lives only in `.env` (gitignored) and is used server-side only.
- The browser never talks to Bitrix24 directly; it only talks to the local API.
- Cards whose data source is unavailable show a "no access" badge instead of failing the whole dashboard.

## Notes

- `crm.item.list` only honors `>`-prefixed date filters on `createdTime` / `updatedTime`
  (`>=` is silently ignored).
- In `batch` sub-commands, `crm.item.list` honors `start`, but old-API lists
  (`crm.deal.list` / `crm.lead.list` / `crm.activity.list`) silently ignore `start` whenever
  the filter contains a comparison operator — the server uses sequential direct-POST
  pagination (`pagedCollect`) for those. Comparison symbols in batch filter keys must be
  percent-encoded (`filter[%3E%3DDATE_CREATE]`).
- CRM-wide comment listing is not supported by the REST API; comments are counted per-entity
  using the `batch` method (`crm.timeline.comment.list`).
- Pocket listings are the inventory items sitting in the *Offline* stages
  ("For Sale (Offline)" / "Rent (Offline)").
