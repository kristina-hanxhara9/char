// Tiny localStorage helpers — keeps the chat session alive across reloads.
const USER_KEY = "yopey_user";
const TOKEN_KEY = "yopey_dash_token";

export type StoredUser = {
  user_id: string;
  user_token: string;  // HMAC token from /api/onboard — required for /api/user/{id} + /api/survey
  first_name: string;
  postcode?: string;
  is_student?: boolean;
  search_preference?: "home" | "school";
};

export const userStorage = {
  get(): StoredUser | null {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  set(u: StoredUser) {
    if (typeof window === "undefined") return;
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  },
  clear() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(USER_KEY);
  },
};

// Stores the admin session token (HMAC-signed, 7-day expiry, revocable
// server-side). Replaces the old cleartext shared-password store.
export const dashTokenStorage = {
  get(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
  },
  set(t: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem(TOKEN_KEY, t);
  },
  clear() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(TOKEN_KEY);
  },
};
