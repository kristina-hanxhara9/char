"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardLogin from "@/components/dashboard/Login";
import StatsCards from "@/components/dashboard/StatsCards";
import DataTable from "@/components/dashboard/DataTable";
import { fetchDashboard } from "@/lib/api";
import { dashPasswordStorage } from "@/lib/storage";

type Tab = "all" | "waiting" | "stuck" | "matched";

const TABS: { key: Tab; label: string; path: string }[] = [
  { key: "all", label: "All users", path: "users" },
  { key: "waiting", label: "Waiting for reply", path: "waiting" },
  { key: "stuck", label: "Stuck (7+ days, no contact)", path: "stuck" },
  { key: "matched", label: "Matched", path: "matched" },
];

const COLUMNS: Record<Tab, { key: string; label: string; render?: (r: any) => any }[]> = {
  all: [
    { key: "full_name", label: "Name" },
    { key: "age", label: "Age" },
    { key: "email", label: "Email" },
    { key: "postcode", label: "Postcode" },
    { key: "status", label: "Status" },
    { key: "contact_count", label: "Contacts" },
    {
      key: "created_at",
      label: "Joined",
      render: (r: any) => r.created_at ? new Date(r.created_at).toLocaleDateString() : "—",
    },
  ],
  waiting: [
    { key: "full_name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "care_home_name", label: "Care home" },
    { key: "care_home_phone", label: "Phone" },
    { key: "method", label: "Method" },
    { key: "days_waiting", label: "Days waiting" },
    { key: "nudge_stage", label: "Nudge stage" },
  ],
  stuck: [
    { key: "full_name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "age", label: "Age" },
    { key: "postcode", label: "Postcode" },
    { key: "days_since_signup", label: "Days since signup" },
  ],
  matched: [
    { key: "full_name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "care_home_name", label: "Care home" },
    {
      key: "contacted_at",
      label: "Contacted",
      render: (r: any) => r.contacted_at ? new Date(r.contacted_at).toLocaleDateString() : "—",
    },
  ],
};

export default function DashboardPage() {
  const [password, setPassword] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore saved password
  useEffect(() => {
    const stored = dashPasswordStorage.get();
    if (stored) handleAuth(stored);
  }, []);

  async function handleAuth(pw: string) {
    setPassword(pw);
    try {
      const s = await fetchDashboard("summary", pw);
      setSummary(s);
    } catch (e: any) {
      setError(e.message);
      dashPasswordStorage.clear();
      setPassword(null);
    }
  }

  // Load tab data
  useEffect(() => {
    if (!password) return;
    const t = TABS.find((x) => x.key === tab);
    if (!t) return;
    setLoading(true);
    setError(null);
    fetchDashboard<any[]>(t.path, password)
      .then((data) => setRows(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab, password]);

  function signOut() {
    dashPasswordStorage.clear();
    setPassword(null);
    setSummary(null);
  }

  async function refreshSummary() {
    if (!password) return;
    try {
      const s = await fetchDashboard("summary", password);
      setSummary(s);
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (!password) return <DashboardLogin onAuth={handleAuth} />;

  return (
    <main className="min-h-screen safe-top safe-bottom">
      <header className="px-4 md:px-6 py-4 bg-white border-b border-gray-100">
        <div className="flex items-center justify-between max-w-6xl mx-auto gap-4">
          <Link href="/" className="font-bold text-lg text-yopey-primaryDark">
            YOPEY · Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshSummary}
              className="text-sm text-gray-600 hover:text-yopey-primary px-3 py-2 rounded-lg min-h-[40px]"
            >
              Refresh
            </button>
            <button
              onClick={signOut}
              className="text-sm text-gray-500 hover:text-red-600 px-3 py-2 rounded-lg min-h-[40px]"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {summary && <StatsCards summary={summary} />}

        <div className="flex gap-2 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold transition min-h-[40px] ${
                t.key === tab
                  ? "bg-yopey-primary text-white"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-yopey-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading...</div>
        ) : (
          <DataTable
            title={TABS.find((t) => t.key === tab)?.label || ""}
            columns={COLUMNS[tab]}
            rows={rows}
            emptyMessage="No rows yet — they'll appear as young people use the chat."
          />
        )}
      </section>
    </main>
  );
}
