import useKpiData from './hooks/useKpiData';
import KpiCard from './components/KpiCard';
import PersonsTable from './components/PersonsTable';

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
    key: 'saleRentListings',
    label: 'Pocket Listings (Sale / Rent)',
    icon: '🏷️',
    color: '#e0e7ff',
    textColor: '#3730a3',
    sub: 'For Sale (Offline) · For Rent (Offline)',
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

function formatLongDate(d) {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function App() {
  const { data, error, loading } = useKpiData();
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
          <div className="header-date">{formatLongDate(now)}</div>
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
            {CARDS.map((c) => (
              <KpiCard key={c.key} kpi={kpis[c.key]} config={c} />
            ))}
          </div>
          <PersonsTable rows={kpis.persons?.rows} />
        </>
      )}
    </div>
  );
}