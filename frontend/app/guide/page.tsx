"use client";

import { useState } from "react";
import Link from "next/link";
import GuideAssistant from "@/components/guide/GuideAssistant";

type Audience = "user" | "owner";

type Section = {
  n: string;
  title: string;
  blocks: { heading?: string; items: string[] }[];
};

// ---- USER GUIDE (the young volunteer) ----
const USER_GUIDE: Section[] = [
  {
    n: "1",
    title: "What this agent can help you with",
    blocks: [
      {
        heading: "Ask it things like",
        items: [
          "“Find care homes near IP33 3YU.”",
          "“Can you help me write an email to the manager?”",
          "“I'm nervous about my first visit — any tips?”",
          "“What dementia training can I do?”",
          "“The manager said yes — what do I do next?”",
        ],
      },
      {
        heading: "It's good at",
        items: [
          "Finding CQC-registered care homes near your school or home — with walking distance and time to each.",
          "Drafting a friendly introduction email in your own name.",
          "Nudging you to follow up if you haven't heard back.",
          "Pointing you to free dementia-awareness training.",
        ],
      },
    ],
  },
  {
    n: "2",
    title: "How to access it",
    blocks: [
      {
        items: [
          "Open the YOPEY Befriender website and press “Find a care home”.",
          "Answer a few quick questions (first name, age, email, and your postcode or school).",
          "Then just start typing to the assistant to begin a conversation.",
          "It may also appear as a chat bubble on partner websites that have added it.",
        ],
      },
    ],
  },
  {
    n: "3",
    title: "How to get the best out of it",
    blocks: [
      {
        items: [
          "Give it your postcode or school name so it searches the right area.",
          "Be specific — e.g. “email in a warm, casual tone” or “homes within 1 mile”.",
          "If an answer isn't quite right, say so and ask it to try again (“make the email shorter”, “search a bit wider”).",
          "You can always ask it to redo or explain anything.",
        ],
      },
    ],
  },
  {
    n: "4",
    title: "When the agent can't help",
    blocks: [
      {
        items: [
          "If it doesn't know, or a detail looks off (a distance, a manager name), double-check on carehome.co.uk or the CQC website.",
          "If anything about your safety or wellbeing comes up, contact YOPEY's safeguarding lead — the human fallback. The assistant will also point you there.",
          "To flag a bad answer so it gets fixed, tell your YOPEY coordinator what you asked and what it replied.",
        ],
      },
    ],
  },
];

// ---- OWNER GUIDE (the coordinator managing the agent) ----
const OWNER_GUIDE: Section[] = [
  {
    n: "1",
    title: "What this agent does",
    blocks: [
      {
        items: [
          "In one sentence: it lets a young person find a local care home and send a first email in minutes, instead of YOPEY doing it by manual phone calls.",
          "It solves: finding CQC-registered homes nearby, drafting a good intro email, chasing follow-ups, and surfacing safeguarding concerns to staff.",
        ],
      },
      {
        heading: "What it does NOT do",
        items: [
          "Provide care or medical advice.",
          "Guarantee a placement or match.",
          "Replace human safeguarding judgement, or make decisions for a young person.",
        ],
      },
    ],
  },
  {
    n: "2",
    title: "How it works behind the scenes",
    blocks: [
      {
        heading: "Where the knowledge comes from (live, not a fixed database)",
        items: [
          "CQC public API — the list of homes, addresses, ratings, and the registered manager.",
          "postcodes.io + Nominatim — turn postcodes / school names into locations.",
          "OpenRouteService — real walking distance + time (when ORS_API_KEY is set; otherwise straight-line).",
          "carehome.co.uk (web search) — cross-checks the current manager, which the CQC register can lag on.",
          "Google Gemini — the chat “brain” and the web-search lookups.",
          "Behaviour rules live in backend/system_prompt.txt.",
        ],
      },
      {
        heading: "How to update the knowledge",
        items: [
          "Change how it talks/behaves → edit backend/system_prompt.txt.",
          "Training resources → the training_resources table in Supabase.",
          "Verified care-home emails → seed the care_home_emails table.",
          "API keys and settings → the backend environment variables in Render.",
        ],
      },
      {
        heading: "How often to review",
        items: [
          "Check the dashboard and safeguarding alerts weekly.",
          "Review the system prompt and training links roughly monthly (CQC data refreshes ~monthly).",
        ],
      },
    ],
  },
  {
    n: "3",
    title: "How to monitor it",
    blocks: [
      {
        heading: "Where to look",
        items: [
          "The coordinator dashboard at /dashboard (password-protected): signups, who's waiting for a reply, who's stuck, matches, survey scores, and a Safeguarding panel.",
          "You can open each young person's full conversation log from the dashboard.",
        ],
      },
      {
        heading: "How to spot it failing",
        items: [
          "Empty care-home results, distances that look wrong, or missing nearby homes.",
          "Unactioned safeguarding alerts.",
          "503 errors — usually a missing or expired API key; check Render.",
        ],
      },
      {
        heading: "What good performance looks like",
        items: [
          "Nearby homes returned within the search radius with sensible walking distances.",
          "Emails drafted, replies logged, and safeguarding alerts raised and resolved promptly.",
        ],
      },
    ],
  },
  {
    n: "4",
    title: "How to improve it",
    blocks: [
      {
        items: [
          "Add a new topic or change tone: edit backend/system_prompt.txt.",
          "Fix a wrong answer: correct it at the source — the system prompt for behaviour, the relevant Supabase table for data, or the API key for a broken lookup.",
          "If something breaks (503s, no results, errors): check the API keys in Render and the backend logs, then contact the developer/maintainer.",
        ],
      },
    ],
  },
  {
    n: "5",
    title: "Governance",
    blocks: [
      {
        heading: "What data it can and cannot access",
        items: [
          "CAN: the young person's onboarding details (name, age, email, postcode/school), their chat, survey answers, and care-home activity.",
          "CANNOT: anything outside this app; it doesn't browse the user's device or accounts. The guide helper on this page has NO access to user data — it only knows this help text.",
        ],
      },
      {
        heading: "Privacy considerations",
        items: [
          "Follows UK GDPR and the ICO Children's Code (users may be minors). See DPIA.md.",
          "Location is kept coarse (postcode / school area, never the young person's full home address).",
          "Processors: Supabase, Google Gemini, CQC, postcodes.io, Nominatim, OpenRouteService, Resend.",
        ],
      },
      {
        heading: "Escalation path when the agent can't help",
        items: [
          "The agent points the young person to YOPEY's named safeguarding lead.",
          "Staff act on concerns via the Safeguarding panel on the dashboard. See SAFEGUARDING.md.",
        ],
      },
    ],
  },
];

