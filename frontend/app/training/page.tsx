import { redirect } from "next/navigation";

// Standalone "Dementia training" entry — a clean, memorable URL the YOPEY website
// can link to or iframe on its Training page. It forwards into the funnel's quick
// sign-in with the training intent, which then drops the user into
// /chat?intent=training (where the AI teaches the dementia basics). Any query
// params already on the URL (embed, utm_source, …) are carried through.
export default function TrainingPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  params.set("intent", "training");
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (key === "intent") continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value !== undefined) params.set(key, value);
  }
  redirect(`/start?${params.toString()}`);
}
