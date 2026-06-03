"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
};

export default function ChatInput({ value, onChange, onSend, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the textarea up to a reasonable max height
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSend();
    }
  }

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Type a message..."
        rows={1}
        disabled={disabled}
        className="flex-1 resize-none px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-yopey-primary focus:outline-none focus:ring-0 bg-white disabled:opacity-60 transition leading-snug"
      />
      <button
        type="button"
        onClick={onSend}
        disabled={!canSend}
        aria-label="Send message"
        className="shrink-0 w-12 h-12 rounded-2xl bg-yopey-primary text-white grid place-items-center shadow-md hover:bg-yopey-primaryDark transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  );
}
