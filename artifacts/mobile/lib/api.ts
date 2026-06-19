import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const SESSION_KEY = "erp_session_cookie";
let sessionCookie: string | null = null;

function getBase(): string {
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
}

export async function loadSession(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    sessionCookie = await AsyncStorage.getItem(SESSION_KEY);
  } catch {}
}

export async function saveSession(cookie: string | null): Promise<void> {
  sessionCookie = cookie;
  if (Platform.OS === "web") return;
  try {
    if (cookie) {
      await AsyncStorage.setItem(SESSION_KEY, cookie);
    } else {
      await AsyncStorage.removeItem(SESSION_KEY);
    }
  } catch {}
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (sessionCookie && Platform.OS !== "web") {
    headers["Cookie"] = sessionCookie;
  }

  const res = await fetch(`${getBase()}/api${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (Platform.OS !== "web") {
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/connect\.sid=([^;]+)/);
      if (match) {
        await saveSession(`connect.sid=${match[1]}`);
      }
    }
  }

  return res;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw new Error(err["error"] ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}
