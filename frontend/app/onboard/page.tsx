import { Suspense } from "react";
import Link from "next/link";
import OnboardForm from "@/components/OnboardForm";

export default function OnboardPage() {
  return (
    <main className="min-h-screen flex flex-col safe-top safe-bottom">
      <header className="px-6 py-5 md:px-10 md:py-6">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <Link href="/" className="font-bold text-xl text-yopey-primaryDark">
            YOPEY
          </Link>
          <Link href="/" className="text-sm text-gray-500 hover:text-yopey-primary">
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
