# K-Estates KPI Dashboard

Real-time KPI dashboard for K-Estates, pulling live metrics from Bitrix24.

- **Frontend:** React 18 + Vite (plain JS `fetch` polling)
- **Backend:** Node.js + Express proxy that holds the Bitrix24 webhook token server-side (never exposed to the browser)
- **Real-time:** dashboard auto-refreshes every 60 seconds and on window focus, with per-card error badges

## KPIs

| KPI | Source |
|---|---|
| New Listings (this week) | Property Inventory SPA (`crm.item.list`, entityTypeId 1032) |
| Listings (last 7 days) | Property Inventory created/updated in last 7 days |
| Total Listings | Property Inventory split by Sales (cat 17) / Rental (cat 57) |
| Viewings (last 7 days) | MEETING activities (`crm.activity.list`, TYPE_ID 1) |
| Pocket Listings (Sale / Rent) | Items in stage "For Sale (Offline)" / "Rent (Offline)" only |
| Comments (last 7 days) | Timeline comments created in the last 7 days on recently modified leads (batched per-lead) |
| Call Logs (last 7 days) | CALL activities (`crm.activity.list`, TYPE_ID 2), inbound/outbound split |
| Deals (Year to Date) | Won deals since Jan 1, count + sum of OPPORTUNITY |

### Responsible Persons table

Below the KPI cards, a compact table lists every **active** responsible person who owns
Property Inventory listings, with the number of:

- Listings they own
- New listings (created in the last 7 days)
- Timeline comments created in the last 7 days on their listings
  (`crm.timeline.comment.list` with `ENTITY_TYPE=dynamic_1032`)

People can be hidden by adding their user ID to `excludedResponsibleIds` in the CONFIG block.

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
├── server/index.js       # Express API: /api/kpis (60s cache), Bitrix24 fetchers, config block at top
├── src/
│   ├── App.jsx           # layout: header (date only), KPI grid, loading skeletons, persons table
│   ├── App.css           # styles (Inter font, card grid, persons table, skeletons)
│   ├── components/KpiCard.jsx
│   ├── components/PersonsTable.jsx   # active responsible persons breakdown
│   └── hooks/useKpiData.js  # polls /api/kpis every 60s + on window focus
├── index.html
└── vite.config.js        # proxies /api to localhost:4010
```

## Configuration

All Bitrix24 data-source settings live in the **CONFIG block at the top of `server/index.js`**
(entity type ids, sale/rent categories, offline pocket-listing stage ids, cache lifetime,
comment window, excluded responsible people). No frontend changes needed when the CRM setup changes.

## Security

- The Bitrix24 webhook token lives only in `.env` (gitignored) and is used server-side only.
- The browser never talks to Bitrix24 directly; it only talks to the local API.
- Cards whose data source is unavailable show a "no access" badge instead of failing the whole dashboard.

## Notes

- `crm.item.list` only honors `>`-prefixed date filters on `createdTime` / `updatedTime`
  (`>=` is silently ignored).
- CRM-wide comment listing is not supported by the REST API; comments are counted per-entity
  using the `batch` method (`crm.timeline.comment.list`).
- Pocket listings are the inventory items sitting in the *Offline* stages
  ("For Sale (Offline)" / "Rent (Offline)").