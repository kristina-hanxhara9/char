"use client";

import { useState, type FormEvent } from "react";
import { dashPasswordStorage } from "@/lib/storage";
import { fetchDashboard } from "@/lib/api";

type Props = { onAuth: (password: string) => void };

export default function DashboardLogin({ onAuth }: Props) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await fetchDashboard("summary", password);
      dashPasswordStorage.set(password);
      onAuth(password);
    } catch (err: any) {
      setError(err.message || "Wrong password");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-6 safe-top safe-bottom">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-yopey-primary/20 p-6 md:p-8 space-y-5"
      >
        <div>
          <h1 className="text-2xl font-extrabold text-yopey-ink">Dashboard</h1>
          <p className="text-gray-600 text-sm mt-1">YOPEY admin only.</p>
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none"
          />
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-6 py-3.5 rounded-2xl bg-yopey-primary text-white font-semibold hover:opacity-90 transition disabled:opacity-50 min-h-[52px]"
        >
          {submitting ? "Checking..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
