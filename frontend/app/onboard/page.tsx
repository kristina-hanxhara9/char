import { Suspense } from "react";
import OnboardForm from "@/components/OnboardForm";
import FunnelHeader from "@/components/FunnelHeader";

export default function OnboardPage() {
  return (
    <main className="min-h-screen flex flex-col safe-top safe-bottom">
      <FunnelHeader />

      <section className="flex-1 px-6 md:px-10 flex items-center justify-center">
        <Suspense fallback={null}>
          <OnboardForm />
        </Suspense>
      </section>

      <footer className="px-6 py-5 md:px-10 text-center text-xs text-gray-500">
        Registered charity 1145573
      </footer>
    </main>
  );
}
