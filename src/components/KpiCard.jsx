export default function KpiCard({ kpi, config, delta }) {
  const { label, icon, color, textColor } = config;
  const ok = kpi?.ok !== false;
  const value = kpi?.value ?? null;

  const display = ok && value !== null ? (config.format ? config.format(value) : value) : null;
  const text = display !== null ? (typeof display === 'number' ? display.toLocaleString() : String(display)) : '—';

  let sizeCls = '';
  if (text.length > 16) sizeCls = ' value-huge';
  else if (text.length > 12) sizeCls = ' value-xl';
  else if (text.length > 8) sizeCls = ' value-long';

  let subContent = null;
  if (ok && typeof config.sub === 'function') {
    subContent = config.sub(kpi);
  } else if (ok && typeof config.sub === 'string') {
    subContent = config.sub;
  }

  const showDelta =
    ok && delta && Number.isFinite(delta.diff) && delta.diff !== 0 && Number.isFinite(Number(value));

  return (
    <div className={`card ${ok ? '' : 'card-error'}${config.chart ? ' chart-card' : ''}`}>
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
      <div className={`kpi-value${sizeCls}`} style={{ color: textColor }}>
        {display !== null ? text : '—'}
      </div>
      <div className="kpi-sub">
        {ok ? (subContent ?? '') : kpi?.error ? 'No access to this data' : 'Unavailable'}
        {showDelta && (
          <span
            className={`delta ${delta.diff > 0 ? 'delta-up' : 'delta-down'}`}
            title="vs last week"
          >
            {delta.diff > 0 ? '▲' : '▼'} {Math.abs(delta.diff).toLocaleString()}
            {delta.pct != null && ` (${delta.pct > 0 ? '+' : ''}${delta.pct}%)`}
          </span>
        )}
        {ok && kpi?.error && <span className="inline-warn" title={kpi.error}> ⚠</span>}
      </div>
      {ok && config.chart && <div className="chart-zone">{config.chart(kpi)}</div>}
    </div>
  );
}