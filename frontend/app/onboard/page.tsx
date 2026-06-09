import { Suspense } from "react";
import Link from "next/link";
import OnboardForm from "@/components/OnboardForm";

export default function OnboardPage() {
  return (
    <main className="min-h-screen flex flex-col safe-top safe-bottom">
      <header className="bg-yopey-accent px-6 py-5 md:px-10 md:py-6">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-extrabold text-2xl text-yopey-primaryDark tracking-wide">YOPEY</span>
            <span className="text-lg text-yopey-primaryDark/80 italic">Befriender</span>
          </Link>
          <Link href="/" className="text-sm text-yopey-primaryDark hover:text-yopey-primary font-semibold">
            ← Back
          </Link>
        </div>
      </header>

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
