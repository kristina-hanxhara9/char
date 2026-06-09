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

// Mirrors yopey.org's alternating gold-then-purple circle pattern:
// gold for short-term / activity metrics, purple for cumulative / outcomes.
type Card = {
  label: string;
  value: number;
  variant: "gold" | "purple";
};

export default function StatsCards({ summary }: { summary: Summary }) {
  const cards: Card[] = [
    { label: "Signups (last 30 days)", value: summary.signups_last_30_days, variant: "gold" },
    { label: "Total young people", value: summary.total_young_people, variant: "purple" },
    { label: "Care home contacts", value: summary.contacts.total, variant: "gold" },
    { label: "Matched (accepted)", value: summary.contacts.accepted, variant: "purple" },
    { label: "Waiting for reply", value: summary.contacts.waiting_for_reply, variant: "gold" },
    { label: "Rejected", value: summary.contacts.rejected, variant: "purple" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="flex flex-col items-center text-center">
            <div
              className={`w-24 h-24 md:w-28 md:h-28 rounded-full grid place-items-center shadow-md ${
                c.variant === "gold"
                  ? "bg-yopey-gold text-white"
                  : "bg-yopey-primary text-white"
              }`}
            >
              <div className="text-3xl md:text-4xl font-extrabold leading-none">
                {c.value}
              </div>
            </div>
            <div className="text-xs text-gray-600 mt-2 leading-tight px-1">
              {c.label}
            </div>
          </div>
        ))}
      </div>

      {Object.keys(summary.by_status).length > 0 && (
        <div className="mt-6 bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="text-xs text-gray-500 mb-2">By status</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.by_status).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yopey-primaryLight text-yopey-primary text-sm font-medium"
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
