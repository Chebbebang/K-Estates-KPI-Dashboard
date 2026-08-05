# K-Estates KPI Dashboard

Real-time KPI dashboard for K-Estates, pulling live metrics from Bitrix24.

- **Frontend:** React 18 + Vite (plain JS `fetch` polling)
- **Backend:** Node.js + Express proxy that holds the Bitrix24 webhook token server-side (never exposed to the browser)
- **Real-time:** dashboard auto-refreshes every 60 seconds, with a live indicator, manual refresh button, and per-card error badges

## KPIs

| KPI | Source |
|---|---|
| New Listings (this week) | Property Inventory SPA (`crm.item.list`, entityTypeId 1032) |
| Listings (last 7 days) | Property Inventory created/updated in last 7 days |
| Total Listings | Property Inventory split by Sales (cat 17) / Rental (cat 57) |
| Viewings (last 7 days) | MEETING activities (`crm.activity.list`, TYPE_ID 1) |
| Overdue Tasks | `tasks.task.list` (requires webhook access to the Tasks app) |
| Comments | Timeline comments on recently modified leads (batched per-lead) |
| Call Logs (last 7 days) | CALL activities (`crm.activity.list`, TYPE_ID 2), inbound/outbound split |
| Deals (Year to Date) | Won deals since Jan 1, count + sum of OPPORTUNITY |

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure the webhook (required)
cp .env.example .env
# edit .env and set BITRIX_WEBHOOK=https://your-domain.bitrix24.com/rest/USER_ID/WEBHOOK_TOKEN/

# 3. Run in development (Vite on :5173, API on :3001)
npm run dev

# 4. Production
npm run build
npm start        # serves app + API on :3001
```

Open http://localhost:5173 (dev) or http://localhost:3001 (production).

## Project structure

```
├── server/index.js       # Express API: /api/kpis (60s cache), Bitrix24 fetchers, config block at top
├── src/
│   ├── App.jsx           # layout: header, live dot, refresh button, KPI grid
│   ├── App.css           # styles (Inter font, card grid)
│   ├── components/KpiCard.jsx
│   └── hooks/useKpiData.js  # polls /api/kpis every 60s + on window focus
├── index.html
└── vite.config.js        # proxies /api to localhost:3001
```

## Configuration

All Bitrix24 data-source settings live in the **CONFIG block at the top of `server/index.js`**
(entity type ids, sale/rent categories, cache lifetime, comment window). No frontend changes
needed when the CRM setup changes.

## Security

- The Bitrix24 webhook token lives only in `.env` (gitignored) and is used server-side only.
- The browser never talks to Bitrix24 directly; it only talks to the local API.
- Cards whose data source is unavailable (e.g. Tasks without webhook scope) show a "no access"
  badge instead of failing the whole dashboard.

## Notes

- `crm.item.list` only honors `>`-prefixed date filters on `createdTime` / `updatedTime`
  (`>=` is silently ignored).
- CRM-wide comment listing is not supported by the REST API; comments are counted per-lead
  using the `batch` method.
