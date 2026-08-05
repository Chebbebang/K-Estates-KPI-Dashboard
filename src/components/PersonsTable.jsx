export default function PersonsTable({ rows }) {
  const data = rows ?? [];
  if (!data.length) return null;

  const sorted = [...data].sort((a, b) => b.listings - a.listings || b.comments - a.comments);

  return (
    <section className="persons">
      <div className="persons-header">
        <h2>Responsible Persons</h2>
        <span className="persons-count">{sorted.length} active</span>
      </div>
      <div className="persons-table-wrap">
        <table className="persons-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Listings</th>
              <th className="num">New (7d)</th>
              <th className="num">Comments (7d)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.userId}>
                <td>{r.name}</td>
                <td className="num">{Number(r.listings).toLocaleString()}</td>
                <td className="num">{Number(r.newListings).toLocaleString()}</td>
                <td className="num">{Number(r.comments).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
