"use client";

// Always-visible crisis signposting. Deliberately NOT dependent on the bot
// detecting anything: a young person can reach a real person at any moment.
// This is the safety net behind the model's own safeguarding flow and the
// server-side deterministic backstop — recall is never perfect (oblique
// disclosure with no keywords slips past detection), so help is always one tap
// away regardless. Rendered persistently in the chat footer.
export default function HelpResources() {
  return (
    <details className="group mt-2 rounded-xl border border-yopey-primary/20 bg-yopey-accent/10 px-3 py-2 text-left">
      <summary className="cursor-pointer list-none text-xs font-semibold text-yopey-primary flex items-center gap-1.5 min-h-[28px]">
        <span aria-hidden="true">♥</span>
        Need to talk to someone now? Get help
        <span className="ml-auto text-yopey-primary/60 group-open:rotate-180 transition" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="mt-2 text-xs text-gray-700 space-y-1.5 leading-relaxed">
        <p>
          If you&apos;re struggling, or you or someone else might be in danger,
          please talk to a real person. These are free, confidential, and open
          any time:
        </p>
        <ul className="space-y-1">
          <li>
            <strong>Samaritans</strong> (24/7): <a className="underline" href="tel:116123">116 123</a>
          </li>
          <li>
            <strong>Shout</strong> (24/7 text): text <strong>SHOUT</strong> to{" "}
            <a className="underline" href="sms:85258">85258</a>
          </li>
          <li>
            <strong>Childline</strong> (under 19s): <a className="underline" href="tel:08001111">0800 1111</a>
          </li>
          <li>
            <strong>The Mix</strong> (under 25s): <a className="underline" href="tel:08088084994">0808 808 4994</a>
          </li>
          <li>
            In immediate danger? Call <a className="underline font-semibold" href="tel:999">999</a>.
          </li>
        </ul>
        <p className="text-gray-500">
          You can also reach YOPEY&apos;s safeguarding lead at{" "}
          <a className="underline" href="mailto:hello@yopey.org">hello@yopey.org</a> or{" "}
          <a className="underline" href="tel:01440821654">01440 821654</a>.
        </p>
      </div>
    </details>
  );
}
