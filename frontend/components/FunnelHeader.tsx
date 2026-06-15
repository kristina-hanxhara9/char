"use client";

import Link from "next/link";
import { useIsEmbedded } from "@/lib/embed";
import YbMark from "@/components/YbMark";

/**
 * YOPEY page header for the onboarding funnel. Hidden inside the embeddable
 * widget, where the host panel supplies its own title bar and close button —
 * showing both would be redundant, and the "← Back" link points at the
 * marketing landing page, which is a dead end inside the widget.
 */
export default function FunnelHeader() {
  const embedded = useIsEmbedded();
  if (embedded) return null;

  return (
    <header className="bg-yopey-accent px-6 py-5 md:px-10 md:py-6">
      <div className="flex items-center justify-between max-w-5xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <YbMark size={40} />
          <span className="flex items-baseline gap-2">
            <span className="font-extrabold text-2xl text-yopey-primary tracking-wide">YOPEY</span>
            <span className="text-lg text-yopey-primary/80 italic">Befriender</span>
          </span>
        </Link>
        <Link href="/" className="text-sm text-yopey-primary hover:text-yopey-primary font-semibold">
          ← Back
        </Link>
      </div>
    </header>
  );
}
