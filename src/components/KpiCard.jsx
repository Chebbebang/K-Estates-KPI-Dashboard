export default function KpiCard({ kpi, config }) {
  const { label, icon, color, textColor } = config;
  const ok = kpi?.ok !== false;
  const value = kpi?.value ?? null;

  let subContent = null;
  if (ok && typeof config.sub === 'function') {
    subContent = config.sub(kpi);
  } else if (ok && typeof config.sub === 'string') {
    subContent = config.sub;
  }

  return (
    <div className={`card ${ok ? '' : 'card-error'}`}>
      <div className="card-header">
        <div className="icon" style={{ background: color, color: textColor }}>
          {icon}
        </div>
        <h2>{label}</h2>
        {!ok && (
          <span className="error-badge" title={kpi?.error || 'No access'}>
            !
          </span>
        )}
      </div>
      <div className="kpi-value" style={{ color: textColor }}>
        {ok && value !== null ? value.toLocaleString() : '—'}
      </div>
      <div className="kpi-sub">
        {ok ? (subContent ?? '') : kpi?.error ? 'No access to this data' : 'Unavailable'}
        {ok && kpi?.error && <span className="inline-warn" title={kpi.error}> ⚠</span>}
      </div>
    </div>
  );
}