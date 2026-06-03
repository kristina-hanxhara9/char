type Summary = {
  total_young_people: number;
  signups_last_30_days: number;
  by_status: Record<string, number>;
  contacts: {
    total: number;
    waiting_for_reply: number;
    accepted: number;
    rejected: number;
  };
};

export default function StatsCards({ summary }: { summary: Summary }) {
  const cards = [
    { label: "Total young people", value: summary.total_young_people, accent: "text-yopey-primary" },
    { label: "Signups (last 30 days)", value: summary.signups_last_30_days, accent: "text-yopey-accent" },
    { label: "Care home contacts", value: summary.contacts.total, accent: "text-yopey-primary" },
    { label: "Matched (accepted)", value: summary.contacts.accepted, accent: "text-green-600" },
    { label: "Waiting for reply", value: summary.contacts.waiting_for_reply, accent: "text-amber-600" },
    { label: "Rejected", value: summary.contacts.rejected, accent: "text-gray-500" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm"
          >
            <div className="text-xs text-gray-500">{c.label}</div>
            <div className={`text-2xl md:text-3xl font-extrabold mt-1 ${c.accent}`}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {Object.keys(summary.by_status).length > 0 && (
        <div className="mt-4 bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="text-xs text-gray-500 mb-2">By status</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.by_status).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 text-yopey-primary text-sm font-medium"
              >
                {k}
                <span className="bg-white rounded-full px-2 py-0.5 text-xs text-yopey-primaryDark">
                  {v}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
