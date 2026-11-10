// How long a bill has been unpaid, counted from its invoice date (bills carry
// no separate due date). A fully paid bill shows "Clear".

import { differenceInCalendarDays } from "date-fns";
import { cn } from "@/lib/utils";

export function pendingDays(invoiceDate: string | Date): number {
  return Math.max(0, differenceInCalendarDays(new Date(), new Date(invoiceDate)));
}

// payStatus as computed by the invoice pages: paid | partial | not_paid | cancelled | na.
export function BillAge({ payStatus, invoiceDate, long, className, testId }: {
  payStatus: string; invoiceDate: string | Date; long?: boolean; className?: string; testId?: string;
}) {
  if (payStatus === "paid") {
    return <span className={cn("text-xs font-semibold text-green-700 dark:text-green-400 whitespace-nowrap", className)} data-testid={testId}>Clear</span>;
  }
  if (payStatus !== "partial" && payStatus !== "not_paid") {
    return <span className={cn("text-xs text-muted-foreground", className)} data-testid={testId}>—</span>;
  }
  const d = pendingDays(invoiceDate);
  const age = d === 0 ? "Today" : `${d} day${d === 1 ? "" : "s"}`;
  // Older dues stand out more.
  const tone = d > 60 ? "text-red-700 dark:text-red-400" : d > 30 ? "text-orange-600 dark:text-orange-400" : "text-amber-700 dark:text-amber-300";
  return (
    <span className={cn("text-xs font-semibold whitespace-nowrap", tone, className)} data-testid={testId} title={`Pending ${age === "Today" ? "since today" : `for ${age}`}`}>
      {long ? (d === 0 ? "Pending since today" : `Pending ${age}`) : age}
    </span>
  );
}
