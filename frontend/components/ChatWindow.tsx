"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import MessageBubble from "@/components/MessageBubble";
import TypingIndicator from "@/components/TypingIndicator";
import ChatInput from "@/components/ChatInput";
import HelpResources from "@/components/HelpResources";
import YbMark from "@/components/YbMark";
import { consumeInitialChat, fetchUser, sendMessage } from "@/lib/api";
import { userStorage, type StoredUser } from "@/lib/storage";
import { useIsEmbedded } from "@/lib/embed";

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
  // "init" until the load effect decides; "choosing" shows the three options
  // at the start; "active" once a choice is made or a message is sent.
  const [phase, setPhase] = useState<"init" | "choosing" | "active">("init");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Inside the embeddable widget the host panel supplies its own title bar, so
  // we drop our page header to avoid a double chrome.
  const embedded = useIsEmbedded();

  // Guard against React 18 StrictMode double-invoke + general
  // belt-and-braces against effect re-runs.
  const initFiredRef = useRef(false);

  // Run one of the three actions. Shared by the ?intent= deep links (set by the
  // landing-page buttons) and the in-chat chooser, so "after choosing, it
  // continues" is literally the same code path the landing page uses.
  async function runIntent(which: "search" | "advice" | "report", u: StoredUser) {
    setPhase("active");

    if (which === "report") {
      setMessages([
        {
          role: "assistant",
          content: `Hi ${u.first_name}. Paste your visit-report draft below and I'll help you polish it. If you haven't written anything yet, just tell me what happened on the visit.`,
        },
      ]);
      return;
    }

    if (which === "advice") {
      setMessages([
        {
          role: "assistant",
          content: `Hi ${u.first_name}. What would you like advice on? For example: tips for your first visit, what to say to a resident, or trying another care home.`,
        },
      ]);
      return;
    }

    // which === "search"
    if (!u.postcode) {
      setMessages([
        {
          role: "assistant",
          content: `Hey ${u.first_name}! What's your postcode? I'll find care homes near you.`,
        },
      ]);
      return;
    }
    const near =
      u.search_preference === "school"
        ? "your school"
        : u.search_preference === "home"
        ? "your home"
        : "you";
    setMessages([
      {
        role: "assistant",
        content: `Hey ${u.first_name}! Let me find care homes near ${near} (${u.postcode})...`,
      },
    ]);
    setPending(true);
    try {
      // Reuse a preloaded promise if OnboardForm fired the search at submit
      // time — the LLM has been processing during navigation, so the reply is
      // often already in by the time they tap "Find a care home".
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
  }

  // Load stored user — if missing, send to /onboard. A landing-page button may
  // deep-link with ?intent=search|advice|report, which we run straight away.
  // Otherwise (the normal entry after the questionnaire) we present the three
  // choices first and let them pick — we no longer auto-search on open.
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

      // Landing-page buttons deep-link with an intent — honour it directly.
      if (intent === "search" || intent === "advice" || intent === "report") {
        await runIntent(intent, u);
        return;
      }

      // Normal entry (just finished the questionnaire, or opened /chat with no
      // intent): greet, then offer the three options and continue once picked.
      if (u.postcode) {
        setMessages([
          {
            role: "assistant",
            content: `Hi ${u.first_name}! What would you like to do?`,
          },
        ]);
        setPhase("choosing");
      } else {
        setMessages([
          {
            role: "assistant",
            content: `Hey ${u.first_name}! What's your postcode? I'll find care homes near you.`,
          },
        ]);
        setPhase("active");
      }
    })();
  }, [router, intent]);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  // Shared send path used by both the text input and the quick-action chips.
  async function send(text: string) {
    if (!user || pending) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    // Any sent message means they've started — dismiss the opening chooser.
    setPhase("active");
    setError(null);
    setMessages((m) => [...m, { role: "user", content: trimmed }]);
    setPending(true);

    try {
      const reply = await sendMessage(user.user_id, trimmed);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (err: any) {
      setError(err.message || "Something went wrong sending your message.");
      // Roll back: keep the user message so they can retry by editing
    } finally {
      setPending(false);
    }
  }

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    send(text);
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
            <Link href="/" className="flex items-center gap-2">
              <YbMark size={30} />
              <span className="flex items-baseline gap-1.5">
                <span className="font-extrabold text-lg text-yopey-primary tracking-wide">YOPEY</span>
                <span className="text-base text-yopey-primary/80 italic">Befriender</span>
              </span>
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
          {phase === "choosing" && user && (
            <div className="pt-1 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => runIntent("search", user)}
                className="inline-flex items-center justify-center px-6 py-4 rounded-2xl bg-yopey-primary text-white font-semibold shadow-lg shadow-yopey-primary/30 hover:opacity-90 transition active:scale-[0.98] min-h-[52px]"
              >
                Find a care home →
              </button>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => runIntent("advice", user)}
                  className="flex-1 inline-flex items-center justify-center px-5 py-4 rounded-2xl border-2 border-yopey-primary/30 text-yopey-primary font-semibold hover:bg-yopey-primary/10 transition min-h-[52px]"
                >
                  Ask for advice
                </button>
                <button
                  type="button"
                  onClick={() => runIntent("report", user)}
                  className="flex-1 inline-flex items-center justify-center px-5 py-4 rounded-2xl border-2 border-yopey-primary/30 text-yopey-primary font-semibold hover:bg-yopey-primary/10 transition min-h-[52px]"
                >
                  Polish a visit report
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 bg-white border-t border-gray-100 px-4 md:px-6 py-3 safe-bottom">
        <div className="max-w-3xl mx-auto">
          {phase === "active" && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-1 -mx-1 px-1">
              <button
                type="button"
                disabled={pending}
                onClick={() => send("Please find me another care home near my postcode.")}
                className="shrink-0 whitespace-nowrap px-3 py-2 rounded-full border-2 border-yopey-primary/30 text-yopey-primary text-sm font-semibold hover:bg-yopey-primary/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Find another care home
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => send("Can I get some advice about volunteering as a befriender?")}
                className="shrink-0 whitespace-nowrap px-3 py-2 rounded-full border-2 border-yopey-primary/30 text-yopey-primary text-sm font-semibold hover:bg-yopey-primary/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Ask for advice
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => send("I'd like help polishing a visit report.")}
                className="shrink-0 whitespace-nowrap px-3 py-2 rounded-full border-2 border-yopey-primary/30 text-yopey-primary text-sm font-semibold hover:bg-yopey-primary/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Polish a visit report
              </button>
            </div>
          )}
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            disabled={pending}
          />
          <HelpResources />
          <p className="text-[11px] text-gray-400 text-center mt-2 px-2">
            Need to change something? Just tell me — e.g.{" "}
            <em>&quot;use my home postcode instead&quot;</em>.
          </p>
        </div>
      </div>
    </div>
  );
}
