import { useEffect, useRef } from "react";
import {
  useListCustomerOrders,
  useListEntities,
  getListCustomerOrdersQueryKey,
  getListEntitiesQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";

const POLL_MS = 30_000;

// No UI of its own — mounted once in AppLayout so a toast fires the moment a
// new customer order or a salesman-added customer shows up, no matter what
// page is currently open. The matching badge counts (shown on the Menu
// tiles) poll the exact same query keys, so React Query dedupes the actual
// network requests between the two.
export function NewActivityWatcher() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const canSeeOrders = hasRole(["admin", "store", "manufacturing"]);
  const isAdmin = hasRole(["admin"]);

  const ordersParams = { status: "pending" as const };
  const { data: pendingOrders } = useListCustomerOrders(ordersParams, {
    query: {
      enabled: canSeeOrders,
      refetchInterval: POLL_MS,
      queryKey: getListCustomerOrdersQueryKey(ordersParams),
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

  const prevOrders = useRef<number | null>(null);
  const prevCustomers = useRef<number | null>(null);

  useEffect(() => {
    if (!pendingOrders) return;
    const count = pendingOrders.length;
    if (prevOrders.current != null && count > prevOrders.current) {
      const diff = count - prevOrders.current;
      toast({
        title: diff === 1 ? "New customer order" : `${diff} new customer orders`,
        description: "Open Customer Orders to review.",
      });
    }
    prevOrders.current = count;
  }, [pendingOrders, toast]);

  useEffect(() => {
    if (!newCustomers) return;
    const count = newCustomers.length;
    if (prevCustomers.current != null && count > prevCustomers.current) {
      const diff = count - prevCustomers.current;
      toast({
        title: diff === 1 ? "New customer added by a salesman" : `${diff} new customers added by salesmen`,
        description: "Open Customers to review.",
      });
    }
    prevCustomers.current = count;
  }, [newCustomers, toast]);

  return null;
}
