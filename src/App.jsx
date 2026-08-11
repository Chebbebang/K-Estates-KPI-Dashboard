import useKpiData from './hooks/useKpiData';
import KpiCard from './components/KpiCard';
import PersonsTable from './components/PersonsTable';
import VBarChart from './components/VBarChart';
import HBars from './components/HBars';

function fmtAed(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `AED ${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `AED ${(v / 1e6).toFixed(1)}M`;
  return `AED ${Math.round(v).toLocaleString()}`;
}

const CARDS = [
  {
    key: 'newListings',
    label: 'New Listings',
    icon: '📋',
    color: '#e3f2fd',
    textColor: '#1565c0',
    sub: 'This week',
  },
  {
    key: 'listings7d',
    label: 'Listings (Last 7 Days)',
    icon: '🏠',
    color: '#e8f5e9',
    textColor: '#2e7d32',
    sub: (d) => `${Number(d.new).toLocaleString()} new · ${Number(d.updated).toLocaleString()} updated`,
  },
  {
    key: 'totalListings',
    label: 'Total Listings',
    icon: '📊',
    color: '#f3e5f5',
    textColor: '#6a1b9a',
    sub: (d) => `${Number(d.sale).toLocaleString()} for sale · ${Number(d.rent).toLocaleString()} for rent`,
  },
  {
    key: 'inventoryValue',
    label: 'Inventory Value',
    icon: '🏦',
    color: '#e0f7fa',
    textColor: '#006064',
    format: (v) => fmtAed(v),
    sub: (d) => `${fmtAed(d.sale)} sale · ${fmtAed(d.rent)} rent (${Number(d.priced).toLocaleString()} priced)`,
  },
  {
    key: 'dealsYtd',
    label: 'Deals (Year to Date)',
    icon: '💰',
    color: '#fff8e1',
    textColor: '#f57f17',
    sub: (d) => `${fmtAed(d.sum)} total`,
  },
  {
    key: 'dealsMonthly',
    label: 'Won Deals (Monthly)',
    icon: '📈',
    color: '#fce4ec',
    textColor: '#c2185b',
    sub: (d) => `Avg ${fmtAed(d.avg)} · ${Number(d.lostYtd).toLocaleString()} lost YTD`,
    chart: (d) => <VBarChart data={d.months} color="#f06292" />,
  },
  {
    key: 'viewings',
    label: 'Viewings (Last 7 Days)',
    icon: '👁️',
    color: '#fff3e0',
    textColor: '#e65100',
    sub: (d) => `${Number(d.completed).toLocaleString()} completed`,
  },
  {
    key: 'saleRentListings',
    label: 'Pocket Listings (Sale / Rent)',
    icon: '🏷️',
    color: '#e0e7ff',
    textColor: '#3730a3',
    sub: 'For Sale (Offline) · For Rent (Offline)',
  },
  {
    key: 'topCommunities',
    label: 'Top Communities',
    icon: '🏙️',
    color: '#ede7f6',
    textColor: '#4527a0',
    sub: 'Listings per community',
    chart: (d) => <HBars rows={d.rows} max={d.max} color="#7e57c2" />,
  },
  {
    key: 'inventoryMix',
    label: 'Inventory Mix',
    icon: '🏗️',
    color: '#e8f5e9',
    textColor: '#1b5e20',
    sub: (d) =>
      `${d.types.slice(0, 3).map((t) => `${t.count} ${t.name}`).join(' · ') || 'No type data'}`,
    chart: (d) => <HBars rows={d.bedrooms} color="#66bb6a" />,
  },
  {
    key: 'rentalHealth',
    label: 'Rental Health',
    icon: '🔑',
    color: '#fff3e0',
    textColor: '#e65100',
    sub: (d) => `${Number(d.notice).toLocaleString()} notice served · ${Number(d.total).toLocaleString()} rent items`,
  },
  {
    key: 'comments',
    label: 'Comments (Last 7 Days)',
    icon: '💬',
    color: '#e0f2f1',
    textColor: '#00695c',
    sub: (d) => `${Number(d.total).toLocaleString()} total timeline comments`,
  },
  {
    key: 'leadsBySource',
    label: 'Leads by Source (30 Days)',
    icon: '🧲',
    color: '#eceff1',
    textColor: '#37474f',
    sub: 'Inbound lead distribution',
    chart: (d) => <HBars rows={d.rows} color="#78909c" />,
  },
  {
    key: 'callLogs',
    label: 'Call Logs (Last 7 Days)',
    icon: '📞',
    color: '#e8eaf6',
    textColor: '#283593',
    sub: (d) => `${Number(d.inbound).toLocaleString()} inbound · ${Number(d.outbound).toLocaleString()} outbound`,
  },
];

const NUMBER_CARDS = CARDS.filter((c) => !c.chart);
const CHART_CARDS = CARDS.filter((c) => c.chart);

function formatLongDate(d) {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function agoLabel(isoStr) {
  if (!isoStr) return '';
  const ms = Date.now() - new Date(isoStr).getTime();
  if (ms < 60000) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export default function App() {
  const { data, error, loading } = useKpiData();
  const kpis = data?.kpis ?? {};
  const deltas = data?.history?.deltas ?? {};
  const now = new Date();

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <span className="title-glow" aria-hidden="true" />
          <h1>Dashboard KPI</h1>
        </div>
        <div className="header-right">
          <div className="header-date">{formatLongDate(now)}</div>
          {data?.updatedAt && (
            <div className="header-date header-updated" title={data.updatedAt}>
              Updated {agoLabel(data.updatedAt)}
            </div>
          )}
        </div>
      </header>

      {error && (
        <div className="banner error">
          Cannot reach the data server. Retrying automatically… ({error})
        </div>
      )}

      {loading && !data && (
        <>
          <div className="grid">
            {CARDS.map((c) => (
              <div className="card" key={c.key}>
                <div className="card-header">
                  <div className="icon" style={{ background: c.color, color: c.textColor }}>
                    {c.icon}
                  </div>
                  <h2>{c.label}</h2>
                </div>
                <div className="kpi-value skeleton" />
                <div className="kpi-sub skeleton" />
              </div>
            ))}
          </div>
          <div className="persons">
            <div className="persons-header">
              <div className="skeleton persons-title-skeleton" />
              <div className="skeleton persons-count-skeleton" />
            </div>
            <table className="persons-table persons-table-skeleton">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Listings</th>
                  <th className="num">New (7d)</th>
                  <th className="num">Comments (7d)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td><div className="skeleton row-skeleton" /></td>
                    <td><div className="skeleton row-skeleton num-skeleton" /></td>
                    <td><div className="skeleton row-skeleton num-skeleton" /></td>
                    <td><div className="skeleton row-skeleton num-skeleton" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data && (
        <>
          <div className="grid">
            {NUMBER_CARDS.map((c) => (
              <KpiCard key={c.key} kpi={kpis[c.key]} config={c} delta={deltas[c.key]} />
            ))}
          </div>
          {CHART_CARDS.length > 0 && (
            <section className="charts-section">
              <h2>Trends &amp; Breakdowns</h2>
              <div className="charts-grid">
                {CHART_CARDS.map((c) => (
                  <KpiCard key={c.key} kpi={kpis[c.key]} config={c} delta={deltas[c.key]} />
                ))}
              </div>
            </section>
          )}
          <PersonsTable rows={kpis.persons?.rows} />
        </>
      )}
    </div>
  );
}