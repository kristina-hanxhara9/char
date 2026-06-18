"use client";

import { useState } from "react";

/**
 * Native chat-widget bubble for YOPEY's own site (the homepage). It renders the
 * launcher and an iframe of the onboarding/chat flow directly in the React
 * tree, so it always appears when the page does — no external script, no inject
 * timing, nothing to 404. (The vanilla public/widget.js loader is the separate
 * path for embedding on third-party websites.)
 *
 * The iframe is mounted on first open and kept alive (hidden when closed) so
 * reopening preserves the conversation.
 */
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  function openPanel() {
    setMounted(true);
    setOpen(true);
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={openPanel}
          aria-label="Find a care home"
          className="fixed bottom-5 right-5 z-[2147483000] flex items-center gap-2 rounded-full bg-yopey-accent text-yopey-ink font-semibold px-5 py-3.5 shadow-lg hover:-translate-y-0.5 transition active:scale-95"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
            <path
              d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="hidden sm:inline">Find a care home</span>
        </button>
      )}

      {mounted && (
        <div
          role="dialog"
          aria-label="YOPEY Befriender"
          className={`fixed z-[2147483001] flex-col bg-white shadow-2xl overflow-hidden inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[400px] sm:h-[640px] sm:max-h-[calc(100vh-2.5rem)] sm:rounded-2xl ${
            open ? "flex" : "hidden"
          }`}
        >
          <div className="flex items-center justify-between px-4 py-2.5 bg-yopey-accent text-yopey-ink shrink-0">
            <span className="flex items-baseline gap-1.5">
              <span className="font-extrabold tracking-wide">YOPEY</span>
              <span className="italic opacity-75 text-sm">Befriender</span>
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="w-8 h-8 grid place-items-center rounded-lg hover:bg-black/10 text-lg leading-none"
            >
              ✕
            </button>
          </div>
          <iframe
            title="YOPEY Befriender chat"
            src="/start?embed=1"
            className="flex-1 w-full border-0"
          />
        </div>
      )}
    </>
  );
}
