"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MessageBubble from "@/components/MessageBubble";
import TypingIndicator from "@/components/TypingIndicator";
import ChatInput from "@/components/ChatInput";
import { sendMessage } from "@/lib/api";
import { userStorage, type StoredUser } from "@/lib/storage";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatWindow() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load stored user — if missing, send to /onboard.
  // If postcode is already on file, kick off an automatic care-home search so
  // the teen lands on a real result instead of a question.
  useEffect(() => {
    const u = userStorage.get();
    if (!u) {
      router.replace("/onboard");
      return;
    }
    setUser(u);

    if (u.postcode) {
      setMessages([
        {
          role: "assistant",
          content: `Hey ${u.first_name}! Let me find care homes near ${u.postcode}...`,
        },
      ]);
      // Fire a hidden user message so the bot calls search_care_homes
      (async () => {
        setPending(true);
        try {
          const reply = await sendMessage(
            u.user_id,
            `Please find me 5 care homes near my postcode ${u.postcode}.`
          );
          setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        } catch (err: any) {
          setError(err.message || "Couldn't load care homes. Try sending a message.");
        } finally {
          setPending(false);
        }
      })();
    } else {
      setMessages([
        {
          role: "assistant",
          content: `Hey ${u.first_name}! What's your postcode? I'll find care homes near you.`,
        },
      ]);
    }
  }, [router]);

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
    if (confirm("Start a new chat? Your current chat history will stay saved.")) {
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
      <header className="shrink-0 px-4 md:px-6 py-3 bg-white border-b border-gray-100 safe-top">
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <Link href="/" className="font-bold text-lg text-yopey-primaryDark">
            YOPEY
          </Link>
          <button
            type="button"
            onClick={handleEndChat}
            className="text-sm text-gray-500 hover:text-yopey-primary px-3 py-1.5 rounded-lg min-h-[44px] min-w-[44px]"
          >
            New chat
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="chat-scroll flex-1 overflow-y-auto px-4 md:px-6 py-4 bg-yopey-bg"
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
        </div>
      </div>
    </div>
  );
}
