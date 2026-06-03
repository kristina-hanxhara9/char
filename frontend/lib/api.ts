const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type OnboardPayload = {
  first_name: string;
  age: number;
  utm_source?: string;
};

export type OnboardResponse = {
  user_id: string;
  first_name: string;
};

export async function onboard(
  payload: OnboardPayload
): Promise<OnboardResponse> {
  const res = await fetch(`${API_URL}/api/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Onboard failed (${res.status})`);
  }
  return res.json();
}

export async function sendMessage(
  user_id: string,
  message: string
): Promise<string> {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id, message }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Chat failed (${res.status})`);
  }
  const data = await res.json();
  return data.reply as string;
}

export async function fetchDashboard<T = unknown>(
  path: string,
  password: string
): Promise<T> {
  const res = await fetch(`${API_URL}/api/dashboard/${path}`, {
    headers: { "X-Dashboard-Password": password },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Dashboard fetch failed (${res.status})`);
  }
  return res.json();
}

export async function markReply(
  contact_id: string,
  outcome: "accepted" | "rejected",
  password: string
): Promise<void> {
  const res = await fetch(`${API_URL}/api/dashboard/mark-reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Password": password,
    },
    body: JSON.stringify({ contact_id, outcome }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Mark reply failed (${res.status})`);
  }
}
