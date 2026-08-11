export default function HBars({ rows, max, color = '#60a5fa' }) {
  const m = max ?? Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="hchart">
      {rows.map((r) => (
        <div className="hrow" key={r.id} title={r.name}>
          <span className="hrow-name">{r.name}</span>
          <div className="hrow-track">
            <div className="hrow-bar" style={{ width: `${Math.max((r.count / m) * 100, 2)}%`, background: color }} />
          </div>
          <span className="hrow-count">{Number(r.count).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}