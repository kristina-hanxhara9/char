"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import QuickStartForm from "@/components/QuickStartForm";

/**
 * Entry screen for the funnel — this is what the chat-widget bubble opens. With
 * no intent it shows the three choices: "Find a care home" goes to the full
 * questionnaire; the other two go to the lightweight quick sign-in. With
 * ?intent=advice|report it renders that quick sign-in directly.
 *
 * (Direct visitors to the homepage see the same three options via
 * ReturningUserCta; this screen is the equivalent entry inside the widget.)
 */
export default function StartScreen() {
  const intent = useSearchParams().get("intent");

  if (intent === "advice" || intent === "report") {
    return <QuickStartForm />;
  }

  return (
    <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-yopey-primary/20 p-6 md:p-8">
      <h1 className="text-2xl font-extrabold text-yopey-ink">How can we help?</h1>
      <p className="mt-1 text-sm text-gray-600">Pick one to get started.</p>

      <div className="mt-6 flex flex-col gap-3">
        <Link
          href="/onboard?intent=search"
          className="inline-flex items-center justify-center px-6 py-4 rounded-2xl bg-yopey-primary text-white font-semibold shadow-lg shadow-yopey-primary/30 hover:opacity-90 transition active:scale-[0.98] min-h-[52px]"
        >
          Find a care home →
        </Link>
        <Link
          href="/start?intent=advice"
          className="inline-flex items-center justify-center px-5 py-4 rounded-2xl border-2 border-yopey-primary/30 text-yopey-primary font-semibold hover:bg-yopey-primary/10 transition min-h-[52px]"
        >
          Ask for advice
        </Link>
        <Link
          href="/start?intent=report"
          className="inline-flex items-center justify-center px-5 py-4 rounded-2xl border-2 border-yopey-primary/30 text-yopey-primary font-semibold hover:bg-yopey-primary/10 transition min-h-[52px]"
        >
          Polish a visit report
        </Link>
      </div>

      <p className="mt-5 text-xs text-gray-500 text-center">
        Only finding a care home needs a few quick questions. Free · UK · 16+
      </p>
    </div>
  );
}
