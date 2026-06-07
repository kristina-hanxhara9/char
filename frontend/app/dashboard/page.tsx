"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DashboardLogin from "@/components/dashboard/Login";
import StatsCards from "@/components/dashboard/StatsCards";
import DataTable from "@/components/dashboard/DataTable";
import { adminDeleteUser, fetchDashboard, markReply } from "@/lib/api";
import { dashPasswordStorage } from "@/lib/storage";

type Tab = "all" | "waiting" | "stuck" | "matched";

const TABS: { key: Tab; label: string; path: string }[] = [
  { key: "all", label: "All users", path: "users" },
  { key: "waiting", label: "Waiting for reply", path: "waiting" },
  { key: "stuck", label: "Stuck (7+ days, no contact)", path: "stuck" },
  { key: "matched", label: "Matched", path: "matched" },
];

export default function DashboardPage() {
  const [password, setPassword] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);

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

  // Refresh rows + stats
  const reloadCurrentTab = useCallback(async () => {
    if (!password) return;
    const t = TABS.find((x) => x.key === tab);
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const [data, s] = await Promise.all([
        fetchDashboard<any[]>(t.path, password),
        fetchDashboard("summary", password),
      ]);
      setRows(data);
      setSummary(s);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [password, tab]);

  // Load tab data when tab changes
  useEffect(() => {
    reloadCurrentTab();
  }, [tab, password, reloadCurrentTab]);

  function signOut() {
    dashPasswordStorage.clear();
    setPassword(null);
    setSummary(null);
  }

  async function handleDeleteUser(userId: string, fullName: string) {
    if (
      !confirm(
        `Permanently delete ${fullName} and ALL their data (chat history, ` +
          `contacts, surveys, emails)? This can't be undone.`
      )
    ) {
      return;
    }
    setBusyRow(userId);
    setError(null);
    try {
      await adminDeleteUser(userId);
      await reloadCurrentTab();
    } catch (e: any) {
      setError(e.message || "Delete failed");
    } finally {
      setBusyRow(null);
    }
  }

  async function handleMarkReply(
    contactId: string,
    outcome: "accepted" | "rejected",
    careHomeName: string
  ) {
    if (!password) return;
    const label = outcome === "accepted" ? "ACCEPTED" : "REJECTED";
    if (!confirm(`Mark ${careHomeName} as ${label}? (Sends emails if accepted.)`))
      return;
    setBusyRow(contactId);
    setError(null);
    try {
      await markReply(contactId, outcome, password);
      await reloadCurrentTab();
    } catch (e: any) {
      setError(e.message || "Mark reply failed");
    } finally {
      setBusyRow(null);
    }
  }

  // Column definitions — re-built per render because they close over the handlers above
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
        render: (r: any) => (r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"),
      },
      {
        key: "_actions",
        label: "Actions",
        render: (r: any) => (
          <button
            onClick={() => handleDeleteUser(r.id, r.full_name)}
            disabled={busyRow === r.id}
            className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold border border-red-200 hover:bg-red-100 transition disabled:opacity-50 min-h-[36px]"
          >
            {busyRow === r.id ? "..." : "Delete"}
          </button>
        ),
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
      {
        key: "_actions",
        label: "Reply?",
        render: (r: any) => {
          // The waiting view exposes the contact via user_id+care_home_name. The
          // mark-reply endpoint needs contact_id — but the view doesn't include
          // it, so we use 'id' if present (added below in v1.1) or skip the
          // buttons if missing. Falling back gracefully here.
          const contactId = r.contact_id || r.id;
          if (!contactId) return <span className="text-xs text-gray-400">—</span>;
          return (
            <div className="flex gap-1.5 whitespace-nowrap">
              <button
                onClick={() =>
                  handleMarkReply(contactId, "accepted", r.care_home_name)
                }
                disabled={busyRow === contactId}
                className="px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-semibold border border-green-200 hover:bg-green-100 transition disabled:opacity-50 min-h-[36px]"
                title="Accepted — sends welcome email"
              >
                ✓ Yes
              </button>
              <button
                onClick={() =>
                  handleMarkReply(contactId, "rejected", r.care_home_name)
                }
                disabled={busyRow === contactId}
                className="px-2.5 py-1.5 rounded-lg bg-gray-50 text-gray-700 text-xs font-semibold border border-gray-200 hover:bg-gray-100 transition disabled:opacity-50 min-h-[36px]"
                title="Rejected — stops nudges"
              >
                ✗ No
              </button>
            </div>
          );
        },
      },
    ],
    stuck: [
      { key: "full_name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "age", label: "Age" },
      { key: "postcode", label: "Postcode" },
      { key: "days_since_signup", label: "Days since signup" },
      {
        key: "_actions",
        label: "Actions",
        render: (r: any) => (
          <button
            onClick={() => handleDeleteUser(r.user_id, r.full_name)}
            disabled={busyRow === r.user_id}
            className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold border border-red-200 hover:bg-red-100 transition disabled:opacity-50 min-h-[36px]"
          >
            {busyRow === r.user_id ? "..." : "Delete"}
          </button>
        ),
      },
    ],
    matched: [
      { key: "full_name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "care_home_name", label: "Care home" },
      {
        key: "contacted_at",
        label: "Contacted",
        render: (r: any) => (r.contacted_at ? new Date(r.contacted_at).toLocaleDateString() : "—"),
      },
    ],
  };

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
              onClick={reloadCurrentTab}
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
