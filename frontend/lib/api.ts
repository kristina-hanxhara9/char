const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type OnboardPayload = {
  first_name: string;
  surname: string;
  age: number;
  email: string;
  phone: string;
  home_postcode: string;
  is_student: boolean;
  school_name?: string;
  // If we resolved the school postcode client-side (via /api/geocode-school
  // running in the background during the survey), pass it here so the backend
  // doesn't re-geocode.
  school_postcode?: string;
  search_preference: "home" | "school";
  utm_source?: string;
};

export type OnboardResponse = {
  user_id: string;
  user_token: string;  // HMAC token — store in localStorage, send as X-User-Token
  first_name: string;
  postcode?: string | null;
};

export type SurveyAnswers = {
  q1_afraid: number;
  q2_confident: number;
  q3_comfortable_touching: number;
  q4_uncomfortable: number;
  q5_different_needs: number;
  q6_past_history: number;
  q7_relaxed: number;
  q8_feel_kindness: number;
  q9_frustrated: number;
  q10_difficult_behaviour: number;
};

export async function requestReturnLink(email: string): Promise<void> {
  // Always resolves (the backend returns a generic response regardless of
  // whether the email exists — no enumeration). Errors are surfaced only for
  // network/validation failures.
  const res = await fetch(`${API_URL}/api/request-return-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Couldn't send the link (${res.status})`);
  }
}

export type ReturnExchange = {
  user_id: string;
  user_token: string;
  first_name: string;
  postcode?: string | null;
  is_student?: boolean | null;
  search_preference?: "home" | "school" | null;
};

export async function exchangeReturnToken(token: string): Promise<ReturnExchange> {
  const res = await fetch(`${API_URL}/api/return/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `This link didn't work (${res.status})`);
  }
  return res.json();
}

export function precomputeSearch(postcode: string): Promise<void> {
  // Fire-and-forget — the backend warms the care_home_searches cache so the
  // auto-search on /chat returns instantly. Failures are swallowed; the
  // /chat auto-search will retry the real search if cache is cold.
  return fetch(`${API_URL}/api/precompute-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode }),
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export async function geocodeSchool(name: string): Promise<{ postcode: string }> {
  const res = await fetch(
    `${API_URL}/api/geocode-school?name=${encodeURIComponent(name)}`
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Couldn't find that school (${res.status})`);
  }
  return res.json();
}

export async function submitSurvey(
  user_id: string,
  user_token: string,
  answers: SurveyAnswers,
  survey_type: "pre" | "post" = "pre"
): Promise<{ status: string }> {
  const res = await fetch(`${API_URL}/api/survey`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Token": user_token,
    },
    body: JSON.stringify({ user_id, survey_type, ...answers }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Survey submit failed (${res.status})`);
  }
  return res.json();
}

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

export type UserMe = {
  user_id: string;
  first_name: string;
  surname?: string | null;
  email?: string | null;
  postcode?: string | null;
  status?: string | null;
};

export async function fetchUser(user_id: string, user_token: string): Promise<UserMe> {
  const res = await fetch(`${API_URL}/api/user/${user_id}`, {
    headers: { "X-User-Token": user_token },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Fetch user failed (${res.status})`);
  }
  return res.json();
}

export async function deleteAccount(
  user_id: string,
  user_token: string
): Promise<{ status: string; deleted_rows: Record<string, number> }> {
  const res = await fetch(`${API_URL}/api/user/${user_id}`, {
    method: "DELETE",
    headers: { "X-User-Token": user_token },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Delete failed (${res.status})`);
  }
  return res.json();
}

// Stash for the auto-search reply that fires at /api/onboard time (NOT
// when /chat mounts) so the LLM is processing while the user navigates.
// ChatWindow consumes the in-flight promise and renders the reply when it
// arrives. Saves the 5-15s "looking for care homes" wait the user sees.
const initialChatPromises = new Map<string, Promise<string>>();

export function preloadInitialChat(user_id: string, postcode: string): Promise<string> {
  const message = `Please find me 5 care homes near my postcode ${postcode}.`;
  const promise = sendMessage(user_id, message);
  initialChatPromises.set(user_id, promise);
  return promise;
}

export function consumeInitialChat(user_id: string): Promise<string> | undefined {
  const p = initialChatPromises.get(user_id);
  if (p) initialChatPromises.delete(user_id);
  return p;
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

export async function fetchConversation(
  user_id: string,
  password: string
): Promise<{ user_id: string; messages: { role: string; content: string }[] }> {
  const res = await fetch(`${API_URL}/api/dashboard/conversation/${user_id}`, {
    headers: { "X-Dashboard-Password": password },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Couldn't load conversation (${res.status})`);
  }
  return res.json();
}

export async function resolveSafeguarding(
  alert_id: string,
  resolved_by: string,
  password: string,
  notes?: string
): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/dashboard/safeguarding/${alert_id}/resolve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dashboard-Password": password,
      },
      body: JSON.stringify({ resolved_by, notes }),
    }
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Couldn't resolve (${res.status})`);
  }
}

export async function adminDeleteUser(user_id: string, password: string): Promise<void> {
  // Same endpoint, but admin auth via X-Dashboard-Password header instead
  // of the user's HMAC token (the dashboard doesn't know the user's token).
  const res = await fetch(`${API_URL}/api/user/${user_id}`, {
    method: "DELETE",
    headers: { "X-Dashboard-Password": password },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Delete failed (${res.status})`);
  }
}
