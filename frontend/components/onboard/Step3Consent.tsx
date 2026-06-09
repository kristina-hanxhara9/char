"use client";

import { useState } from "react";

type Props = {
  submitting: boolean;
  error: string | null;
  onSubmit: (consent: boolean) => void;
  onBack: () => void;
};

export default function Step3Consent({ submitting, error, onSubmit, onBack }: Props) {
  const [consent, setConsent] = useState(false);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border-2 border-yopey-accent/30 p-4 bg-yopey-accent/15">
        <label className="flex gap-3 items-start cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 w-5 h-5 accent-yopey-primary cursor-pointer"
          />
          <span className="text-sm text-gray-700 leading-relaxed">
            I&apos;m happy for YOPEY to store the information I gave on the previous
            steps + my chat with the bot, so it can find care homes for me and send me
            reminders. I&apos;ve read the{" "}
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

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 px-5 py-4 rounded-2xl border-2 border-gray-200 text-gray-700 font-semibold hover:border-yopey-primary transition disabled:opacity-50 min-h-[52px]"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={() => onSubmit(consent)}
          disabled={!consent || submitting}
          className="flex-[2] px-6 py-4 rounded-2xl bg-yopey-primary text-white font-semibold shadow-md hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed min-h-[52px]"
        >
          {submitting ? "Setting up..." : "Find care homes →"}
        </button>
      </div>

      <p className="text-xs text-gray-500 text-center">
        You can delete your data any time at{" "}
        <a href="/privacy" className="underline">
          /privacy
        </a>
        .
      </p>
    </div>
  );
}
