import 'dotenv/config';
import express from 'express';

// ---------------------------------------------------------------------------
// CONFIG — adjust these to match your Bitrix24 setup
// ---------------------------------------------------------------------------
const CFG = {
  webhook: process.env.BITRIX_WEBHOOK,
  port: Number(process.env.PORT) || 3001,

  // Property Inventory SPA (Smart Process Automation)
  inventoryEntityTypeId: 1032,
  saleCategoryId: 17, // "Sales Listings"
  rentCategoryId: 57, // "Rental Listings"

  // Timeline comments on inventory items use the lower-case dynamic entity type.
  inventoryCommentEntityType: 'dynamic_1032',

  // Pocket listings = stage "For Sale (Offline)" / "Rent (Offline)".
  saleOfflineStageId: 'DT1032_17:NEW', // "For Sale (Offline)"
  rentOfflineStageId: 'DT1032_57:PREPARATION', // "Rent (Offline)"

  // Responsible people to hide from the persons table.
  excludedResponsibleIds: [25185],

  // Refresh / cache lifetime in seconds (dashboard polls this often)
  refreshSeconds: 60,

  // Deals that count as "won" (success semantic) for year-to-date KPI
  dealWonSemanticId: 'S',

  // For the Comments KPI we count comments on leads that were modified in
  // this many days. Batching keeps the request volume bounded.
  commentLeadWindowDays: 7,
};
// ---------------------------------------------------------------------------

