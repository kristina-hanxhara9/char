"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { exchangeReturnToken } from "@/lib/api";
import { userStorage } from "@/lib/storage";

function ReturnInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("This link is missing its token. Please request a new one.");
      return;
    }
    (async () => {
      try {
        const u = await exchangeReturnToken(token);
        userStorage.set({
          user_id: u.user_id,
          user_token: u.user_token,
          first_name: u.first_name,
          postcode: u.postcode || undefined,
          is_student: u.is_student ?? undefined,
          search_preference: u.search_preference ?? undefined,
        });
        router.replace("/"); // land on the Welcome-back hub
      } catch (e: any) {
        setError(e.message || "This link didn't work. Please request a new one.");
      }
    })();
  }, [params, router]);

  return (
    <main className="min-h-screen grid place-items-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-yopey-primary/20 p-6 md:p-8 text-center">
        {error ? (
          <>
            <h1 className="text-xl font-extrabold text-yopey-ink mb-2">
              Link didn&apos;t work
            </h1>
            <p className="text-gray-600 text-sm mb-5">{error}</p>
            <Link
              href="/"
              className="inline-block px-6 py-3 rounded-2xl bg-yopey-primary text-white font-semibold hover:opacity-90 transition min-h-[48px]"
            >
              Back to start
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-extrabold text-yopey-ink mb-2">
              Signing you back in...
            </h1>
            <p className="text-gray-500 text-sm">One moment.</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function ReturnPage() {
  return (
    <Suspense fallback={null}>
      <ReturnInner />
    </Suspense>
  );
}
