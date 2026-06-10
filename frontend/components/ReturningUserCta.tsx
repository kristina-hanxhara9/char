"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { requestReturnLink } from "@/lib/api";
import { userStorage, type StoredUser } from "@/lib/storage";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ReturningUserCta() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [mounted, setMounted] = useState(false);

  // Email-return form
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUser(userStorage.get());
    setMounted(true);
  }, []);

  async function handleEmail(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError("Please enter a valid email.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await requestReturnLink(email.trim().toLowerCase());
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Couldn't send the link. Try again.");
    } finally {
      setSending(false);
    }
  }

  // Avoid a flash: render the new-user CTA until we've checked localStorage.
  if (mounted && user) {
    return (
      <div className="mt-8">
        <p className="text-yopey-primary font-semibold mb-3">
          Welcome back, {user.first_name}.
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/chat?intent=search"
            className="inline-flex items-center justify-center px-6 py-4 rounded-2xl bg-yopey-primary text-white font-semibold shadow-lg shadow-yopey-primary/30 hover:opacity-90 transition active:scale-[0.98] min-h-[52px]"
          >
            Find another care home →
          </Link>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/chat?intent=advice"
              className="flex-1 inline-flex items-center justify-center px-5 py-4 rounded-2xl border-2 border-yopey-primary/30 text-yopey-primary font-semibold hover:bg-yopey-primary/10 transition min-h-[52px]"
            >
              Ask for advice
            </Link>
            <Link
              href="/chat?intent=report"
              className="flex-1 inline-flex items-center justify-center px-5 py-4 rounded-2xl border-2 border-yopey-primary/30 text-yopey-primary font-semibold hover:bg-yopey-primary/10 transition min-h-[52px]"
            >
              Polish a visit report
            </Link>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            userStorage.clear();
            setUser(null);
          }}
          className="mt-4 text-sm text-gray-500 hover:text-yopey-primary underline"
        >
          Not you? Start fresh
        </button>
      </div>
    );
  }

  // New visitor (or not yet checked)
  return (
    <div className="mt-8">
      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/onboard"
          className="inline-flex items-center justify-center px-6 py-4 rounded-2xl bg-yopey-primary text-white font-semibold shadow-lg shadow-yopey-primary/30 hover:opacity-90 transition active:scale-[0.98] min-h-[52px]"
        >
          Find a care home →
        </Link>
        <a
          href="https://www.yopeybefriender.org"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center px-6 py-4 rounded-2xl border-2 border-gray-200 text-gray-700 font-semibold hover:border-yopey-primary hover:text-yopey-primary transition min-h-[52px]"
        >
          Learn about YOPEY
        </a>
      </div>

      <p className="mt-6 text-sm text-gray-500">
        Free · UK only · Takes about 5 minutes to get started
      </p>

      {/* Returning on a new device / cleared browser */}
      <div className="mt-6 border-t border-gray-100 pt-5">
        {sent ? (
          <p className="text-sm text-gray-700">
            If that email is registered with YOPEY, we&apos;ve sent a link to get
            you back in. Check your inbox (and spam).
          </p>
        ) : !showEmail ? (
          <button
            type="button"
            onClick={() => setShowEmail(true)}
            className="text-sm text-yopey-primary font-semibold hover:underline"
          >
            Already signed up? Get a link by email →
          </button>
        ) : (
          <form onSubmit={handleEmail} className="space-y-2">
            <label htmlFor="returnEmail" className="block text-sm font-semibold text-gray-700">
              Enter the email you signed up with
            </label>
            <div className="flex gap-2">
              <input
                id="returnEmail"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending}
                className="px-5 py-3 rounded-xl bg-yopey-primary text-white font-semibold hover:opacity-90 transition disabled:opacity-50 min-h-[48px]"
              >
                {sending ? "Sending..." : "Send link"}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-xs text-gray-500">
              We&apos;ll email you a secure one-click link. No password needed.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
