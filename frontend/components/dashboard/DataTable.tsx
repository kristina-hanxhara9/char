type Column = {
  key: string;
  label: string;
  render?: (row: any) => React.ReactNode;
};

type Props = {
  title: string;
  columns: Column[];
  rows: any[];
  emptyMessage?: string;
};

export default function DataTable({ title, columns, rows, emptyMessage }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 md:px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">{title}</h3>
        <span className="text-xs text-gray-500">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-gray-400 text-sm">
          {emptyMessage || "Nothing here yet."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gray-100 hover:bg-yopey-primary/10">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-2.5 text-gray-700">
                      {c.render ? c.render(r) : (r[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
