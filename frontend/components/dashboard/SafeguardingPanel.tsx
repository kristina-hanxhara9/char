"use client";

import { useEffect, useState } from "react";
import { fetchConversation, fetchDashboard, resolveSafeguarding } from "@/lib/api";

type Alert = {
  id: string;
  user_id: string;
  full_name: string;
  email: string | null;
  age: number | null;
  category: string;
  severity: string;
  summary: string | null;
  notified_email: boolean;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

function severityChip(sev: string) {
  return sev === "high"
    ? "bg-red-100 text-red-700 border border-red-200"
    : "bg-amber-100 text-amber-800 border border-amber-200";
}

export default function SafeguardingPanel({ password }: { password: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ role: string; content: string }[] | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDashboard<Alert[]>("safeguarding", password);
      setAlerts(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  async function viewTranscript(userId: string) {
    if (openUserId === userId) {
      setOpenUserId(null);
      setTranscript(null);
      return;
    }
    setOpenUserId(userId);
    setTranscript(null);
    setTranscriptLoading(true);
    try {
      const data = await fetchConversation(userId, password);
      setTranscript(data.messages);
    } catch (e: any) {
      setError(e.message);
      setOpenUserId(null);
    } finally {
      setTranscriptLoading(false);
    }
  }

  async function resolve(alert: Alert) {
    const who = prompt("Your name (recorded as who actioned this alert):");
    if (!who || !who.trim()) return;
    const notes = prompt("Optional note on what you did (leave blank to skip):") || undefined;
    setBusyId(alert.id);
    try {
      await resolveSafeguarding(alert.id, who.trim(), password, notes);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const openCount = alerts.filter((a) => !a.resolved).length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-yopey-accent/15 border border-yopey-accent/30 p-4">
        <p className="font-semibold text-yopey-ink">
          Safeguarding alerts {openCount > 0 && <span className="text-red-700">· {openCount} open</span>}
        </p>
        <p className="text-sm text-gray-700 mt-1">
          Raised automatically when the chatbot detects a young person may be at
          risk. The young person was shown helpline details in the chat. Review
          each one and follow YOPEY&apos;s safeguarding procedure, then mark it
          actioned. You can read the full conversation only for flagged users.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading...</div>
      ) : alerts.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-gray-400">
          No safeguarding alerts. Good.
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <div
              key={a.id}
              className={`rounded-2xl border bg-white p-4 shadow-sm ${
                a.resolved ? "border-gray-100 opacity-70" : "border-red-200"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-bold px-2 py-1 rounded-md ${severityChip(a.severity)}`}>
                    {a.severity.toUpperCase()}
                  </span>
                  <span className="text-xs font-semibold px-2 py-1 rounded-md bg-gray-100 text-gray-700">
                    {a.category.replace(/_/g, " ")}
                  </span>
                  {a.resolved ? (
                    <span className="text-xs font-semibold px-2 py-1 rounded-md bg-green-100 text-green-700">
                      Actioned by {a.resolved_by}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold px-2 py-1 rounded-md bg-red-50 text-red-700">
                      Open
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>

              <div className="mt-2 text-sm text-gray-800">
                <span className="font-semibold">{a.full_name || "Unknown"}</span>
                {a.age != null && <span className="text-gray-500"> · age {a.age}</span>}
                {a.email && <span className="text-gray-500"> · {a.email}</span>}
              </div>

              {a.summary && (
                <p className="mt-1 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                  {a.summary}
                </p>
              )}

              {!a.notified_email && (
                <p className="mt-2 text-xs text-amber-700">
                  ⚠ Email to safeguarding lead was not sent (check RESEND_API_KEY /
                  SAFEGUARDING_EMAIL). Review this one promptly.
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => viewTranscript(a.user_id)}
                  className="px-3 py-1.5 rounded-lg bg-yopey-primary/10 text-yopey-primary text-xs font-semibold hover:bg-yopey-primary/20 transition min-h-[36px]"
                >
                  {openUserId === a.user_id ? "Hide conversation" : "Read conversation"}
                </button>
                {!a.resolved && (
                  <button
                    onClick={() => resolve(a)}
                    disabled={busyId === a.id}
                    className="px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-semibold border border-green-200 hover:bg-green-100 transition disabled:opacity-50 min-h-[36px]"
                  >
                    {busyId === a.id ? "..." : "Mark actioned"}
                  </button>
                )}
              </div>

              {openUserId === a.user_id && (
                <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 max-h-80 overflow-y-auto">
                  {transcriptLoading ? (
                    <div className="text-center text-gray-400 py-6 text-sm">Loading conversation...</div>
                  ) : transcript && transcript.length > 0 ? (
                    <div className="space-y-2">
                      {transcript.map((m, i) => (
                        <div
                          key={i}
                          className={`text-sm rounded-lg px-3 py-2 ${
                            m.role === "user"
                              ? "bg-yopey-primary/10 text-gray-900 ml-8"
                              : "bg-white border border-gray-200 text-gray-700 mr-8"
                          }`}
                        >
                          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                            {m.role === "user" ? "Young person" : "Bot"}
                          </div>
                          <div className="whitespace-pre-wrap">{m.content}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-gray-400 py-6 text-sm">No messages.</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
