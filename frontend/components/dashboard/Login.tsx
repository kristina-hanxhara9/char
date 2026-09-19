"use client";

import { useState, type FormEvent } from "react";
import { dashTokenStorage } from "@/lib/storage";
import { adminLogin, adminRegister, adminVerify } from "@/lib/api";

type Props = { onAuth: (token: string, email: string) => void };
type Mode = "signin" | "register" | "verify";

export default function DashboardLogin({ onAuth }: Props) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "signin") {
        const { token, email: who } = await adminLogin(email.trim(), password);
        dashTokenStorage.set(token);
        onAuth(token, who);
      } else if (mode === "register") {
        await adminRegister(email.trim(), password);
        setNotice(
          "We emailed a 6 digit code to your inbox. Enter it below to finish setting up your account."
        );
        setMode("verify");
      } else {
        const { token, email: who } = await adminVerify(email.trim(), code.trim());
        dashTokenStorage.set(token);
        onAuth(token, who);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const heading =
    mode === "signin" ? "Sign in" : mode === "register" ? "Create account" : "Enter your code";
  const cta = mode === "signin" ? "Sign in" : mode === "register" ? "Send me a code" : "Verify";

  return (
    <main className="min-h-screen grid place-items-center px-6 safe-top safe-bottom">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-yopey-primary/20 p-6 md:p-8 space-y-5"
      >
        <div>
          <h1 className="text-2xl font-extrabold text-yopey-ink">{heading}</h1>
          <p className="text-gray-600 text-sm mt-1">
            YOPEY coordinators only. Use your @yopey.org email.
          </p>
        </div>

        {mode !== "verify" && (
          <>
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yopey.org"
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={mode === "register" ? 10 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none"
              />
              {mode === "register" && (
                <p className="text-xs text-gray-500 mt-1.5">At least 10 characters.</p>
              )}
            </div>
          </>
        )}

        {mode === "verify" && (
          <div>
            <label htmlFor="code" className="block text-sm font-semibold text-gray-700 mb-1.5">
              6 digit code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none tracking-widest text-center text-lg"
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Sent to {email || "your email"}. It expires in 15 minutes.
            </p>
          </div>
        )}

        {notice && (
          <div className="rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3">
            {notice}
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-6 py-3.5 rounded-2xl bg-yopey-primary text-white font-semibold hover:opacity-90 transition disabled:opacity-50 min-h-[52px]"
        >
          {submitting ? "Please wait..." : cta}
        </button>

        <div className="text-sm text-center text-gray-600">
          {mode === "signin" ? (
            <button
              type="button"
              onClick={() => switchMode("register")}
              className="text-yopey-primary font-semibold hover:underline"
            >
              First time here? Create an account
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="text-yopey-primary font-semibold hover:underline"
            >
              Back to sign in
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
