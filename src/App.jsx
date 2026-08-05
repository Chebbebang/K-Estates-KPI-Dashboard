import useKpiData from './hooks/useKpiData';
import KpiCard from './components/KpiCard';

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
    key: 'viewings',
    label: 'Viewings (Last 7 Days)',
    icon: '👁️',
    color: '#fff3e0',
    textColor: '#e65100',
    sub: (d) => `${Number(d.completed).toLocaleString()} completed`,
  },
  {
    key: 'overdueTasks',
    label: 'Overdue Tasks',
    icon: '⏰',
    color: '#fce4ec',
    textColor: '#c62828',
    sub: 'pending',
  },
  {
    key: 'comments',
    label: 'Comments',
    icon: '💬',
    color: '#e0f2f1',
    textColor: '#00695c',
    sub: (d) => `${Number(d.last7d).toLocaleString()} in last 7 days`,
  },
  {
    key: 'callLogs',
    label: 'Call Logs (Last 7 Days)',
    icon: '📞',
    color: '#e8eaf6',
    textColor: '#283593',
    sub: (d) => `${Number(d.inbound).toLocaleString()} inbound · ${Number(d.outbound).toLocaleString()} outbound`,
  },
  {
    key: 'dealsYtd',
    label: 'Deals (Year to Date)',
    icon: '💰',
    color: '#fff8e1',
    textColor: '#f57f17',
    sub: (d) => `AED ${Math.round(Number(d.sum)).toLocaleString()} total`,
  },
];

function formatTime(d) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatLongDate(d) {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function App() {
  const { data, error, loading, lastUpdated, refresh } = useKpiData();
  const kpis = data?.kpis ?? {};
  const now = new Date();

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <span className="title-glow" aria-hidden="true" />
          <h1>Dashboard KPI</h1>
        </div>
        <div className="header-right">
          <div className="live-chip" title={`Auto-refreshes every minute${error ? ' — connection issue' : ''}`}>
            <span className={`live-dot ${error ? 'down' : 'up'}`} />
            {error ? 'Offline' : 'Live'}
          </div>
          <div className="header-date">{formatLongDate(now)}</div>
          <button className="refresh-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <div className="banner error">
          Cannot reach the data server. Retrying automatically… ({error})
        </div>
      )}

      {loading && !data && (
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
      )}

      {data && (
        <>
          <div className="grid">
            {CARDS.map((c) => (
              <KpiCard key={c.key} kpi={kpis[c.key]} config={c} />
            ))}
          </div>
          <footer className="footer">
            {lastUpdated && <>Last updated {formatTime(lastUpdated)}</>} · auto-refreshes every 60s
          </footer>
        </>
      )}
    </div>
  );
}