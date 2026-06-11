"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onboard, pingBackend, preloadInitialChat, submitSurvey, type SurveyAnswers } from "@/lib/api";
import { userStorage } from "@/lib/storage";
import Step1Personal, { emptyPersonal, type PersonalData } from "@/components/onboard/Step1Personal";
import Step2Survey, { emptySurvey, type SurveyData } from "@/components/onboard/Step2Survey";
import Step3Consent from "@/components/onboard/Step3Consent";

type Step = 1 | 2 | 3;

export default function OnboardForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utmSource = searchParams.get("utm_source") || undefined;

  const [step, setStep] = useState<Step>(1);
  const [personal, setPersonal] = useState<PersonalData>(emptyPersonal);
  const [survey, setSurvey] = useState<SurveyData>(emptySurvey);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The school postcode is geocoded in the background WHILE the user fills
  // the survey. This promise is stored from Step 1's onNext and awaited on
  // Step 3 submit. For home-search it resolves immediately.
  const [postcodePromise, setPostcodePromise] = useState<Promise<string> | null>(null);
  const [schoolError, setSchoolError] = useState<string | null>(null);

  // Render's free tier sleeps when idle; waking it takes ~1 min. Ping as soon
  // as the form opens so the Step-1 precompute (and chat) find it warm.
  useEffect(() => {
    pingBackend();
  }, []);

  async function handleFinalSubmit(consented: boolean) {
    if (!consented) {
      setError("Please tick the consent box to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);

    // Resolve the school postcode if we're searching near school.
    // If the user filled the survey fast and geocoding's still running, we
    // wait here — usually 0-5s since geocoding started ~30s+ ago at Step 1.
    let resolvedSchoolPostcode: string | undefined;
    if (personal.searchPreference === "school" && postcodePromise) {
      try {
        resolvedSchoolPostcode = await postcodePromise;
      } catch (err: any) {
        // School wasn't findable — bounce back to Step 1 with the error.
        setSchoolError(
          err.message ||
            "We couldn't find your school. Go back and check the spelling, or pick 'Near home' instead."
        );
        setStep(1);
        setSubmitting(false);
        return;
      }
    }

    try {
      const ageNum = parseInt(personal.ageStr, 10);
      const onboardRes = await onboard({
        first_name: personal.firstName.trim(),
        surname: personal.surname.trim(),
        age: ageNum,
        email: personal.email.trim(),
        phone: personal.phone.trim(),
        home_postcode: personal.homePostcode.trim().toUpperCase(),
        is_student: personal.isStudent ?? false,
        school_name: personal.isStudent ? personal.schoolName.trim() : undefined,
        // Pre-resolved client-side so backend doesn't re-geocode
        school_postcode: resolvedSchoolPostcode,
        search_preference: personal.searchPreference ?? "home",
        utm_source: utmSource,
      });

      // Survey is required — every field is set after Step 2.
      await submitSurvey(
        onboardRes.user_id,
        onboardRes.user_token,
        survey as SurveyAnswers,
        "pre"
      );

      userStorage.set({
        user_id: onboardRes.user_id,
        user_token: onboardRes.user_token,
        first_name: onboardRes.first_name,
        postcode: onboardRes.postcode || undefined,
        is_student: personal.isStudent ?? false,
        search_preference: personal.searchPreference ?? "home",
      });

      // Fire the auto-search NOW (in the background) so the LLM is processing
      // while the user navigates. ChatWindow awaits the same promise and
      // renders the reply when it arrives — typically already done by the
      // time /chat is fully painted.
      if (onboardRes.postcode) {
        preloadInitialChat(onboardRes.user_id, onboardRes.postcode);
      }

      router.push("/chat");
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-yopey-primary/20 p-6 md:p-8 space-y-5"
    >
      <div>
        <div className="flex items-center gap-2 mb-3" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-2 flex-1 rounded-full transition ${
                n <= step ? "bg-yopey-primary" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-yopey-ink">
          {step === 1 && "About you"}
          {step === 2 && "A quick survey"}
          {step === 3 && "Almost there"}
        </h1>
        <p className="mt-1 text-gray-600 text-sm">
          {step === 1 && "We'll find care homes within walking distance once we know where you are."}
          {step === 2 && "Ten quick questions — won't take more than a couple of minutes."}
          {step === 3 && "One last check, then we'll find care homes near you."}
        </p>
      </div>

      {step === 1 && (
        <Step1Personal
          data={personal}
          setData={setPersonal}
          externalSchoolError={schoolError}
          onNext={(promise) => {
            setPostcodePromise(promise);
            setSchoolError(null);
            setStep(2);
          }}
        />
      )}

      {step === 2 && (
        <Step2Survey
          data={survey}
          setData={setSurvey}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && (
        <Step3Consent
          submitting={submitting}
          error={error}
          onSubmit={handleFinalSubmit}
          onBack={() => setStep(2)}
        />
      )}
    </form>
  );
}
