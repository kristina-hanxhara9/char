"use client";

import { useEffect } from "react";

/**
 * Mounts the embeddable chat widget loader (public/widget.js) on the page it's
 * placed on. We inject the <script> on mount rather than using next/script so
 * execution is unambiguous on the client, and guard against double-injection.
 */
export default function WidgetMount() {
  useEffect(() => {
    if (document.getElementById("yopey-widget-script")) return;
    const s = document.createElement("script");
    s.id = "yopey-widget-script";
    s.src = "/widget.js";
    s.async = true;
    document.body.appendChild(s);
  }, []);

  return null;
}
