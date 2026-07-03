"use client";

import { useRef, useState } from "react";
import MessageBubble from "@/components/MessageBubble";
import { askGuide, type GuideMessage } from "@/lib/api";

// Suggested prompts. A single tap fills common needs (summarise, access, fix).
const SUGGESTIONS = [
  "Summarise this guide in a few lines",
  "How do I access the agent?",
  "Where do the care homes come from?",
  "How do I fix a wrong answer?",
  "What can the agent not help with?",
];

export default function GuideAssistant() {
  const [messages, setMessages] = useState<GuideMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm the guide helper. Ask me anything about how this agent works. " +
        "I can **summarise** sections, explain how to use it, or point you to the " +
        "right part. Try a suggestion below.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    // Wait a tick for the new bubble to render.
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  async function send(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setError(null);
    setInput("");
    const priorHistory = messages;
    setMessages((m) => [...m, { role: "user", content: q }]);
    scrollToBottom();
    setLoading(true);
    try {
      // Send the conversation up to (but not including) this question.
      const answer = await askGuide(q, priorHistory);
      setMessages((m) => [...m, { role: "assistant", content: answer }]);
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
      <div className="bg-yopey-accent px-4 py-3 flex items-center gap-2">
        <span aria-hidden className="text-lg">💬</span>
        <div>
          <div className="font-semibold text-yopey-primary text-sm">Ask the guide</div>
          <div className="text-[11px] text-yopey-primary/70">
            Answers only from this page, no personal data.
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="px-3 py-3 space-y-3 overflow-y-auto"
        style={{ maxHeight: "22rem", minHeight: "10rem" }}
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content} />
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-md px-4 py-2.5 text-gray-400 text-sm shadow-sm">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Suggestion chips */}
      <div className="flex gap-2 overflow-x-auto px-3 pb-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => send(s)}
            disabled={loading}
            className="whitespace-nowrap text-xs px-3 py-1.5 rounded-full bg-yopey-accent/40 text-yopey-primary border border-yopey-accent hover:bg-yopey-accent/70 transition disabled:opacity-50 min-h-[32px]"
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-3 mb-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-gray-100 p-2.5"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about the guide…"
          className="flex-1 text-[16px] px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-yopey-primary min-h-[44px]"
          aria-label="Ask the guide a question"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2 rounded-xl bg-yopey-primary text-white font-semibold text-sm disabled:opacity-50 min-h-[44px]"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
