"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onboard } from "@/lib/api";
import { userStorage } from "@/lib/storage";

// Permissive UK postcode pattern. Accepts the standard format, the Girobank
// 'GIR 0AA' special case, and BFPO addresses. Authoritative validation happens
// server-side via postcodes.io — this is just a lightweight UX check.
const UK_POSTCODE_RE =
  /^(?:GIR\s*0AA|BFPO\s*\d{1,4}|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i;

export default function OnboardForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utmSource = searchParams.get("utm_source") || undefined;

  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [ageStr, setAgeStr] = useState("");
  const [email, setEmail] = useState("");
  const [postcode, setPostcode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ageNum = parseInt(ageStr, 10);
  const ageInvalid = ageStr !== "" && (Number.isNaN(ageNum) || ageNum < 16 || ageNum > 120);
  const emailInvalid = email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const postcodeInvalid = postcode !== "" && !UK_POSTCODE_RE.test(postcode.trim());

  const canSubmit =
    firstName.trim().length > 0 &&
    surname.trim().length > 0 &&
    !Number.isNaN(ageNum) &&
    ageNum >= 16 &&
    ageNum <= 120 &&
    email.trim() &&
    !emailInvalid &&
    postcode.trim() &&
    !postcodeInvalid &&
    !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (Number.isNaN(ageNum) || ageNum < 16) {
      setError("Sorry, you need to be at least 16 to use YOPEY Befriender.");
      return;
    }
    if (emailInvalid) {
      setError("Please enter a valid email address.");
      return;
    }
    if (postcodeInvalid) {
      setError("That doesn't look like a UK postcode (e.g. CB8 8YN).");
      return;
    }

    setSubmitting(true);
    try {
      const { user_id, first_name, postcode: returnedPostcode } = await onboard({
        first_name: firstName.trim(),
        surname: surname.trim(),
        age: ageNum,
        email: email.trim(),
        postcode: postcode.trim().toUpperCase(),
        utm_source: utmSource,
      });
      userStorage.set({
        user_id,
        first_name,
        postcode: returnedPostcode || postcode.trim().toUpperCase(),
      });
      router.push("/chat");
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-purple-100 p-6 md:p-8 space-y-4"
    >
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-yopey-ink">
          Let&apos;s get started
        </h1>
        <p className="mt-2 text-gray-600 text-sm">
          A few quick details and we&apos;ll find care homes near you straight away.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="firstName" className="block text-sm font-semibold text-gray-700 mb-1">
            First name
          </label>
          <input
            id="firstName"
            type="text"
            autoComplete="given-name"
            required
            maxLength={50}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Sarah"
            className="w-full px-3 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none focus:ring-0 transition"
          />
        </div>

        <div>
          <label htmlFor="surname" className="block text-sm font-semibold text-gray-700 mb-1">
            Surname
          </label>
          <input
            id="surname"
            type="text"
            autoComplete="family-name"
            required
            maxLength={50}
            value={surname}
            onChange={(e) => setSurname(e.target.value)}
            placeholder="Smith"
            className="w-full px-3 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none focus:ring-0 transition"
          />
        </div>
      </div>

      <div>
        <label htmlFor="age" className="block text-sm font-semibold text-gray-700 mb-1">
          Age
        </label>
        <input
          id="age"
          type="number"
          inputMode="numeric"
          min={16}
          max={120}
          required
          value={ageStr}
          onChange={(e) => setAgeStr(e.target.value)}
          placeholder="16"
          aria-invalid={ageInvalid}
          className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-0 transition ${
            ageInvalid
              ? "border-red-400 focus:border-red-500"
              : "border-gray-200 focus:border-yopey-primary"
          }`}
        />
        {ageInvalid ? (
          <p className="mt-1 text-sm text-red-600">
            Sorry, you need to be 16+ to use YOPEY Befriender.
          </p>
        ) : (
          <p className="mt-1 text-xs text-gray-500">For 16 and over</p>
        )}
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="sarah@example.com"
          aria-invalid={emailInvalid}
          className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-0 transition ${
            emailInvalid
              ? "border-red-400 focus:border-red-500"
              : "border-gray-200 focus:border-yopey-primary"
          }`}
        />
        <p className="mt-1 text-xs text-gray-500">
          So we can send tips and follow-ups
        </p>
      </div>

      <div>
        <label htmlFor="postcode" className="block text-sm font-semibold text-gray-700 mb-1">
          Postcode
        </label>
        <input
          id="postcode"
          type="text"
          autoComplete="postal-code"
          required
          maxLength={10}
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          placeholder="W13 8RB"
          aria-invalid={postcodeInvalid}
          className={`w-full px-4 py-3 rounded-xl border-2 uppercase focus:outline-none focus:ring-0 transition ${
            postcodeInvalid
              ? "border-red-400 focus:border-red-500"
              : "border-gray-200 focus:border-yopey-primary"
          }`}
        />
        <p className="mt-1 text-xs text-gray-500">
          Your home or school postcode — to find care homes nearby
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full px-6 py-4 rounded-2xl bg-yopey-primary text-white font-semibold shadow-md hover:bg-yopey-primaryDark transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed min-h-[52px]"
      >
        {submitting ? "Setting up..." : "Find care homes →"}
      </button>

      <p className="text-xs text-gray-500 text-center">
        By continuing you agree we can store this information and chat history.
      </p>
    </form>
  );
}
