import 'dotenv/config';
import express from 'express';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

  // Refresh / cache lifetime in seconds. Cheap KPIs refresh often; heavy KPIs
  // (full scans, per-item comment batches) refresh rarely.
  refreshSeconds: 60,
  heavyRefreshSeconds: 300,

  // Stale-while-revalidate: expired KPIs are served from cache while a fresh
  // copy is fetched in the background.
  swr: true,

  // Deals that count as "won" / "lost" (success / failure semantic)
  dealWonSemanticId: 'S',
  dealLostSemanticId: 'F',
  dealsChartMonths: 12, // won-deals bar chart window

  // For the Comments KPI we count comments on leads that were modified in
  // this many days. Batching keeps the request volume bounded.
  commentLeadWindowDays: 7,

  // Leads-by-source window (days)
  leadsSourceDays: 30,

  // Snapshot persistence — enables "vs last week" deltas + trend history.
  snapshotIntervalMs: 15 * 60 * 1000,
  snapshotMaxAgeMs: 30 * 86400000,
  snapshotMaxBytes: 12 * 1024 * 1024,

  // Custom fields on the Property Inventory SPA (entityTypeId 1032)
  fields: {
    price: 'ufCrm9_1739781164039', // "Amount and currency" — "6364000|AED"
    bedrooms: 'ufCrm6_1724863930215',
    area: 'ufCrm10_1725613799', // "Area"
    propertyType: 'ufCrm10_1725613911',
    community: 'parentId1052',
    property: 'parentId1036',
    closedDate: 'ufCrmClosedate', // "Finished on"
    rented: 'ufCrm10_1726036398659', // "Rented"
    noticeServed: 'ufCrm10_1726036424806', // "Notice Served"
    listingDate: 'ufCrm10_1726035902221',
    purpose: 'ufCrm6_1724863769672',
  },

  // Parent SPA entity type ids used for naming communities / properties.
  communityEntityTypeId: 1052,
  propertyEntityTypeId: 1036,
};
// ---------------------------------------------------------------------------