function SectionCard({ section }: { section: Section }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 md:p-6">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-yopey-primary text-white font-bold text-sm flex items-center justify-center">
          {section.n}
        </span>
        <h3 className="text-lg font-extrabold text-yopey-ink">{section.title}</h3>
      </div>
      <div className="space-y-4 pl-0 md:pl-11">
        {section.blocks.map((b, i) => (
          <div key={i}>
            {b.heading && (
              <p className="text-sm font-semibold text-yopey-primary mb-1.5">{b.heading}</p>
            )}
            <ul className="space-y-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2 text-[15px] text-yopey-inkSoft leading-relaxed">
                  <span aria-hidden className="text-yopey-accent mt-0.5">
                    ›
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GuidePage() {
  const [audience, setAudience] = useState<Audience>("user");
  const sections = audience === "user" ? USER_GUIDE : OWNER_GUIDE;

  return (
    <main className="min-h-screen safe-top safe-bottom bg-gray-50">
      <header className="bg-yopey-accent px-4 md:px-6 py-4">
        <div className="flex items-center justify-between max-w-6xl mx-auto gap-4">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-extrabold text-xl text-yopey-primary tracking-wide">YOPEY</span>
            <span className="text-base text-yopey-primary/80 italic">Befriender · Guide</span>
          </Link>
          <Link
            href="/dashboard"
            className="text-sm text-yopey-primary hover:bg-white/30 font-semibold px-3 py-2 rounded-lg min-h-[40px] flex items-center"
          >
            Dashboard →
          </Link>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-yopey-ink">
            How to use the YOPEY Befriender agent
          </h1>
          <p className="mt-1 text-gray-600 text-sm md:text-base">
            A quick guide for the volunteers who chat with the agent and the
            coordinators who look after it. Not sure where to look? Ask the helper
            on the right.
          </p>
        </div>

        {/* Audience toggle */}
        <div className="inline-flex bg-white rounded-full border border-gray-200 p-1 shadow-sm">
          <button
            onClick={() => setAudience("user")}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition min-h-[40px] ${
              audience === "user"
                ? "bg-yopey-primary text-white"
                : "text-gray-600 hover:text-yopey-primary"
            }`}
          >
            For volunteers
          </button>
          <button
            onClick={() => setAudience("owner")}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition min-h-[40px] ${
              audience === "owner"
                ? "bg-yopey-primary text-white"
                : "text-gray-600 hover:text-yopey-primary"
            }`}
          >
            For coordinators (owner)
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr,22rem] items-start">
          {/* Guide content */}
          <div className="space-y-4 order-2 lg:order-1">
            {audience === "owner" && (
              <div className="rounded-xl bg-yopey-primary/5 border border-yopey-primary/20 text-sm text-yopey-inkSoft px-4 py-3">
                The live coordinator tools are on the{" "}
                <Link href="/dashboard" className="font-semibold text-yopey-primary underline">
                  password-protected dashboard
                </Link>
                . This page explains how the agent works.
              </div>
            )}
            {sections.map((s) => (
              <SectionCard key={s.n} section={s} />
            ))}
          </div>

          {/* AI helper — sticky alongside the guide on desktop */}
          <div className="order-1 lg:order-2 lg:sticky lg:top-6">
            <GuideAssistant />
          </div>
        </div>

        <footer className="text-center text-xs text-gray-400 pt-4 pb-8">
          YOPEY Befriender · <Link href="/" className="underline">Home</Link> ·{" "}
          <Link href="/dashboard" className="underline">Dashboard</Link>
        </footer>
      </section>
    </main>
  );
}
