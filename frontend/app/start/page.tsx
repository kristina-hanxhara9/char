import { Suspense } from "react";
import StartScreen from "@/components/StartScreen";
import FunnelHeader from "@/components/FunnelHeader";

// Funnel entry. With no intent it shows the three options (what the widget
// bubble opens to); ?intent=advice|report renders the quick sign-in.
// "Find a care home" still goes through the full /onboard wizard.
export default function StartPage() {
  return (
    <main className="min-h-screen flex flex-col safe-top safe-bottom">
      <FunnelHeader />

      <section className="flex-1 px-6 md:px-10 flex items-center justify-center">
        <Suspense fallback={null}>
          <StartScreen />
        </Suspense>
      </section>

      <footer className="px-6 py-5 md:px-10 text-center text-xs text-gray-500">
        Registered charity 1145573
      </footer>
    </main>
  );
}
