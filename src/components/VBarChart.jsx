export default function VBarChart({ data, color = '#60a5fa' }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="vchart">
      {data.map((m) => (
        <div className="vchart-col" key={m.key} title={`${m.label}: ${m.count}`}>
          <div className="vchart-bar-wrap">
            <div className="vchart-bar" style={{ height: `${Math.max((m.count / max) * 100, 3)}%`, background: color }} />
          </div>
          <div className="vchart-label">{m.label}</div>
        </div>
      ))}
    </div>
  );
}