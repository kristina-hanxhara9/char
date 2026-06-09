"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { geocodeSchool, precomputeSearch } from "@/lib/api";

export type PersonalData = {
  firstName: string;
  surname: string;
  ageStr: string;
  email: string;
  phone: string;
  homePostcode: string;
  isStudent: boolean | null;
  schoolName: string;
  searchPreference: "home" | "school" | null;
};

export const emptyPersonal: PersonalData = {
  firstName: "",
  surname: "",
  ageStr: "",
  email: "",
  phone: "",
  homePostcode: "",
  isStudent: null,
  schoolName: "",
  searchPreference: null,
};

// Permissive UK postcode pattern (also accepts Girobank + BFPO).
// Authoritative validation happens server-side via postcodes.io.
const UK_POSTCODE_RE =
  /^(?:GIR\s*0AA|BFPO\s*\d{1,4}|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s()-]{5,18}$/;

type Props = {
  data: PersonalData;
  setData: Dispatch<SetStateAction<PersonalData>>;
  // We pass the eventual resolved postcode as a promise — for school-search
  // it's still in-flight (background geocoding), for home-search it
  // resolves immediately.
  onNext: (postcodePromise: Promise<string>) => void;
  // Surfaced from a prior failed submit that bounced the user back here.
  externalSchoolError?: string | null;
};

