"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteAccount } from "@/lib/api";
import { userStorage } from "@/lib/storage";

export default function PrivacyPage() {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const u = userStorage.get();
    if (!u) {
      setError("You're not signed in on this device — nothing to delete here. Email hello@yopey.org if you want us to remove your account.");
      return;
    }
    if (
      !confirm(
        "Permanently delete your YOPEY account and all chat history? This can't be undone."
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteAccount(u.user_id, u.user_token);
      const total = Object.values(result.deleted_rows).reduce((a, b) => a + b, 0);
      setDeleteResult(`Done. ${total} record${total === 1 ? "" : "s"} deleted.`);
      userStorage.clear();
      setTimeout(() => router.push("/"), 2500);
    } catch (err: any) {
      setError(err.message || "Delete failed. Please email hello@yopey.org for help.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="min-h-screen safe-top safe-bottom">
      <header className="bg-yopey-accent px-6 py-5 md:px-10 md:py-6">
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-extrabold text-2xl text-yopey-primaryDark tracking-wide">YOPEY</span>
            <span className="text-lg text-yopey-primaryDark/80 italic">Befriender</span>
          </Link>
          <Link href="/" className="text-sm text-yopey-primaryDark hover:text-yopey-primary font-semibold">
            ← Back
          </Link>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-6 md:px-10 py-6 prose prose-purple">
        <h1 className="text-3xl md:text-4xl font-extrabold text-yopey-ink mb-2">
          Privacy & your data
        </h1>
        <p className="text-gray-600">
          YOPEY (registered charity 1145573) takes your privacy seriously, especially
          because we work with young people. This page explains exactly what data we
          collect, why, who sees it, and how to delete it.
        </p>

        <h2 className="text-xl font-bold mt-8 mb-2">What we collect</h2>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>
            <strong>About you</strong>: your first name, surname, age, email,
            phone number, and home postcode.
          </li>
          <li>
            <strong>About where you study</strong> (if you&apos;re in school /
            college / uni): the name of your school and which postcode
            you&apos;d like care homes searched near (school or home).
          </li>
          <li>
            <strong>Your survey answers</strong>: the 10 Dementia Attitudes
            Scale answers you give in the sign-up wizard. YOPEY uses these to
            compare your views before and after volunteering — to measure how
            being a befriender changes you. We don&apos;t share individual
            scores; only anonymous averages.
          </li>
          <li>
            <strong>From the chat</strong>: everything you type into the chatbot,
            plus what the bot replies (so we can keep context between sessions).
          </li>
          <li>
            <strong>Care home contacts</strong>: which care homes you reach out
            to and whether they reply, so we can send the right reminders.
          </li>
        </ul>

        <h2 className="text-xl font-bold mt-8 mb-2">Why we collect it</h2>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>Find care homes near you (postcode).</li>
          <li>Draft personalised introduction letters (name, age).</li>
          <li>Send you reminders if a care home hasn&apos;t replied (email).</li>
          <li>Send you welcome and training tips once you&apos;re accepted (email).</li>
          <li>
            Help Tony (YOPEY&apos;s coordinator) see overall stats and check on people
            who might need a nudge.
          </li>
        </ul>

        <h2 className="text-xl font-bold mt-8 mb-2">Who else sees your data</h2>
        <p className="text-gray-700">
          We use these trusted services. Each only sees the data they need to do their
          part, and each has a Data Processing Agreement with YOPEY:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>
            <strong>Supabase</strong> (database, hosted in London) — stores everything.
          </li>
          <li>
            <strong>OpenAI</strong> (the AI chatbot, US-based, with EU standard
            contractual clauses) — sees the chat messages so it can reply. OpenAI
            confirms API data is <strong>not</strong> used to train their models.
          </li>
          <li>
            <strong>Resend</strong> (sends the reminder emails) — sees your email
            address and the reminder content.
          </li>
          <li>
            <strong>Vercel and Render</strong> (run the website and the brain) — see
            data while it&apos;s being processed.
          </li>
        </ul>
        <p className="text-gray-700">
          We <strong>do not</strong> sell, share, or rent your data to anyone else.
          Care homes you contact will obviously see the email you send them — but
          that&apos;s you sending it, not us.
        </p>

        <h2 className="text-xl font-bold mt-8 mb-2">How long we keep it</h2>
        <p className="text-gray-700">
          We keep your data while your account is active. If you haven&apos;t used
          YOPEY Befriender for <strong>12 months</strong>, we&apos;ll automatically
          delete your data. You can also delete it any time — see below.
        </p>

        <h2 className="text-xl font-bold mt-8 mb-2">Your rights</h2>
        <p className="text-gray-700">
          Under UK GDPR you can:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>Ask us what data we hold about you.</li>
          <li>Ask us to correct it.</li>
          <li>Ask us to delete it (do this below, or email us).</li>
          <li>
            Complain to the{" "}
            <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noreferrer">
              Information Commissioner&apos;s Office
            </a>{" "}
            if you think we&apos;ve mishandled your data.
          </li>
        </ul>

        <h2 className="text-xl font-bold mt-8 mb-2">Contact</h2>
        <p className="text-gray-700">
          Email <a href="mailto:hello@yopey.org">hello@yopey.org</a> or call 01440
          821654. We&apos;ll reply within a few days.
        </p>

        <hr className="my-10 border-yopey-primaryLight" />

        <div className="bg-white rounded-2xl border border-yopey-primaryLight p-6">
          <h2 className="text-xl font-bold text-yopey-ink mb-2">Delete my data</h2>
          <p className="text-gray-700 mb-4">
            This permanently removes your YOPEY account, every message you sent the
            chatbot, every care home contact you logged, and every nudge you&apos;ve
            received. It can&apos;t be undone.
          </p>
          {deleteResult ? (
            <div className="rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3">
              ✅ {deleteResult} Redirecting...
            </div>
          ) : (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-5 py-3 rounded-2xl bg-red-600 text-white font-semibold hover:bg-red-700 transition disabled:opacity-50 min-h-[48px]"
            >
              {deleting ? "Deleting..." : "Delete everything"}
            </button>
          )}
          {error && (
            <div className="mt-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
              {error}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500 mt-10 mb-6">
          Last updated: June 2026. Registered charity 1145573.
        </p>
      </section>
    </main>
  );
}