if (!CFG.webhook) {
  console.error('FATAL: BITRIX_WEBHOOK is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const ROOT_DIR = path.resolve(new URL('..', import.meta.url).pathname);
const SNAPSHOT_FILE = path.join(ROOT_DIR, 'data', 'snapshots.jsonl');

const TIMEZONE_OFFSET = '+03:00';

function iso(dt) {
  return dt.toISOString().slice(0, 19) + TIMEZONE_OFFSET;
}
function isoDay(dt) {
  const d = new Date(dt);
  d.setHours(0, 0, 0, 0);
  return iso(d).slice(0, 10);
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
function monthStart(offsetMonths) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
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

// Paginates a whole entity with parallel page-batches (up to 50 pages per
// batch). `query` is a pre-built query string (filters + selects).
async function batchCollect(method, query, { maxStart = 300000 } = {}) {
  const all = [];
  let start = 0;
  let total = null;
  while (true) {
    const cmd = {};
    const starts = [];
    for (let i = 0; i < 50; i++) {
      starts.push(start + i * 50);
      cmd[`p${i}`] = `${method}?${query}&start=${start + i * 50}`;
    }
    const r = await bx('batch', { cmd, halt: 0 });
    const results = r?.result?.result ?? {};
    let gotAny = false;
    let shortPage = false;
    for (const res of Object.values(results)) {
      if (!res) continue;
      gotAny = true;
      if (total === null && Number(res.total) > 0) total = Number(res.total);
      const items = res.items ?? res.result ?? (Array.isArray(res) ? res : []);
      all.push(...items);
      if (items.length < 50) shortPage = true;
    }
    if (!gotAny || shortPage) break;
    start += 2500;
    if (total !== null && all.length >= total) break;
    if (start > maxStart) break;
  }
  return all;
}

// Sequential direct POST pagination. Used for old-API lists (deal/lead/
// activity): unlike crm.item.list, their batch sub-commands silently ignore
// `start` whenever the filter contains a comparison operator (>= etc.),
// which would duplicate pages. Sequential calls also stay within rate limits.
async function pagedCollect(method, params, { maxPages = 80 } = {}) {
  const all = [];
  let start = 0;
  while (true) {
    const r = await bx(method, { ...params, start });
    const items = itemsOf(r);
    all.push(...items);
    if (items.length < 50) break;
    const total = Number(r.total);
    if (total && all.length >= total) break;
    start += 50;
    if (start >= 50 * maxPages) break;
  }
  return all;
}

// Builds a query string for batch sub-commands. Inside batch cmd strings the
// bracket characters in filter keys must stay literal, but comparison symbols
// (>=, <, =) inside the KEY itself must be percent-encoded or the filter is
// silently ignored. Values are always encoded.
function encodeKey(k) {
  return String(k).replace(/[^\w\s-]/g, (c) => encodeURIComponent(c));
}
function batchQuery(topParams, filters, selects) {
  const parts = [];
  for (const [k, v] of Object.entries(topParams ?? {})) {
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  for (const [k, v] of Object.entries(filters ?? {})) {
    parts.push(`filter[${encodeKey(k)}]=${encodeURIComponent(v)}`);
  }
  for (const [i, s] of (selects ?? []).entries()) {
    parts.push(`select[${i}]=${s}`);
  }
  return parts.join('&');
}

// --- Enum / reference data (cached, refreshes on demand) ---------------------
let fieldEnums = null;
async function getFieldEnums() {
  if (fieldEnums) return fieldEnums;
  const r = await bx('crm.item.fields', { entityTypeId: CFG.inventoryEntityTypeId });
  const fields = r?.result?.fields ?? {};
  const pick = (key) => (fields[key]?.items ?? []).map((i) => ({ id: String(i.ID), value: i.VALUE }));
  fieldEnums = {
    bedrooms: new Map(pick(CFG.fields.bedrooms).map((i) => [i.id, i.value])),
    types: new Map(pick(CFG.fields.propertyType).map((i) => [i.id, i.value])),
    purposes: new Map(pick(CFG.fields.purpose).map((i) => [i.id, i.value])),
  };
  return fieldEnums;
}

let sourceNames = null;
async function getSourceNames() {
  if (sourceNames) return sourceNames;
  const r = await bx('crm.status.list', { filter: { ENTITY_ID: 'SOURCE' } });
  sourceNames = new Map((r.result ?? []).map((s) => [s.STATUS_ID, s.NAME]));
  return sourceNames;
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

// Full inventory scan — one parallel-batched pass shared by many KPIs.
const SCAN_SELECT = [
  'id',
  'title',
  'categoryId',
  'stageId',
  'assignedById',
  'createdTime',
  'sourceId',
  CFG.fields.price,
  CFG.fields.bedrooms,
  CFG.fields.area,
  CFG.fields.propertyType,
  CFG.fields.community,
  CFG.fields.property,
  CFG.fields.closedDate,
  CFG.fields.rented,
  CFG.fields.noticeServed,
  CFG.fields.listingDate,
  CFG.fields.purpose,
];
async function kpiScan() {
  const items = await batchCollect(
    'crm.item.list',
    batchQuery({ entityTypeId: CFG.inventoryEntityTypeId }, {}, SCAN_SELECT)
  );
  return { ok: true, items, total: items.length };
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
  const all = await pagedCollect('crm.activity.list', {
    filter: { TYPE_ID: 1, '>CREATED': iso(daysAgo(7)) },
    select: ['ID', 'COMPLETED'],
  });
  const completed = all.filter((a) => String(a.COMPLETED).toUpperCase() === 'Y').length;
  return { ok: true, value: all.length, completed };
}

async function kpiSaleRentListings() {
  // Pocket listings — items in the "For Sale (Offline)" / "Rent (Offline)" stages.
  const scan = await getKpi('scan');
  let sale = 0;
  let rent = 0;
  for (const it of scan.items) {
    if (it.stageId === CFG.saleOfflineStageId) sale += 1;
    else if (it.stageId === CFG.rentOfflineStageId) rent += 1;
  }
  return { ok: true, value: `${sale} / ${rent}`, sale, rent };
}

function parsePrice(item) {
  const raw = item[CFG.fields.price];
  if (!raw) return null;
  const [val, cur] = String(raw).split('|');
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return { value: n, currency: cur || 'AED' };
}

async function kpiInventoryValue() {
  const scan = await getKpi('scan');
  let sale = 0;
  let rent = 0;
  let priced = 0;
  for (const it of scan.items) {
    const p = parsePrice(it);
    if (!p) continue;
    priced += 1;
    if (it.categoryId === CFG.saleCategoryId) sale += p.value;
    else rent += p.value;
  }
  const total = sale + rent;
  return { ok: true, value: total, sale, rent, priced, total: scan.items.length };
}

async function kpiClosedListings() {
  // "Finished on" date — sold / closed inventory items.
  const scan = await getKpi('scan');
  const ytd = isoDay(yearStart());
  const month = isoDay(monthStart(0));
  let inMonth = 0;
  let inYtd = 0;
  let ever = 0;
  for (const it of scan.items) {
    const c = String(it[CFG.fields.closedDate] ?? '').slice(0, 10);
    if (!c) continue;
    ever += 1;
    if (c >= ytd) inYtd += 1;
    if (c >= month) inMonth += 1;
  }
  return { ok: true, value: inMonth, ytd: inYtd, total: ever };
}

async function kpiTopCommunities() {
  const scan = await getKpi('scan');
  let parentNames = new Map();
  try {
    const parents = await getKpi('parents');
    parentNames = new Map(Object.entries(parents?.map ?? {}));
  } catch {
    // names unavailable — fall back to raw ids
  }
  const counts = new Map();
  for (const it of scan.items) {
    const cid = it[CFG.fields.community] ?? it[CFG.fields.property];
    if (!cid) continue;
    counts.set(String(cid), (counts.get(String(cid)) || 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([id, count]) => ({
      id,
      name: parentNames.get(id) || `Community #${id}`,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const max = rows[0]?.count || 1;
  return { ok: true, value: rows.length, rows, max };
}

async function kpiInventoryMix() {
  const scan = await getKpi('scan');
  let enums = null;
  try {
    enums = await getFieldEnums();
  } catch {
    enums = null;
  }
  const bd = new Map();
  const pt = new Map();
  for (const it of scan.items) {
    for (const b of it[CFG.fields.bedrooms] ?? []) {
      bd.set(String(b), (bd.get(String(b)) || 0) + 1);
    }
    const t = it[CFG.fields.propertyType];
    if (t) pt.set(String(t), (pt.get(String(t)) || 0) + 1);
  }
  const label = (enums, id) => (enums ? enums.get(String(id)) : null) || String(id);
  const bedrooms = [...bd.entries()]
    .map(([id, count]) => ({ id, name: label(enums?.bedrooms, id), count }))
    .sort((a, b) => b.count - a.count);
  const types = [...pt.entries()]
    .map(([id, count]) => ({ id, name: label(enums?.types, id), count }))
    .sort((a, b) => b.count - a.count);
  const typed = pt.size ? [...pt.values()].reduce((s, c) => s + c, 0) : 0;
  return { ok: true, value: scan.items.length, bedrooms, types, typed };
}

async function kpiRentalHealth() {
  const scan = await getKpi('scan');
  let rentItems = 0;
  let rented = 0;
  let notice = 0;
  for (const it of scan.items) {
    if (it.categoryId !== CFG.rentCategoryId) continue;
    rentItems += 1;
    if (String(it[CFG.fields.rented] ?? 'N').toUpperCase() === 'Y') rented += 1;
    if (String(it[CFG.fields.noticeServed] ?? 'N').toUpperCase() === 'Y') notice += 1;
  }
  return { ok: true, value: rented, rented, notice, total: rentItems };
}

async function kpiComments() {
  // Only timeline comments (right-side feed) count here — the lead's plain-text
  // "Comment" field (left side of the form) is not part of crm.timeline.comment.list
  // and is never included. Main value = comments CREATED in the last 7 days.
  const sinceIso = iso(daysAgo(CFG.commentLeadWindowDays));
  const leads = await pagedCollect('crm.lead.list', {
    filter: { '>=DATE_MODIFY': sinceIso },
    select: ['ID'],
  });
  const leadIds = leads.map((l) => l.ID);

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
  // their listings in the last 7 days. Reuses the shared inventory scan.
  const scan = await getKpi('scan');
  const weekAgoIso = iso(daysAgo(7));
  const ownerByItem = new Map();
  const per = new Map();
  for (const it of scan.items) {
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
  const all = await pagedCollect('crm.activity.list', {
    filter: { TYPE_ID: 2, '>CREATED': iso(daysAgo(7)) },
    select: ['ID', 'DIRECTION'],
  });
  let inbound = 0;
  let outbound = 0;
  for (const a of all) {
    if (String(a.DIRECTION) === '2') outbound += 1;
    else if (String(a.DIRECTION) === '1') inbound += 1;
  }
  return { ok: true, value: all.length, inbound, outbound };
}

async function kpiDealsYtd() {
  // Won deals opened since Jan 1 — count + sum of OPPORTUNITY in native currency.
  const items = await pagedCollect('crm.deal.list', {
    filter: { '>=DATE_CREATE': iso(yearStart()), STAGE_SEMANTIC_ID: CFG.dealWonSemanticId },
    select: ['OPPORTUNITY', 'CURRENCY_ID'],
  });
  let sum = 0;
  for (const d of items) sum += Number(d.OPPORTUNITY) || 0;
  return { ok: true, value: items.length, sum, currency: 'AED' };
}

async function kpiDealsMonthly() {
  // Won deals closed in each of the last N months (bar chart), plus:
  // average deal size and lost-deals count year to date.
  const months = CFG.dealsChartMonths;
  const sinceIso = iso(monthStart(-(months - 1)));
  const won = await pagedCollect('crm.deal.list', {
    filter: { '>=CLOSEDATE': sinceIso, STAGE_SEMANTIC_ID: CFG.dealWonSemanticId },
    select: ['OPPORTUNITY', 'CLOSEDATE'],
  });
  const lostYtd = await pagedCollect('crm.deal.list', {
    filter: { '>=CLOSEDATE': iso(yearStart()), STAGE_SEMANTIC_ID: CFG.dealLostSemanticId },
    select: ['ID'],
  });

  const monthArr = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = monthStart(-i);
    monthArr.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      count: 0,
      sum: 0,
    });
  }
  const byKey = new Map(monthArr.map((m) => [m.key, m]));
  for (const d of won) {
    const key = String(d.CLOSEDATE ?? '').slice(0, 7);
    const m = byKey.get(key);
    if (!m) continue;
    m.count += 1;
    m.sum += Number(d.OPPORTUNITY) || 0;
  }
  const wonSum = won.reduce((s, d) => s + (Number(d.OPPORTUNITY) || 0), 0);
  const avg = won.length ? wonSum / won.length : 0;
  return { ok: true, value: monthArr[monthArr.length - 1].count, months: monthArr, avg, lostYtd: lostYtd.length };
}

async function kpiLeadsBySource() {
  const sinceIso = iso(daysAgo(CFG.leadsSourceDays));
  const items = await pagedCollect('crm.lead.list', {
    filter: { '>=DATE_CREATE': sinceIso },
    select: ['SOURCE_ID'],
  });
  const counts = new Map();
  for (const l of items) {
    const s = String(l.SOURCE_ID || 'OTHER');
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let srcNames = new Map();
  try {
    srcNames = await getSourceNames();
  } catch {
    srcNames = new Map();
  }
  const rows = [...counts.entries()]
    .map(([id, count]) => ({ id, name: srcNames.get(id) || id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  return { ok: true, value: items.length, rows };
}

async function kpiParents() {
  // Names for communities (1052) and properties (1036) referenced by the scan.
  const scan = await getKpi('scan');
  const cids = new Set();
  const pids = new Set();
  for (const it of scan.items) {
    if (it[CFG.fields.community]) cids.add(it[CFG.fields.community]);
    if (it[CFG.fields.property]) pids.add(it[CFG.fields.property]);
  }
  const map = new Map();
  const fetchOne = async (entityTypeId, ids) => {
    const arr = [...ids];
    for (let i = 0; i < arr.length; i += 50) {
      const chunk = arr.slice(i, i + 50);
      const cmd = {};
      chunk.forEach((id, j) => {
        cmd[`g${j}`] = `crm.item.get?entityTypeId=${entityTypeId}&id=${id}`;
      });
      const r = await bx('batch', { cmd, halt: 0 });
      for (const res of Object.values(r?.result?.result ?? {})) {
        if (res?.item) map.set(String(res.item.id), res.item.title || `<#${res.item.id}>`);
      }
    }
  };
  await Promise.all([
    fetchOne(CFG.communityEntityTypeId, cids),
    fetchOne(CFG.propertyEntityTypeId, pids),
  ]);
  return { ok: true, map: Object.fromEntries(map) };
}

// --- KPI registry: key -> { ttl seconds, collect } ---------------------------
const KPIS = {
  // internal (not exposed to the frontend)
  scan: { ttl: CFG.heavyRefreshSeconds, collect: kpiScan, internal: true },
  parents: { ttl: CFG.heavyRefreshSeconds, collect: kpiParents, internal: true },

  // cheap — refresh every minute
  newListings: { ttl: CFG.refreshSeconds, collect: kpiNewListings },
  listings7d: { ttl: CFG.refreshSeconds, collect: kpiListings7d },
  totalListings: { ttl: CFG.refreshSeconds, collect: kpiTotalListings },
  viewings: { ttl: CFG.refreshSeconds, collect: kpiViewings },
  callLogs: { ttl: CFG.refreshSeconds, collect: kpiCallLogs },
  dealsYtd: { ttl: CFG.refreshSeconds, collect: kpiDealsYtd },
  dealsMonthly: { ttl: CFG.refreshSeconds, collect: kpiDealsMonthly },

  // heavy — refresh every 5 minutes
  saleRentListings: { ttl: CFG.heavyRefreshSeconds, collect: kpiSaleRentListings },
  inventoryValue: { ttl: CFG.heavyRefreshSeconds, collect: kpiInventoryValue },
  closedListings: { ttl: CFG.heavyRefreshSeconds, collect: kpiClosedListings },
  topCommunities: { ttl: CFG.heavyRefreshSeconds, collect: kpiTopCommunities },
  inventoryMix: { ttl: CFG.heavyRefreshSeconds, collect: kpiInventoryMix },
  rentalHealth: { ttl: CFG.heavyRefreshSeconds, collect: kpiRentalHealth },
  leadsBySource: { ttl: CFG.heavyRefreshSeconds, collect: kpiLeadsBySource },
  persons: { ttl: CFG.heavyRefreshSeconds, collect: kpiPersons },
  comments: { ttl: CFG.heavyRefreshSeconds, collect: kpiComments },
};

const PUBLIC_KEYS = Object.keys(KPIS).filter((k) => !KPIS[k].internal);

// --- per-KPI cache with single-flight + stale-while-revalidate --------------
const cache = new Map(); // key -> { data, at, inflight, lastError }

function entryFor(key) {
  let entry = cache.get(key);
  if (!entry) {
    entry = {};
    cache.set(key, entry);
  }
  return entry;
}

function startRefresh(key) {
  const entry = entryFor(key);
  if (entry.inflight) return entry.inflight;
  const p = (async () => {
    const data = await KPIS[key].collect();
    const e = cache.get(key);
    if (e) {
      e.data = data;
      e.at = Date.now();
      e.lastError = null;
    }
    return data;
  })();
  entry.inflight = p;
  p.catch((err) => {
    const e = cache.get(key);
    if (e) e.lastError = err.message;
  }).finally(() => {
    const e = cache.get(key);
    if (e && e.inflight === p) e.inflight = null;
  });
  return p;
}

async function getKpi(key) {
  const entry = entryFor(key);
  const now = Date.now();
  if (entry.data && !entry.inflight) {
    if (now - entry.at < KPIS[key].ttl * 1000) return entry.data;
    if (CFG.swr) {
      // stale — serve cached copy, refresh in the background
      startRefresh(key);
      return entry.data;
    }
  }
  if (entry.inflight) {
    try {
      return await entry.inflight;
    } catch (e) {
      if (entry.data) return entry.data;
      throw e;
    }
  }
  try {
    return await startRefresh(key);
  } catch (e) {
    if (entry.data) return entry.data;
    throw e;
  }
}

async function safeKpi(key) {
  try {
    return await getKpi(key);
  } catch (e) {
    return { ok: false, value: null, error: e.message };
  }
}

// --- snapshots (JSONL) — enables "vs last week" deltas -----------------------
function loadSnapshots() {
  let lines = [];
  try {
    const raw = readFileSync(SNAPSHOT_FILE, 'utf8');
    lines = raw.split('\n').filter(Boolean).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
  const cutoff = Date.now() - CFG.snapshotMaxAgeMs;
  return lines.filter((l) => l.ts > cutoff);
}

let snapshots = loadSnapshots();

function writeSnapshot(payload) {
  try {
    mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    const line = JSON.stringify({ ts: Date.now(), kpis: payload }) + '\n';
    appendFileSync(SNAPSHOT_FILE, line);
  } catch (e) {
    console.error('snapshot write failed:', e.message);
    return;
  }
  try {
    if (statSync(SNAPSHOT_FILE).size > CFG.snapshotMaxBytes) {
      const keep = snapshots.slice(-4000);
      writeFileSync(SNAPSHOT_FILE, keep.map((s) => JSON.stringify(s)).join('\n') + '\n');
    }
  } catch {
    // ignore pruning failures
  }
}

// Reference value ~7 days ago, closest match within ±6h.
let bestRefTs = null;
function computeDeltas(payload) {
  const target = Date.now() - 7 * 86400000;
  let best = null;
  let bestDist = Infinity;
  for (const s of snapshots) {
    const dist = Math.abs(s.ts - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  if (!best || bestDist > 6 * 3600000) return { available: false, deltas: {} };
  bestRefTs = best.ts;
  const ref = best.kpis || {};
  const deltas = {};
  for (const key of PUBLIC_KEYS) {
    const cur = payload.kpis[key];
    const old = ref[key];
    if (!cur || !old || cur.ok === false || old.ok === false) continue;
    const c = Number(cur.value);
    const o = Number(old.value);
    if (Number.isFinite(c) && Number.isFinite(o)) {
      deltas[key] = { diff: c - o, pct: o ? Math.round(((c - o) / o) * 1000) / 10 : null };
    }
  }
  return { available: true, refTs: bestRefTs, deltas };
}

// --- snapshot / warmup loops --------------------------------------------------
async function assemblePayload() {
  const out = {};
  await Promise.all(PUBLIC_KEYS.map(async (key) => {
    out[key] = await safeKpi(key);
  }));
  return { kpis: out, updatedAt: new Date().toISOString() };
}

async function warmup() {
  await Promise.allSettled(PUBLIC_KEYS.map((key) => startRefresh(key)));
  try {
    const payload = await assemblePayload();
    snapshots = loadSnapshots();
    writeSnapshot(payload.kpis);
  } catch {
    // snapshot best-effort
  }
}

setInterval(async () => {
  try {
    const payload = await assemblePayload();
    snapshots = loadSnapshots();
    writeSnapshot(payload.kpis);
  } catch (e) {
    console.error('snapshot loop failed:', e.message);
  }
}, CFG.snapshotIntervalMs);

// --- HTTP server --------------------------------------------------------------
const app = express();

let payloadCache = null;
let payloadEtag = null;

// Rebuild the combined payload from per-KPI caches without touching Bitrix
// (the individual caches handle their own refresh cadence + SWR).
setInterval(async () => {
  try {
    const fresh = await assemblePayload();
    payloadCache = fresh;
  } catch (e) {
    console.error('payload rebuild failed:', e.message);
  }
}, Math.min(CFG.refreshSeconds * 1000, 30000));

app.get('/api/kpis', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  try {
    if (!payloadCache) payloadCache = await assemblePayload();
    const payload = {
      ok: true,
      updatedAt: payloadCache.updatedAt,
      kpis: payloadCache.kpis,
      history: computeDeltas(payloadCache),
    };
    const etag = `"${createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}"`;
    payloadEtag = etag;
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.json(payload);
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
  console.log(`Warming up KPIs from Bitrix24… (${PUBLIC_KEYS.length} KPIs)`);
  warmup();
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));