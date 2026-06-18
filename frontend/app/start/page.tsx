import { Suspense } from "react";
import QuickStartForm from "@/components/QuickStartForm";
import FunnelHeader from "@/components/FunnelHeader";

// Lightweight entry for the advice / visit-report routes (no questionnaire).
// "Find a care home" still goes through the full /onboard wizard.
export default function StartPage() {
  return (
    <main className="min-h-screen flex flex-col safe-top safe-bottom">
      <FunnelHeader />

      <section className="flex-1 px-6 md:px-10 flex items-center justify-center">
        <Suspense fallback={null}>
          <QuickStartForm />
        </Suspense>
      </section>

      <footer className="px-6 py-5 md:px-10 text-center text-xs text-gray-500">
        Registered charity 1145573
      </footer>
    </main>
  );
}
