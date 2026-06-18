"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { pingBackend, quickStart } from "@/lib/api";
import { userStorage } from "@/lib/storage";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Minimal sign-in for the "ask for advice" / "polish a visit report" routes.
 * These don't need a postcode or the dementia survey, so we skip the full
 * onboarding wizard and collect just name + age (16+ gate) + email + consent,
 * then drop the user straight into the chat with the matching intent.
 */
export default function QuickStartForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const intent = searchParams.get("intent") === "report" ? "report" : "advice";
  const utmSource = searchParams.get("utm_source") || undefined;

  const [firstName, setFirstName] = useState("");
  const [ageStr, setAgeStr] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Render's free tier sleeps when idle; wake it as the form opens so the
  // submit (and the chat that follows) hit a warm server.
  useEffect(() => {
    pingBackend();
  }, []);

  const heading =
    intent === "report" ? "Let's polish your visit report" : "Let's get you some advice";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const age = parseInt(ageStr, 10);
    if (!firstName.trim()) return setError("Please enter your first name.");
    if (!Number.isFinite(age) || age < 16)
      return setError("You need to be 16 or over to use YOPEY Befriender.");
    if (!EMAIL_RE.test(email.trim())) return setError("Please enter a valid email.");
    if (!consent) return setError("Please tick the consent box to continue.");

    setSubmitting(true);
    setError(null);
    try {
      const res = await quickStart({
        first_name: firstName.trim(),
        age,
        email: email.trim().toLowerCase(),
        utm_source: utmSource,
      });
      userStorage.set({
        user_id: res.user_id,
        user_token: res.user_token,
        first_name: res.first_name,
        is_student: false,
      });
      router.push(`/chat?intent=${intent}`);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-yopey-primary/20 p-6 md:p-8 space-y-5"
    >
      <div>
        <h1 className="text-2xl font-extrabold text-yopey-ink">{heading}</h1>
        <p className="mt-1 text-sm text-gray-600">
          Just a couple of details and we&apos;ll jump straight in — no questionnaire
          needed.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="qs-name" className="block text-sm font-semibold text-gray-700 mb-1">
            First name
          </label>
          <input
            id="qs-name"
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Alex"
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="qs-age" className="block text-sm font-semibold text-gray-700 mb-1">
            Age
          </label>
          <input
            id="qs-age"
            type="number"
            inputMode="numeric"
            min={16}
            max={120}
            value={ageStr}
            onChange={(e) => setAgeStr(e.target.value)}
            placeholder="17"
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="qs-email" className="block text-sm font-semibold text-gray-700 mb-1">
            Email
          </label>
          <input
            id="qs-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            So we can send you a link back in, and reach you if needed.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border-2 border-yopey-accent/30 p-4 bg-yopey-accent/15">
        <label className="flex gap-3 items-start cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 w-5 h-5 accent-yopey-primary cursor-pointer"
          />
          <span className="text-sm text-gray-700 leading-relaxed">
            I confirm I am <strong>16 or over</strong>, and I&apos;m happy for YOPEY to
            store my name, email and my chat with the bot so it can help me. I&apos;ve
            read the{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-yopey-primary font-semibold underline"
            >
              privacy notice
            </a>
            .
          </span>
        </label>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full px-6 py-4 rounded-2xl bg-yopey-primary text-white font-semibold shadow-md hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed min-h-[52px]"
      >
        {submitting ? "Setting up..." : intent === "report" ? "Start my report →" : "Get advice →"}
      </button>

      <p className="text-xs text-gray-500 text-center">
        You can delete your data any time at{" "}
        <a href="/privacy" className="underline">
          /privacy
        </a>
        .
      </p>
    </form>
  );
}
