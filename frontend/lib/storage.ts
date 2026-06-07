// Tiny localStorage helpers — keeps the chat session alive across reloads.
const USER_KEY = "yopey_user";
const PASS_KEY = "yopey_dash_pass";

export type StoredUser = {
  user_id: string;
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

export const dashPasswordStorage = {
  get(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(PASS_KEY);
  },
  set(p: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem(PASS_KEY, p);
  },
  clear() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(PASS_KEY);
  },
};
