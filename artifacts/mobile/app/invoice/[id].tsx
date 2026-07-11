import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

// Must mirror formatInvoice()/formatItem() in
// artifacts/api-server/src/routes/invoices.ts — a prior mismatched local
// shape here meant every field on this screen was silently undefined.
interface InvoiceItem {
  id: number;
  productId?: number;
  productName?: string;
  qty: number;
  unit?: string;
  rate: number;
  discountPct?: number;
  taxPct?: number;
  amount: number;
}

interface Invoice {
  id: number;
  invoiceNo: string;
  invoiceType: string;
  status: string;
  customerId: number | null;
  customerName?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  subtotal?: number;
  totalDiscount?: number;
  totalTax?: number;
  grandTotal: number;
  amountPaid?: number;
  balanceDue?: number;
  items?: InvoiceItem[];
}

function fmt(val: string | number | undefined): string {
  if (val === undefined || val === null) return "₹0.00";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "₹0.00";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function typeLabel(t: string): string {
  if (t === "gst") return "GST Invoice";
  if (t === "non_gst") return "Non-GST Invoice";
  if (t === "quotation") return "Quotation";
  if (t === "proforma_invoice") return "Proforma Invoice";
  if (t === "bill_of_supply") return "Bill of Supply";
  if (t === "delivery_challan") return "Delivery Challan";
  if (t === "sale_order") return "Sale Order";
  return t;
}

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data: invoice, isLoading, isError, refetch } = useQuery<Invoice>({
    queryKey: ["invoice", id],
    queryFn: () => apiGet<Invoice>(`/invoices/${id}`),
    enabled: !!id,
  });

  const styles = makeStyles(colors, insets);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError || !invoice) {
    return (
      <View style={styles.center}>
        <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
        <Text style={styles.errorTitle}>Could not load invoice</Text>
        <Pressable style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const balance = invoice.balanceDue ?? 0;
  const isPaid = balance <= 0;
  const statusColor = invoice.status === "cancelled"
    ? colors.destructive
    : invoice.status === "saved"
    ? colors.success
    : colors.warning;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.invoiceNum}>{invoice.invoiceNo}</Text>
          <Text style={styles.typeName}>{typeLabel(invoice.invoiceType)}</Text>
        </View>
        <View style={styles.badges}>
          <View style={[styles.badge, { backgroundColor: statusColor + "20" }]}>
            <Text style={[styles.badgeText, { color: statusColor }]}>
              {invoice.status}
            </Text>
          </View>
          {!isPaid ? (
            <View style={[styles.badge, { backgroundColor: colors.destructive + "20" }]}>
              <Text style={[styles.badgeText, { color: colors.destructive }]}>Due</Text>
            </View>
          ) : (
            <View style={[styles.badge, { backgroundColor: colors.success + "20" }]}>
              <Text style={[styles.badgeText, { color: colors.success }]}>Paid</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Feather name="user" size={14} color={colors.mutedForeground} />
          <Text style={styles.rowLabel}>Customer</Text>
          <Text style={styles.rowValue}>
            {invoice.customerName ?? `#${invoice.customerId}`}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Feather name="calendar" size={14} color={colors.mutedForeground} />
          <Text style={styles.rowLabel}>Date</Text>
          <Text style={styles.rowValue}>{formatDate(invoice.invoiceDate)}</Text>
        </View>
        {invoice.dueDate ? (
          <>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Feather name="clock" size={14} color={colors.mutedForeground} />
              <Text style={styles.rowLabel}>Due Date</Text>
              <Text style={styles.rowValue}>{formatDate(invoice.dueDate)}</Text>
            </View>
          </>
        ) : null}
      </View>

      {invoice.items && invoice.items.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items ({invoice.items.length})</Text>
          <View style={styles.itemsCard}>
            {invoice.items.map((item, idx) => (
              <View key={item.id ?? idx}>
                {idx > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.itemBlock}>
                  <View style={styles.itemBlockTop}>
                    <Text style={styles.itemName} numberOfLines={2}>
                      {item.productName ?? `Item ${idx + 1}`}
                    </Text>
                    <Text style={styles.itemAmount}>{fmt(item.amount)}</Text>
                  </View>
                  <Text style={styles.itemMeta}>
                    {item.qty}{item.unit ? ` ${item.unit}` : ""} × {fmt(item.rate)}
                    {item.discountPct ? ` · ${item.discountPct}% off` : ""}
                    {item.taxPct ? ` · GST ${item.taxPct}%` : ""}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.card}>
          {invoice.subtotal ? (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal</Text>
                <Text style={styles.summaryVal}>{fmt(invoice.subtotal)}</Text>
              </View>
              <View style={styles.divider} />
            </>
          ) : null}
          {invoice.totalDiscount && invoice.totalDiscount > 0 ? (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Discount</Text>
                <Text style={[styles.summaryVal, { color: colors.success }]}>
                  -{fmt(invoice.totalDiscount)}
                </Text>
              </View>
              <View style={styles.divider} />
            </>
          ) : null}
          {invoice.totalTax && invoice.totalTax > 0 ? (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Tax (GST)</Text>
                <Text style={styles.summaryVal}>{fmt(invoice.totalTax)}</Text>
              </View>
              <View style={styles.divider} />
            </>
          ) : null}
          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalVal}>{fmt(invoice.grandTotal)}</Text>
          </View>
          {invoice.amountPaid && invoice.amountPaid > 0 ? (
            <>
              <View style={styles.divider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Paid</Text>
                <Text style={[styles.summaryVal, { color: colors.success }]}>
                  {fmt(invoice.amountPaid)}
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.summaryRow}>
                <Text style={styles.totalLabel}>Balance</Text>
                <Text
                  style={[
                    styles.totalVal,
                    { color: isPaid ? colors.success : colors.destructive },
                  ]}
                >
                  {fmt(invoice.balanceDue)}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) {
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 16, paddingBottom: bottomPad + 16 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
    errorTitle: { fontSize: 16, fontWeight: "600" as const, color: colors.foreground },
    retryBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.primary, borderRadius: 8 },
    retryText: { color: "#fff", fontWeight: "600" as const },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 16,
    },
    headerLeft: { flex: 1 },
    invoiceNum: { fontSize: 22, fontWeight: "700" as const, color: colors.foreground },
    typeName: { fontSize: 13, color: colors.mutedForeground, marginTop: 2 },
    badges: { gap: 6, alignItems: "flex-end" },
    badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
    badgeText: { fontSize: 11, fontWeight: "600" as const, textTransform: "capitalize" as const },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      padding: 14,
      gap: 8,
    },
    rowLabel: { fontSize: 13, color: colors.mutedForeground, width: 80 },
    rowValue: { flex: 1, fontSize: 14, fontWeight: "500" as const, color: colors.foreground, textAlign: "right" as const },
    divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 14 },
    section: { marginTop: 16 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: "700" as const,
      color: colors.mutedForeground,
      textTransform: "uppercase" as const,
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    itemsCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    itemBlock: { padding: 14, gap: 4 },
    itemBlockTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 10,
    },
    itemName: { flex: 1, fontSize: 14, fontWeight: "600" as const, color: colors.foreground },
    itemAmount: { fontSize: 14, fontWeight: "700" as const, color: colors.foreground },
    itemMeta: { fontSize: 12, color: colors.mutedForeground },
    summaryRow: { flexDirection: "row", justifyContent: "space-between", padding: 14 },
    summaryLabel: { fontSize: 14, color: colors.mutedForeground },
    summaryVal: { fontSize: 14, fontWeight: "500" as const, color: colors.foreground },
    totalLabel: { fontSize: 15, fontWeight: "700" as const, color: colors.foreground },
    totalVal: { fontSize: 17, fontWeight: "700" as const, color: colors.foreground },
  });
}
