"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onboard } from "@/lib/api";
import { userStorage } from "@/lib/storage";

export default function OnboardForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utmSource = searchParams.get("utm_source") || undefined;

  const [firstName, setFirstName] = useState("");
  const [ageStr, setAgeStr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ageNum = parseInt(ageStr, 10);
  const ageInvalid = ageStr !== "" && (Number.isNaN(ageNum) || ageNum < 16 || ageNum > 120);

  const canSubmit =
    firstName.trim().length > 0 && !Number.isNaN(ageNum) && ageNum >= 16 && ageNum <= 120 && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (Number.isNaN(ageNum) || ageNum < 16) {
      setError("Sorry, you need to be at least 16 to use YOPEY Befriender.");
      return;
    }

    setSubmitting(true);
    try {
      const { user_id, first_name } = await onboard({
        first_name: firstName.trim(),
        age: ageNum,
        utm_source: utmSource,
      });
      userStorage.set({ user_id, first_name });
      router.push("/chat");
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-purple-100 p-6 md:p-8 space-y-5"
    >
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-yopey-ink">
          Let&apos;s get started
        </h1>
        <p className="mt-2 text-gray-600">
          Two quick questions, then you can start chatting.
        </p>
      </div>

      <div>
        <label htmlFor="firstName" className="block text-sm font-semibold text-gray-700 mb-1.5">
          What&apos;s your first name?
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
          className="w-full px-4 py-3.5 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none focus:ring-0 transition"
        />
      </div>

      <div>
        <label htmlFor="age" className="block text-sm font-semibold text-gray-700 mb-1.5">
          How old are you?
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
          className={`w-full px-4 py-3.5 rounded-xl border-2 focus:outline-none focus:ring-0 transition ${
            ageInvalid
              ? "border-red-400 focus:border-red-500"
              : "border-gray-200 focus:border-yopey-primary"
          }`}
        />
        {ageInvalid && (
          <p className="mt-1.5 text-sm text-red-600">
            Sorry, you need to be at least 16 to use YOPEY Befriender.
          </p>
        )}
        {!ageInvalid && (
          <p className="mt-1.5 text-xs text-gray-500">
            YOPEY Befriender is for young people aged 16 and over.
          </p>
        )}
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
        {submitting ? "Setting up your chat..." : "Start chatting →"}
      </button>

      <p className="text-xs text-gray-500 text-center">
        By continuing you agree we can store this information and chat history.
      </p>
    </form>
  );
}
