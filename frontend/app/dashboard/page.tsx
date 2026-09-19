"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DashboardLogin from "@/components/dashboard/Login";
import StatsCards from "@/components/dashboard/StatsCards";
import DataTable from "@/components/dashboard/DataTable";
import SafeguardingPanel from "@/components/dashboard/SafeguardingPanel";
import { adminChangePassword, adminDeleteUser, adminMe, fetchDashboard, markReply } from "@/lib/api";
import { dashTokenStorage } from "@/lib/storage";

type Tab = "all" | "waiting" | "stuck" | "matched" | "surveys" | "safeguarding";

const TABS: { key: Tab; label: string; path: string }[] = [
  { key: "all", label: "All users", path: "users" },
  { key: "waiting", label: "Waiting for reply", path: "waiting" },
  { key: "stuck", label: "Stuck (7+ days, no contact)", path: "stuck" },
  { key: "matched", label: "Matched", path: "matched" },
  { key: "surveys", label: "Surveys", path: "surveys" },
  { key: "safeguarding", label: "Safeguarding", path: "safeguarding" },
];

const SURVEY_QUESTIONS = [
  { key: "q1_afraid", short: "Q1: Afraid of ADRD" },
  { key: "q2_confident", short: "Q2: Confident around" },
  { key: "q3_comfortable_touching", short: "Q3: Comfortable touching" },
  { key: "q4_uncomfortable", short: "Q4: Uncomfortable around" },
  { key: "q5_different_needs", short: "Q5: Different needs" },
  { key: "q6_past_history", short: "Q6: Past history matters" },
  { key: "q7_relaxed", short: "Q7: Relaxed around" },
  { key: "q8_feel_kindness", short: "Q8: Feel kindness" },
  { key: "q9_frustrated", short: "Q9: Frustrated helping" },
  { key: "q10_difficult_behaviour", short: "Q10: Difficult = communication" },
];

function scoreColor(score: number | null | undefined) {
  if (score == null) return "bg-gray-100 text-gray-500";
  if (score <= 2) return "bg-red-100 text-red-700";
  if (score <= 3) return "bg-amber-100 text-amber-700";
  if (score === 4) return "bg-gray-100 text-gray-700";
  if (score <= 5) return "bg-blue-100 text-blue-700";
  return "bg-green-100 text-green-700";
}

