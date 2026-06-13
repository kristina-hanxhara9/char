"use client";

import { useEffect, useState } from "react";

/**
 * True when the app is running inside the embeddable widget iframe.
 *
 * We detect the frame directly (window.self !== window.top) rather than
 * threading a query param through every internal navigation, so the
 * onboard → chat transition keeps working with zero plumbing. A cross-origin
 * security error when reading window.top also means we're framed. The
 * ?embed=1 hint the loader appends is a belt-and-braces fallback.
 */
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  return new URLSearchParams(window.location.search).has("embed");
}

/**
 * Client hook form. Returns false during SSR and the first client paint, then
 * resolves after mount — so the server and first client render agree (no
 * hydration mismatch); embedded chrome is hidden a tick later.
 */
export function useIsEmbedded(): boolean {
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => setEmbedded(isEmbedded()), []);
  return embedded;
}
