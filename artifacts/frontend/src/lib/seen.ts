// "Seen" marks for the Menu badges (api-server routes/seen.ts): the newest
// order / new customer each user has already looked at. A badge counts only
// what came after; opening the page marks everything up to now as seen.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/use-auth";

export type SeenKey = "orders" | "customers";
type SeenMarks = Record<SeenKey, number | null>;
const KEY = ["/api/seen"];

export function useSeen() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<SeenMarks> => {
      const res = await fetch("/api/seen", { credentials: "include" });
      if (!res.ok) throw new Error("seen");
      return res.json();
    },
    enabled: !!user,
    staleTime: 30_000,
  });
  return data ?? null;
}

// Call on the page itself: everything up to `maxId` is now seen.
export function useMarkSeen(key: SeenKey, maxId: number | null | undefined) {
  const queryClient = useQueryClient();
  const seen = useSeen();
  useEffect(() => {
    if (!maxId || !seen) return;
    const current = seen[key];
    if (current != null && current >= maxId) return;
    fetch(`/api/seen/${key}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastId: maxId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (r) queryClient.setQueryData<SeenMarks>(KEY, (old) => ({ ...(old ?? { orders: null, customers: null }), [key]: r.lastId }));
      })
      .catch(() => {});
  }, [key, maxId, seen]); // eslint-disable-line react-hooks/exhaustive-deps
}