export default function DashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [rows, setRows] = useState<any[]>([]);
  const [surveyStats, setSurveyStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [showChangePw, setShowChangePw] = useState(false);

  // Restore saved session token
  useEffect(() => {
    const stored = dashTokenStorage.get();
    if (stored) handleAuth(stored, null);
  }, []);

  async function handleAuth(tok: string, who: string | null) {
    setToken(tok);
    if (who) setEmail(who);
    try {
      const s = await fetchDashboard("summary", tok);
      setSummary(s);
      // If we restored from storage we don't know the email yet — fetch it.
      if (!who) {
        const me = await adminMe(tok).catch(() => null);
        if (me?.email) setEmail(me.email);
      }
    } catch (e: any) {
      setError(e.message);
      dashTokenStorage.clear();
      setToken(null);
      setEmail(null);
    }
  }

  // Refresh rows + stats. For the Surveys tab also pull aggregate stats.
  const reloadCurrentTab = useCallback(async () => {
    if (!token) return;
    const t = TABS.find((x) => x.key === tab);
    if (!t) return;
    // The Safeguarding tab is a self-contained component that fetches its own
    // data — skip the generic table fetch (and its summary refresh).
    if (tab === "safeguarding") {
      try {
        const s = await fetchDashboard("summary", token);
        setSummary(s);
      } catch (e: any) {
        setError(e.message);
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const promises: Promise<any>[] = [
        fetchDashboard<any[]>(t.path, token),
        fetchDashboard("summary", token),
      ];
      if (tab === "surveys") {
        promises.push(fetchDashboard("survey-stats", token));
      }
      const [data, s, stats] = await Promise.all(promises);
      setRows(data);
      setSummary(s);
      if (tab === "surveys") setSurveyStats(stats);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, tab]);

  // Load tab data when tab changes
  useEffect(() => {
    reloadCurrentTab();
  }, [tab, token, reloadCurrentTab]);

  function signOut() {
    dashTokenStorage.clear();
    setToken(null);
    setEmail(null);
    setSummary(null);
  }

  async function handleDeleteUser(userId: string, fullName: string) {
    if (!token) return;
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
      await adminDeleteUser(userId, token);
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
    if (!token) return;
    const label = outcome === "accepted" ? "ACCEPTED" : "REJECTED";
    if (!confirm(`Mark ${careHomeName} as ${label}? (Sends emails if accepted.)`))
      return;
    setBusyRow(contactId);
    setError(null);
    try {
      await markReply(contactId, outcome, token);
      await reloadCurrentTab();
    } catch (e: any) {
      setError(e.message || "Mark reply failed");
    } finally {
      setBusyRow(null);
    }
  }

  // Column definitions — re-built per render because they close over the handlers above
  // Safeguarding renders its own component, so it's excluded from the column map.
  const COLUMNS: Record<Exclude<Tab, "safeguarding">, { key: string; label: string; render?: (r: any) => any }[]> = {
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
            className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold border border-red-200 hover:bg-red-100 transition disabled:opacity-50 min-h-[44px]"
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
                className="px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-semibold border border-green-200 hover:bg-green-100 transition disabled:opacity-50 min-h-[44px]"
                title="Accepted — sends welcome email"
              >
                ✓ Yes
              </button>
              <button
                onClick={() =>
                  handleMarkReply(contactId, "rejected", r.care_home_name)
                }
                disabled={busyRow === contactId}
                className="px-2.5 py-1.5 rounded-lg bg-gray-50 text-gray-700 text-xs font-semibold border border-gray-200 hover:bg-gray-100 transition disabled:opacity-50 min-h-[44px]"
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
            className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold border border-red-200 hover:bg-red-100 transition disabled:opacity-50 min-h-[44px]"
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
    surveys: [
      { key: "full_name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "age", label: "Age" },
      {
        key: "completed_at",
        label: "Completed",
        render: (r: any) => (r.completed_at ? new Date(r.completed_at).toLocaleDateString() : "—"),
      },
      ...SURVEY_QUESTIONS.map((q, i) => ({
        key: q.key,
        label: `Q${i + 1}`,
        render: (r: any) => (
          <span
            className={`inline-block min-w-[32px] text-center px-2 py-1 rounded-md text-xs font-semibold ${scoreColor(
              r[q.key]
            )}`}
            title={q.short}
          >
            {r[q.key] ?? "—"}
          </span>
        ),
      })),
    ],
  };

  if (!token) return <DashboardLogin onAuth={handleAuth} />;

  return (
    <main className="min-h-screen safe-top safe-bottom">
      <header className="bg-yopey-accent px-4 md:px-6 py-4">
        <div className="flex items-center justify-between max-w-6xl mx-auto gap-4">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-extrabold text-xl text-yopey-primary tracking-wide">YOPEY</span>
            <span className="text-base text-yopey-primary/80 italic">Befriender · Dashboard</span>
          </Link>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {email && (
              <span className="text-xs text-yopey-primary/80 hidden sm:inline max-w-[180px] truncate">
                {email}
              </span>
            )}
            <Link
              href="/guide"
              className="text-sm text-yopey-primary hover:bg-white/30 font-semibold px-3 py-2 rounded-lg min-h-[40px] flex items-center"
            >
              Guide
            </Link>
            <button
              onClick={reloadCurrentTab}
              className="text-sm text-yopey-primary hover:bg-white/30 font-semibold px-3 py-2 rounded-lg min-h-[40px]"
            >
              Refresh
            </button>
            <button
              onClick={() => setShowChangePw(true)}
              className="text-sm text-yopey-primary hover:bg-white/30 font-semibold px-3 py-2 rounded-lg min-h-[40px]"
            >
              Change password
            </button>
            <button
              onClick={signOut}
              className="text-sm text-yopey-primary hover:bg-white/30 font-semibold px-3 py-2 rounded-lg min-h-[40px]"
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

        {tab === "surveys" && surveyStats && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800">
                Average score per question
              </h3>
              <span className="text-xs text-gray-500">
                across {surveyStats.count} survey{surveyStats.count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {SURVEY_QUESTIONS.map((q, i) => {
                const avg = surveyStats.averages?.[q.key];
                return (
                  <div
                    key={q.key}
                    className="rounded-xl border border-gray-100 p-3"
                    title={q.short}
                  >
                    <div className="text-xs text-gray-500">Q{i + 1}</div>
                    <div
                      className={`text-2xl font-extrabold mt-1 inline-block px-2 py-0.5 rounded-md ${scoreColor(
                        avg
                      )}`}
                    >
                      {avg ?? "—"}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1 leading-tight">
                      {q.short.replace(/^Q\d+:\s*/, "")}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Scale: 1 = Strongly Disagree · 4 = Neutral · 7 = Strongly Agree.
              For questions 1, 4, 9 (negative phrasing) a LOWER average is more
              positive; for the rest a HIGHER average is more positive.
            </p>
          </div>
        )}

        {tab === "safeguarding" ? (
          <SafeguardingPanel token={token} />
        ) : loading ? (
          <div className="text-center text-gray-400 py-12">Loading...</div>
        ) : (
          <DataTable
            title={TABS.find((t) => t.key === tab)?.label || ""}
            columns={COLUMNS[tab as Exclude<Tab, "safeguarding">]}
            rows={rows}
            emptyMessage={
              tab === "surveys"
                ? "No surveys completed yet — they'll appear here as teens finish the wizard."
                : "No rows yet — they'll appear as young people use the chat."
            }
          />
        )}
      </section>

      {showChangePw && token && (
        <ChangePasswordModal token={token} onClose={() => setShowChangePw(false)} />
      )}
    </main>
  );
}

function ChangePasswordModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirmPw) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await adminChangePassword(current, next, token);
      setDone(true);
    } catch (err: any) {
      setError(err.message || "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 grid place-items-center px-6"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-6 md:p-8 space-y-4"
      >
        <h2 className="text-xl font-extrabold text-yopey-ink">Change password</h2>

        {done ? (
          <>
            <div className="rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3">
              Your password has been changed.
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full px-6 py-3 rounded-2xl bg-yopey-primary text-white font-semibold min-h-[48px]"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Current password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                New password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1.5">At least 10 characters.</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Confirm new password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-6 py-3 rounded-2xl bg-gray-100 text-gray-700 font-semibold min-h-[48px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 px-6 py-3 rounded-2xl bg-yopey-primary text-white font-semibold disabled:opacity-50 min-h-[48px]"
              >
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
