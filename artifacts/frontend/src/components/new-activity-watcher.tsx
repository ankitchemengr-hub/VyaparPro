import { useEffect, useRef } from "react";
import {
  useListCustomerOrders,
  useListEntities,
  getListCustomerOrdersQueryKey,
  getListEntitiesQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { playNotificationSound } from "@/lib/notification-sound";

const POLL_MS = 30_000;

// No UI of its own — mounted once in AppLayout so a toast fires the moment a
// new customer order or a salesman-added customer shows up, no matter what
// page is currently open.
//
// Orders are watched by TOTAL count (no status filter), not just "pending"
// — a customer or counter checkout is created straight into "processing" so
// Manufacturing sees it immediately (see customer-orders.ts), skipping
// "pending" entirely, so a pending-only watch would silently miss the exact
// orders admin most needs a heads-up about. This uses its own query key,
// separate from the Menu tile's badge (which stays "pending" — that one is
// a staff actionable-backlog count, not an activity feed, so it deliberately
// keeps a different meaning).
export function NewActivityWatcher() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const canSeeOrders = hasRole(["admin", "store", "manufacturing"]);
  const isAdmin = hasRole(["admin"]);

  const allOrdersParams = {};
  const { data: allOrders } = useListCustomerOrders(allOrdersParams, {
    query: {
      enabled: canSeeOrders,
      refetchInterval: POLL_MS,
      queryKey: getListCustomerOrdersQueryKey(allOrdersParams),
    },
  });

  const newCustomerParams = { type: "customer" as const, isNewFromSalesman: true };
  const { data: newCustomers } = useListEntities(newCustomerParams, {
    query: {
      enabled: isAdmin,
      refetchInterval: POLL_MS,
      queryKey: getListEntitiesQueryKey(newCustomerParams),
    },
  });

  const prevMaxOrderId = useRef<number | null>(null);
  const prevCustomers = useRef<number | null>(null);

  useEffect(() => {
    if (!allOrders || allOrders.length === 0) return;
    // Tracked by highest order id seen, not array length — the endpoint caps
    // at 200 most-recent rows, so once a company passes 200 total orders a
    // length-based diff would plateau and never fire again.
    const maxId = Math.max(...allOrders.map((o: any) => o.id));
    if (prevMaxOrderId.current != null && maxId > prevMaxOrderId.current) {
      const newCount = allOrders.filter((o: any) => o.id > prevMaxOrderId.current!).length;
      playNotificationSound();
      toast({
        title: newCount === 1 ? "New customer order" : `${newCount} new customer orders`,
        description: "Open Customer Orders to review.",
      });
    }
    prevMaxOrderId.current = maxId;
  }, [allOrders, toast]);

  useEffect(() => {
    if (!newCustomers) return;
    const count = newCustomers.length;
    if (prevCustomers.current != null && count > prevCustomers.current) {
      const diff = count - prevCustomers.current;
      playNotificationSound();
      toast({
        title: diff === 1 ? "New customer added by a salesman" : `${diff} new customers added by salesmen`,
        description: "Open Customers to review.",
      });
    }
    prevCustomers.current = count;
  }, [newCustomers, toast]);

  return null;
}