export default function Step1Personal({
  data,
  setData,
  onNext,
  externalSchoolError,
}: Props) {
  const [touched, setTouched] = useState(false);
  const [schoolError, setSchoolError] = useState<string | null>(externalSchoolError || null);

  const ageNum = parseInt(data.ageStr, 10);
  const ageInvalid =
    data.ageStr !== "" && (Number.isNaN(ageNum) || ageNum < 16 || ageNum > 120);
  const emailInvalid = data.email !== "" && !EMAIL_RE.test(data.email);
  const phoneInvalid = data.phone !== "" && !PHONE_RE.test(data.phone);
  const homePostcodeInvalid =
    data.homePostcode !== "" && !UK_POSTCODE_RE.test(data.homePostcode.trim());

  const canNext =
    data.firstName.trim().length > 0 &&
    data.surname.trim().length > 0 &&
    !Number.isNaN(ageNum) &&
    ageNum >= 16 &&
    ageNum <= 120 &&
    data.email.trim() !== "" &&
    !emailInvalid &&
    data.phone.trim() !== "" &&
    !phoneInvalid &&
    data.homePostcode.trim() !== "" &&
    !homePostcodeInvalid &&
    data.isStudent !== null &&
    (data.isStudent === false || data.schoolName.trim() !== "") &&
    data.searchPreference !== null;

  function set<K extends keyof PersonalData>(key: K, value: PersonalData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function handleNext() {
    setTouched(true);
    if (!canNext) return;

    // Wrap the postcode in a promise so the survey can open INSTANTLY while
    // school geocoding (3-15s) runs in the background. For home-search it's
    // already resolved.
    const postcodePromise: Promise<string> =
      data.isStudent === true &&
      data.searchPreference === "school" &&
      data.schoolName.trim().length > 1
        ? geocodeSchool(data.schoolName.trim()).then((r) => r.postcode)
        : Promise.resolve(data.homePostcode.trim().toUpperCase());

    // Pre-warm care home search cache as soon as we know the postcode.
    // Also background — by the time the teen hits /chat, it's cached.
    postcodePromise.then(precomputeSearch).catch(() => {});

    // Hand the promise to the parent and advance immediately.
    setSchoolError(null);
    onNext(postcodePromise);
  }

  function clearSchoolError() {
    if (schoolError) setSchoolError(null);
  }

  // When they toggle "I'm in education" the picker default snaps to school
  function setIsStudent(value: boolean) {
    setData((prev) => ({
      ...prev,
      isStudent: value,
      searchPreference: value ? "school" : "home",
    }));
  }

  return (
    <div className="space-y-4">
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
            value={data.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            placeholder="Sarah"
            className="w-full px-3 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none transition"
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
            value={data.surname}
            onChange={(e) => set("surname", e.target.value)}
            placeholder="Smith"
            className="w-full px-3 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none transition"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
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
            value={data.ageStr}
            onChange={(e) => set("ageStr", e.target.value)}
            placeholder="16"
            className={`w-full px-3 py-3 rounded-xl border-2 focus:outline-none transition ${
              ageInvalid
                ? "border-red-400 focus:border-red-500"
                : "border-gray-200 focus:border-yopey-primary"
            }`}
          />
          {ageInvalid ? (
            <p className="mt-1 text-sm text-red-600">Must be 16+.</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">For 16 and over</p>
          )}
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-semibold text-gray-700 mb-1">
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            required
            value={data.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="07..."
            className={`w-full px-3 py-3 rounded-xl border-2 focus:outline-none transition ${
              phoneInvalid
                ? "border-red-400 focus:border-red-500"
                : "border-gray-200 focus:border-yopey-primary"
            }`}
          />
          {phoneInvalid && (
            <p className="mt-1 text-sm text-red-600">Please enter a valid phone number.</p>
          )}
        </div>
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
          value={data.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="sarah@example.com"
          className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none transition ${
            emailInvalid
              ? "border-red-400 focus:border-red-500"
              : "border-gray-200 focus:border-yopey-primary"
          }`}
        />
        <p className="mt-1 text-xs text-gray-500">So we can send you reminders + tips</p>
      </div>

      <div>
        <label htmlFor="homePostcode" className="block text-sm font-semibold text-gray-700 mb-1">
          Home postcode
        </label>
        <input
          id="homePostcode"
          type="text"
          autoComplete="postal-code"
          required
          maxLength={10}
          value={data.homePostcode}
          onChange={(e) => set("homePostcode", e.target.value)}
          placeholder="W13 8RB"
          className={`w-full px-4 py-3 rounded-xl border-2 uppercase focus:outline-none transition ${
            homePostcodeInvalid
              ? "border-red-400 focus:border-red-500"
              : "border-gray-200 focus:border-yopey-primary"
          }`}
        />
        {homePostcodeInvalid && (
          <p className="mt-1 text-sm text-red-600">That doesn&apos;t look like a UK postcode.</p>
        )}
      </div>

      <fieldset>
        <legend className="block text-sm font-semibold text-gray-700 mb-2">
          Are you at school, college or university?
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setIsStudent(true)}
            className={`px-4 py-3 rounded-xl border-2 font-semibold transition ${
              data.isStudent === true
                ? "border-yopey-primary bg-yopey-accent/15 text-yopey-primary"
                : "border-gray-200 text-gray-700 hover:border-yopey-primary"
            }`}
          >
            Yes, I&apos;m studying
          </button>
          <button
            type="button"
            onClick={() => setIsStudent(false)}
            className={`px-4 py-3 rounded-xl border-2 font-semibold transition ${
              data.isStudent === false
                ? "border-yopey-primary bg-yopey-accent/15 text-yopey-primary"
                : "border-gray-200 text-gray-700 hover:border-yopey-primary"
            }`}
          >
            No, not right now
          </button>
        </div>
      </fieldset>

      {data.isStudent === true && (
        <div className="space-y-3 p-4 rounded-2xl bg-yopey-accent/15 border border-yopey-accent/30">
          <div>
            <label htmlFor="schoolName" className="block text-sm font-semibold text-gray-700 mb-1">
              School / college / university name
            </label>
            <input
              id="schoolName"
              type="text"
              value={data.schoolName}
              onChange={(e) => {
                set("schoolName", e.target.value);
                clearSchoolError();
              }}
              placeholder="University of Liverpool"
              className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none transition ${
                schoolError
                  ? "border-red-400 focus:border-red-500"
                  : "border-gray-200 focus:border-yopey-primary"
              }`}
            />
            {schoolError ? (
              <p className="mt-1 text-sm text-red-600">{schoolError}</p>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                We&apos;ll find the postcode for you — no need to look it up.
              </p>
            )}
          </div>

          <fieldset>
            <legend className="block text-sm font-semibold text-gray-700 mb-2">
              Where should I look for care homes?
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => set("searchPreference", "school")}
                className={`px-3 py-3 rounded-xl border-2 text-sm font-semibold transition ${
                  data.searchPreference === "school"
                    ? "border-yopey-primary bg-white text-yopey-primary"
                    : "border-gray-200 text-gray-700 hover:border-yopey-primary bg-white"
                }`}
              >
                Near my school
              </button>
              <button
                type="button"
                onClick={() => set("searchPreference", "home")}
                className={`px-3 py-3 rounded-xl border-2 text-sm font-semibold transition ${
                  data.searchPreference === "home"
                    ? "border-yopey-primary bg-white text-yopey-primary"
                    : "border-gray-200 text-gray-700 hover:border-yopey-primary bg-white"
                }`}
              >
                Near home
              </button>
            </div>
          </fieldset>
        </div>
      )}

      {touched && !canNext && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3">
          Please fill in all the fields above before continuing.
        </div>
      )}

      <button
        type="button"
        onClick={handleNext}
        disabled={!canNext}
        className="w-full px-6 py-4 rounded-2xl bg-yopey-primary text-white font-semibold shadow-md hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed min-h-[52px]"
      >
        Continue →
      </button>
    </div>
  );
}