if (!CFG.webhook) {
  console.error('FATAL: BITRIX_WEBHOOK is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const TIMEZONE_OFFSET = '+03:00';

function iso(dt) {
  return dt.toISOString().slice(0, 19) + TIMEZONE_OFFSET;
}
function daysAgo(n) {
  return new Date(Date.now() - n * 86400000);
}
function weekStart() {
  const d = daysAgo(new Date().getDay()); // move back to Sunday
  d.setHours(0, 0, 0, 0);
  return d;
}
function yearStart() {
  const d = new Date();
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// --- Bitrix24 low-level client ---------------------------------------------
async function bx(method, params = {}) {
  const res = await fetch(`${CFG.webhook}${method}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`${method}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`${method}: ${data.error} ${data.error_description || ''}`.trim());
  }
  return data;
}

function itemsOf(res) {
  return res?.result?.result ?? res?.result?.items ?? res?.result ?? [];
}

// --- KPI collectors ---------------------------------------------------------
async function countInventory(filter) {
  const r = await bx('crm.item.list', {
    entityTypeId: CFG.inventoryEntityTypeId,
    filter,
    select: ['id'],
  });
  return r.total ?? 0;
}

async function kpiNewListings() {
  const value = await countInventory({ '>createdTime': iso(weekStart()) });
  return { ok: true, value, sub: 'This week' };
}

async function kpiListings7d() {
  const newCount = await countInventory({ '>createdTime': iso(daysAgo(7)) });
  const updated = await countInventory({ '>updatedTime': iso(daysAgo(7)) });
  return { ok: true, value: newCount + updated, new: newCount, updated };
}

async function kpiTotalListings() {
  const [sale, rent] = await Promise.all([
    countInventory({ categoryId: CFG.saleCategoryId }),
    countInventory({ categoryId: CFG.rentCategoryId }),
  ]);
  return { ok: true, value: sale + rent, sale, rent };
}

async function kpiViewings() {
  // Viewings = MEETING activities created in the last 7 days.
  const all = [];
  let start = 0;
  while (true) {
    const r = await bx('crm.activity.list', {
      filter: { TYPE_ID: 1, '>CREATED': iso(daysAgo(7)) },
      select: ['ID', 'COMPLETED'],
      start,
    });
    const items = itemsOf(r);
    all.push(...items);
    if (items.length < 50) break;
    start += 50;
  }
  const completed = all.filter((a) => String(a.COMPLETED).toUpperCase() === 'Y').length;
  return { ok: true, value: all.length, completed };
}

async function kpiSaleRentListings() {
  // Pocket listings — items in the "For Sale (Offline)" / "Rent (Offline)" stages.
  const [sale, rent] = await Promise.all([
    countInventory({ categoryId: CFG.saleCategoryId, stageId: CFG.saleOfflineStageId }),
    countInventory({ categoryId: CFG.rentCategoryId, stageId: CFG.rentOfflineStageId }),
  ]);
  return { ok: true, value: `${sale} / ${rent}`, sale, rent };
}

async function kpiComments() {
  // Only timeline comments (right-side feed) count here — the lead's plain-text
  // "Comment" field (left side of the form) is not part of crm.timeline.comment.list
  // and is never included. Main value = comments CREATED in the last 7 days.
  const leadIds = [];
  const sinceIso = iso(daysAgo(CFG.commentLeadWindowDays));
  const first = await bx('crm.lead.list', {
    filter: { '>=DATE_MODIFY': sinceIso },
    select: ['ID'],
    start: 0,
  });
  const leadTotal = Number(first.total) || 0;
  leadIds.push(...(first.result || []).map((l) => l.ID));
  if (leadTotal > leadIds.length) {
    // remaining pages in a single parallel batch (up to 50 pages)
    const pages = [];
    for (let start = leadIds.length; start < leadTotal && pages.length < 50; start += 50) {
      pages.push(start);
    }
    const cmd = {};
    pages.forEach((start, i) => {
      cmd[`p${i}`] =
        `crm.lead.list?filter[>=DATE_MODIFY]=${encodeURIComponent(sinceIso)}&select[0]=ID&start=${start}`;
    });
    const r = await bx('batch', { cmd, halt: 0 });
    const results = r?.result?.result ?? {};
    for (const items of Object.values(results)) {
      if (Array.isArray(items)) leadIds.push(...items.map((l) => l.ID));
    }
  }

  const weekAgoIso = iso(daysAgo(7));
  let total = 0;
  let last7d = 0;

  for (let i = 0; i < leadIds.length; i += 50) {
    const chunk = leadIds.slice(i, i + 50);
    const cmd = {};
    chunk.forEach((id, j) => {
      cmd[`c${j}`] =
        `crm.timeline.comment.list?filter[ENTITY_ID]=${id}&filter[ENTITY_TYPE]=lead`;
    });
    const r = await bx('batch', { cmd, halt: 0 });
    const results = r?.result?.result ?? {};
    for (const comments of Object.values(results)) {
      if (!Array.isArray(comments)) continue;
      total += comments.length;
      for (const c of comments) {
        if (String(c.CREATED) >= weekAgoIso) last7d += 1;
      }
    }
  }
  return { ok: true, value: last7d, total, last7d };
}

async function kpiPersons() {
  // Breakdown per responsible person (still active) over the Property Inventory:
  // total listings, new listings (last 7 days), and timeline comments created on
  // their listings in the last 7 days.
  const all = [];
  let start = 0;
  while (true) {
    const r = await bx('crm.item.list', {
      entityTypeId: CFG.inventoryEntityTypeId,
      select: ['id', 'assignedById', 'createdTime'],
      start,
    });
    const items = itemsOf(r);
    all.push(...items);
    if (items.length < 50) break;
    start += 50;
  }

  const weekAgoIso = iso(daysAgo(7));
  const ownerByItem = new Map();
  const per = new Map();
  for (const it of all) {
    const uid = Number(it.assignedById);
    if (!uid) continue;
    if (!per.has(uid)) per.set(uid, { listings: 0, newListings: 0, comments: 0 });
    const row = per.get(uid);
    row.listings += 1;
    if (String(it.createdTime) >= weekAgoIso) row.newListings += 1;
    ownerByItem.set(Number(it.id), row);
  }

  // Timeline comments on their listings, created in the last 7 days (batched).
  const itemIds = [...ownerByItem.keys()];
  for (let i = 0; i < itemIds.length; i += 50) {
    const chunk = itemIds.slice(i, i + 50);
    const cmd = {};
    chunk.forEach((itemId, j) => {
      cmd[`c${j}`] =
        `crm.timeline.comment.list?filter[ENTITY_ID]=${itemId}` +
        `&filter[ENTITY_TYPE]=${CFG.inventoryCommentEntityType}&select[0]=ID&select[1]=CREATED`;
    });
    const r = await bx('batch', { cmd, halt: 0 });
    const results = r?.result?.result ?? {};
    for (const [key, comments] of Object.entries(results)) {
      if (!Array.isArray(comments)) continue;
      const owner = ownerByItem.get(chunk[Number(key.replace('c', ''))]);
      if (!owner) continue;
      for (const c of comments) {
        if (String(c.CREATED) >= weekAgoIso) owner.comments += 1;
      }
    }
  }

  // User names + active flag for the responsible people.
  const names = new Map();
  const uids = [...per.keys()];
  for (let i = 0; i < uids.length; i += 50) {
    const chunk = uids.slice(i, i + 50);
    const r = await bx('user.get', { filter: { ID: chunk }, sort: 'ID', order: 'desc' });
    for (const u of r.result || []) {
      names.set(Number(u.ID), { name: `${u.NAME || ''} ${u.LAST_NAME || ''}`.trim(), active: !!u.ACTIVE });
    }
  }

  const rows = [];
  for (const [uid, row] of per) {
    const u = names.get(uid);
    if (!u || !u.active) continue;
    if (CFG.excludedResponsibleIds.includes(uid)) continue;
    rows.push({
      userId: uid,
      name: u.name || `User #${uid}`,
      listings: row.listings,
      newListings: row.newListings,
      comments: row.comments,
    });
  }
  rows.sort((a, b) => b.listings - a.listings || b.comments - a.comments);
  return { ok: true, value: rows.length, rows };
}

async function kpiCallLogs() {
  // CALL activities created in the last 7 days, split by direction.
  const all = [];
  let start = 0;
  while (true) {
    const r = await bx('crm.activity.list', {
      filter: { TYPE_ID: 2, '>CREATED': iso(daysAgo(7)) },
      select: ['ID', 'DIRECTION'],
      start,
    });
    const items = itemsOf(r);
    all.push(...items);
    if (items.length < 50) break;
    start += 50;
  }
  let inbound = 0;
  let outbound = 0;
  for (const a of all) {
    if (String(a.DIRECTION) === '2') outbound += 1;
    else if (String(a.DIRECTION) === '1') inbound += 1;
  }
  return { ok: true, value: all.length, inbound, outbound };
}

async function kpiDealsYtd() {
  // Won deals since Jan 1 — count + sum of OPPORTUNITY in native currency.
  let start = 0;
  let count = 0;
  let sum = 0;
  while (true) {
    const r = await bx('crm.deal.list', {
      filter: { '>=DATE_CREATE': iso(yearStart()), STAGE_SEMANTIC_ID: CFG.dealWonSemanticId },
      select: ['OPPORTUNITY', 'CURRENCY_ID'],
      start,
    });
    const items = r.result || [];
    count += items.length;
    for (const d of items) sum += Number(d.OPPORTUNITY) || 0;
    if (items.length < 50) break;
    start += 50;
  }
  return { ok: true, value: count, sum, currency: 'AED' };
}

async function collectKpis() {
  const fetchers = {
    newListings: kpiNewListings,
    listings7d: kpiListings7d,
    totalListings: kpiTotalListings,
    viewings: kpiViewings,
    saleRentListings: kpiSaleRentListings,
    comments: kpiComments,
    persons: kpiPersons,
    callLogs: kpiCallLogs,
    dealsYtd: kpiDealsYtd,
  };

  const results = {};
  await Promise.all(
    Object.entries(fetchers).map(async ([key, fn]) => {
      try {
        results[key] = await fn();
      } catch (e) {
        results[key] = { ok: false, value: null, error: e.message };
      }
    })
  );
  return results;
}

// --- cache with single-flight refresh ----------------------------------------
let cache = { data: null, at: 0 };
let inflight = null;

async function getKpis() {
  if (cache.data && Date.now() - cache.at < CFG.refreshSeconds * 1000) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    const data = await collectKpis();
    cache = { data, at: Date.now() };
    return data;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

// --- HTTP server --------------------------------------------------------------
const app = express();

app.get('/api/kpis', async (_req, res) => {
  try {
    const kpis = await getKpis();
    res.json({ ok: true, updatedAt: new Date().toISOString(), kpis });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

const dist = new URL('../dist', import.meta.url).pathname;
app.use(express.static(dist));

const server = app.listen(CFG.port, () => {
  console.log(`KPI API server listening on http://localhost:${CFG.port}`);
  console.log(`Serving built app from ${dist}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));