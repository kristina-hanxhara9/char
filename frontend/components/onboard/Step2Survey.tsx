"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { SurveyAnswers } from "@/lib/api";

export type SurveyData = Partial<SurveyAnswers>;

export const emptySurvey: SurveyData = {};

const QUESTIONS: { key: keyof SurveyAnswers; text: string }[] = [
  { key: "q1_afraid", text: "I am afraid of people with ADRD." },
  { key: "q2_confident", text: "I feel confident around people with ADRD." },
  { key: "q3_comfortable_touching", text: "I am comfortable touching people with ADRD." },
  { key: "q4_uncomfortable", text: "I feel uncomfortable being around people with ADRD." },
  { key: "q5_different_needs", text: "Every person with ADRD has different needs." },
  { key: "q6_past_history", text: "It is important to know the past history of people with ADRD." },
  { key: "q7_relaxed", text: "I feel relaxed around people with ADRD." },
  { key: "q8_feel_kindness", text: "People with ADRD can feel when others are kind to them." },
  { key: "q9_frustrated", text: "I feel frustrated because I do not know how to help people with ADRD." },
  {
    key: "q10_difficult_behaviour",
    text: "Difficult behaviours may be a form of communication for people with ADRD.",
  },
];

type Props = {
  data: SurveyData;
  setData: Dispatch<SetStateAction<SurveyData>>;
  onNext: () => void;
  onBack: () => void;
};

export default function Step2Survey({ data, setData, onNext, onBack }: Props) {
  const [touched, setTouched] = useState(false);

  const allAnswered = QUESTIONS.every((q) => typeof data[q.key] === "number");

  function setAnswer(key: keyof SurveyAnswers, value: number) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function handleNext() {
    setTouched(true);
    if (allAnswered) onNext();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-yopey-accent/15 border border-yopey-accent/30 p-4">
        <p className="font-semibold text-yopey-ink mb-1">Quick survey before you start</p>
        <p className="text-sm text-gray-700 leading-relaxed">
          YOPEY uses this short survey to understand how being a befriender changes you.
          You&apos;ll do it again at the end of your YOPEY journey. There are no right or
          wrong answers — please be honest.
        </p>
        <p className="text-sm text-gray-600 mt-2">
          <strong>Scale:</strong> 1 = Strongly Disagree · 4 = Neutral · 7 = Strongly Agree
        </p>
        <p className="text-xs text-gray-500 mt-2">
          ADRD = Alzheimer&apos;s Disease and Related Dementias
        </p>
      </div>

      {QUESTIONS.map((q, idx) => {
        const current = data[q.key];
        const answered = typeof current === "number";
        return (
          <div
            key={q.key}
            className={`rounded-2xl border p-4 transition ${
              answered ? "border-gray-200 bg-white" : "border-gray-200 bg-white"
            }`}
          >
            <p className="text-[15px] text-gray-800 leading-snug mb-3">
              <span className="font-semibold text-yopey-primary mr-1.5">{idx + 1}.</span>
              {q.text}
            </p>
            <div className="grid grid-cols-7 gap-1.5" role="radiogroup" aria-label={q.text}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                const selected = current === n;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setAnswer(q.key, n)}
                    className={`min-h-[44px] rounded-xl font-semibold text-sm transition border-2 ${
                      selected
                        ? "bg-yopey-primary text-white border-yopey-primary"
                        : "bg-white text-gray-700 border-gray-200 hover:border-yopey-primary"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between text-[11px] text-gray-500 mt-1 px-1">
              <span>Disagree</span>
              <span>Neutral</span>
              <span>Agree</span>
            </div>
          </div>
        );
      })}

      {touched && !allAnswered && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3">
          Please answer all 10 questions before continuing.
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 px-5 py-4 rounded-2xl border-2 border-gray-200 text-gray-700 font-semibold hover:border-yopey-primary transition min-h-[52px]"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!allAnswered}
          className="flex-[2] px-6 py-4 rounded-2xl bg-yopey-primary text-white font-semibold shadow-md hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed min-h-[52px]"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
