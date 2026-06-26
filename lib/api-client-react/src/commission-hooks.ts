import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions, UseMutationOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface CommissionTransaction {
  id: number;
  invoiceId: number;
  invoiceNo: string;
  salesmanId: number;
  salesmanName: string;
  customerId: number | null;
  customerName: string | null;
  totalLiters: number;
  commissionAmount: number;
  status: "pending" | "paid";
  paidAt: string | null;
  paymentReference: string | null;
  createdAt: string;
}

export interface CommissionTransactionTotals {
  pending: number;
  paid: number;
  total: number;
}

export interface CommissionTransactionsResponse {
  transactions: CommissionTransaction[];
  totals: CommissionTransactionTotals;
}

export interface CommissionSalesmanSummary {
  salesmanId: number;
  salesmanName: string;
  pending: number;
  paid: number;
  total: number;
  transactions: number;
}

export interface CommissionPayment {
  id: number;
  salesmanId: number;
  salesmanName: string;
  amount: number;
  paymentDate: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface CommissionMyStats {
  pending: number;
  paid: number;
  total: number;
  recentTransactions: Array<{
    id: number;
    invoiceNo: string;
    customerName: string | null;
    totalLiters: number;
    commissionAmount: number;
    status: "pending" | "paid";
    createdAt: string;
  }>;
}

export interface GetCommissionTransactionsParams {
  salesmanId?: number;
  status?: "pending" | "paid";
  from?: string;
  to?: string;
}

function buildQs(params: Record<string, any>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

// ── Transactions ─────────────────────────────────────────────────────────────

export const getCommissionTransactionsQueryKey = (params?: GetCommissionTransactionsParams) =>
  ["commission-transactions", params ?? {}] as const;

export function useGetCommissionTransactions(
  params?: GetCommissionTransactionsParams,
  options?: { query?: UseQueryOptions<CommissionTransactionsResponse> }
) {
  const qs = buildQs(params ?? {});
  return useQuery<CommissionTransactionsResponse>({
    queryKey: getCommissionTransactionsQueryKey(params),
    queryFn: () => customFetch<CommissionTransactionsResponse>(`/api/commissions/transactions${qs}`),
    ...options?.query,
  });
}

// Fixed: added explicit generic type to customFetch
export function useMarkTransactionPaid(
  options?: UseMutationOptions<
    { id: number; status: string; paidAt: string | null; paymentReference: string | null },
    unknown,
    { id: number; reference?: string }
  >
) {
  return useMutation({
    mutationFn: ({ id, reference }: { id: number; reference?: string }) =>
      customFetch<{ id: number; status: string; paidAt: string | null; paymentReference: string | null }>(
        `/api/commissions/transactions/${id}/mark-paid`,
        {
          method: "PATCH",
          body: JSON.stringify({ reference }),
          headers: { "Content-Type": "application/json" },
        }
      ),
    ...options,
  });
}

// ── Bulk pay ─────────────────────────────────────────────────────────────────

export function useBulkPayCommission(
  options?: UseMutationOptions<
    { paidCount: number; totalAmount: number },
    unknown,
    { salesmanId: number; reference?: string; note?: string }
  >
) {
  return useMutation({
    mutationFn: (data: { salesmanId: number; reference?: string; note?: string }) =>
      customFetch<{ paidCount: number; totalAmount: number }>(`/api/commissions/bulk-pay`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    ...options,
  });
}

// ── Salesman summary (admin) ──────────────────────────────────────────────────

export const getCommissionSalesmenSummaryQueryKey = () => ["commission-salesmen-summary"] as const;

export function useGetCommissionSalesmenSummary(
  options?: { query?: UseQueryOptions<CommissionSalesmanSummary[]> }
) {
  return useQuery<CommissionSalesmanSummary[]>({
    queryKey: getCommissionSalesmenSummaryQueryKey(),
    queryFn: () => customFetch<CommissionSalesmanSummary[]>(`/api/commissions/salesmen-summary`),
    ...options?.query,
  });
}

// ── Payment history (admin) ───────────────────────────────────────────────────

export const getCommissionPaymentHistoryQueryKey = (salesmanId?: number) =>
  ["commission-payment-history", salesmanId] as const;

export function useGetCommissionPaymentHistory(
  salesmanId?: number,
  options?: { query?: UseQueryOptions<CommissionPayment[]> }
) {
  const qs = salesmanId ? `?salesmanId=${salesmanId}` : "";
  return useQuery<CommissionPayment[]>({
    queryKey: getCommissionPaymentHistoryQueryKey(salesmanId),
    queryFn: () => customFetch<CommissionPayment[]>(`/api/commissions/payment-history${qs}`),
    ...options?.query,
  });
}

// ── My stats (salesman) ───────────────────────────────────────────────────────

export const getCommissionMyStatsQueryKey = () => ["commission-my-stats"] as const;

export function useGetCommissionMyStats(
  options?: { query?: UseQueryOptions<CommissionMyStats> }
) {
  return useQuery<CommissionMyStats>({
    queryKey: getCommissionMyStatsQueryKey(),
    queryFn: () => customFetch<CommissionMyStats>(`/api/commissions/my-stats`),
    ...options?.query,
  });
}