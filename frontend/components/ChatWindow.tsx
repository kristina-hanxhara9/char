"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import MessageBubble from "@/components/MessageBubble";
import TypingIndicator from "@/components/TypingIndicator";
import ChatInput from "@/components/ChatInput";
import { consumeInitialChat, fetchUser, sendMessage } from "@/lib/api";
import { userStorage, type StoredUser } from "@/lib/storage";
import { useIsEmbedded } from "@/lib/embed";

// Tracks whether we've already auto-searched for this user in this browser
// session. Survives refreshes within the same tab, resets in a new tab —
// which is the right cadence: don't re-spend a search per refresh, but DO
// search again if the teen comes back tomorrow.
function hasAlreadyAutoSearched(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(`yopey_autosearched_${userId}`) === "1";
  } catch {
    return false;
  }
}

function markAutoSearched(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(`yopey_autosearched_${userId}`, "1");
  } catch {
    /* sessionStorage blocked (e.g. Safari private mode) — accept the cost */
  }
}

function clearAutoSearched(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(`yopey_autosearched_${userId}`);
  } catch {
    /* ignore */
  }
}

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatWindow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // intent set by returning-user buttons: 'search' | 'advice' | 'report'
  const intent = searchParams.get("intent");
  const [user, setUser] = useState<StoredUser | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Inside the embeddable widget the host panel supplies its own title bar, so
  // we drop our page header to avoid a double chrome.
  const embedded = useIsEmbedded();

  // Guard against React 18 StrictMode double-invoke + general
  // belt-and-braces against effect re-runs.
  const initFiredRef = useRef(false);

  // Load stored user — if missing, send to /onboard.
  // If postcode is on file AND we haven't already auto-searched this session,
  // kick off an automatic care-home search so the teen lands on a real result
  // instead of a question. Refreshes / re-mounts within the same session reuse
  // the prior search (no fresh LLM call, no history pollution).
  useEffect(() => {
    if (initFiredRef.current) return;
    initFiredRef.current = true;

    const stored = userStorage.get();
    if (!stored) {
      router.replace("/onboard");
      return;
    }

    (async () => {
      // Pull the canonical user record from the server so any changes made
      // mid-chat (bot updating postcode/email via save_user_details, Tony
      // updating from the dashboard, etc.) are reflected on this device.
      let u: StoredUser = stored;
      try {
        const fresh = await fetchUser(stored.user_id, stored.user_token);
        u = {
          user_id: fresh.user_id,
          user_token: stored.user_token,
          first_name: fresh.first_name,
          postcode: fresh.postcode || undefined,
          is_student: stored.is_student,
          search_preference: stored.search_preference,
        };
        userStorage.set(u);
      } catch {
        // Server fetch failed (offline, expired token, server down) — carry on with localStorage
      }
      setUser(u);

      // ── Returning-user intents (set by the landing-page buttons) ──
      // These open the chat for a specific purpose and DO NOT auto-search.
      if (intent === "report") {
        setMessages([
          {
            role: "assistant",
            content: `Hi ${u.first_name}. Paste your visit-report draft below and I'll help you polish it. If you haven't written anything yet, just tell me what happened on the visit.`,
          },
        ]);
        return;
      }
      if (intent === "advice") {
        setMessages([
          {
            role: "assistant",
            content: `Hi ${u.first_name}. What would you like advice on? For example: tips for your first visit, what to say to a resident, or trying another care home.`,
          },
        ]);
        return;
      }

      // intent=search forces a fresh care-home search even if one already ran
      // this session (returning user explicitly wants another home).
      if (intent === "search" && u.postcode) {
        clearAutoSearched(u.user_id);
      }

      const shouldAutoSearch =
        Boolean(u.postcode) && !hasAlreadyAutoSearched(u.user_id);

      if (shouldAutoSearch && u.postcode) {
        markAutoSearched(u.user_id);
        setMessages([
          {
            role: "assistant",
            content: `Hey ${u.first_name}! Let me find care homes near ${u.postcode}...`,
          },
        ]);
        setPending(true);
        try {
          // Reuse a preloaded promise if OnboardForm fired the auto-search
          // at submit time — that way the LLM has been processing while the
          // user navigated, and the reply is often already in.
          const preloaded = consumeInitialChat(u.user_id);
          const reply = await (preloaded ??
            sendMessage(
              u.user_id,
              `Please find me 5 care homes near my postcode ${u.postcode}.`
            ));
          setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        } catch (err: any) {
          setError(err.message || "Couldn't load care homes. Try sending a message.");
        } finally {
          setPending(false);
        }
      } else if (u.postcode) {
        setMessages([
          {
            role: "assistant",
            content: `Welcome back, ${u.first_name}! What would you like to do next?`,
          },
        ]);
      } else {
        setMessages([
          {
            role: "assistant",
            content: `Hey ${u.first_name}! What's your postcode? I'll find care homes near you.`,
          },
        ]);
      }
    })();
  }, [router, intent]);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  async function handleSend() {
    if (!user) return;
    const text = input.trim();
    if (!text) return;

    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setPending(true);

    try {
      const reply = await sendMessage(user.user_id, text);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (err: any) {
      setError(err.message || "Something went wrong sending your message.");
      // Roll back: keep the user message so they can retry by editing
    } finally {
      setPending(false);
    }
  }

  function handleEndChat() {
    if (
      confirm(
        "Start over from the beginning? This signs you out on this device and " +
          "takes you back to the form so you can redo your details. Your account " +
          "and chat history stay saved in YOPEY's system (delete them at /privacy)."
      )
    ) {
      // Clear the per-session auto-search flag too so the next user (or the same
      // user with a different postcode) gets a fresh search instead of the
      // "Welcome back" greeting.
      if (user && typeof window !== "undefined") {
        try {
          sessionStorage.removeItem(`yopey_autosearched_${user.user_id}`);
        } catch {
          /* ignore */
        }
      }
      userStorage.clear();
      router.push("/onboard");
    }
  }

  if (!user) {
    return (
      <div className="h-screen grid place-items-center text-gray-500">Loading...</div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {!embedded && (
        <header className="shrink-0 bg-yopey-accent px-4 md:px-6 py-3 safe-top">
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            <Link href="/" className="flex items-baseline gap-1.5">
              <span className="font-extrabold text-lg text-yopey-primary tracking-wide">YOPEY</span>
              <span className="text-base text-yopey-primary/80 italic">Befriender</span>
            </Link>
            <div className="flex items-center gap-1">
              <Link
                href="/privacy"
                className="text-sm text-yopey-primary hover:bg-white/30 font-semibold px-3 py-1.5 rounded-lg min-h-[44px] grid place-items-center"
              >
                Privacy
              </Link>
              <button
                type="button"
                onClick={handleEndChat}
                className="text-sm text-yopey-primary hover:bg-white/30 font-semibold px-3 py-1.5 rounded-lg min-h-[44px] min-w-[44px]"
                title="Sign out and redo the form"
              >
                Start over
              </button>
            </div>
          </div>
        </header>
      )}

      <div
        ref={scrollRef}
        className="chat-scroll flex-1 overflow-y-auto px-4 md:px-6 py-4 bg-white"
      >
        <div className="max-w-3xl mx-auto space-y-3">
          {messages.map((m, i) => (
            <MessageBubble key={i} role={m.role} content={m.content} />
          ))}
          {pending && <TypingIndicator />}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 max-w-3xl mx-auto">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 bg-white border-t border-gray-100 px-4 md:px-6 py-3 safe-bottom">
        <div className="max-w-3xl mx-auto">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            disabled={pending}
          />
          <p className="text-[11px] text-gray-400 text-center mt-2 px-2">
            Need to change something? Just tell me — e.g.{" "}
            <em>&quot;use my home postcode instead&quot;</em>.
          </p>
        </div>
      </div>
    </div>
  );
}
