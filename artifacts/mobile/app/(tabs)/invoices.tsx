import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

interface Invoice {
  id: number;
  invoiceNumber: string;
  invoiceType: string;
  status: string;
  customerId: number;
  customerName?: string;
  date: string;
  totalAmount: string;
  paidAmount?: string;
  balance?: string;
}

const FILTERS = ["All", "GST", "Non-GST", "Quotation"] as const;
type Filter = (typeof FILTERS)[number];

function formatAmount(val: string | number | undefined): string {
  if (!val) return "₹0";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "₹0";
  return "₹" + num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function typeLabel(type: string): string {
  if (type === "gst_invoice") return "GST";
  if (type === "non_gst_invoice") return "Non-GST";
  if (type === "quotation") return "Quotation";
  if (type === "service_charge") return "Service";
  return type;
}

function statusColor(status: string, colors: ReturnType<typeof useColors>) {
  if (status === "confirmed") return colors.success;
  if (status === "cancelled") return colors.destructive;
  return colors.warning;
}

function balanceColor(balance: string | undefined, colors: ReturnType<typeof useColors>) {
  const b = parseFloat(balance ?? "0");
  if (b <= 0) return colors.success;
  if (b > 0) return colors.destructive;
  return colors.mutedForeground;
}

export default function InvoicesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("All");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<Invoice[]>({
    queryKey: ["invoices"],
    queryFn: () => apiGet<Invoice[]>("/invoices"),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((inv) => {
      const matchSearch =
        !search ||
        inv.invoiceNumber?.toLowerCase().includes(search.toLowerCase()) ||
        inv.customerName?.toLowerCase().includes(search.toLowerCase());

      const matchFilter =
        filter === "All" ||
        (filter === "GST" && inv.invoiceType === "gst_invoice") ||
        (filter === "Non-GST" && inv.invoiceType === "non_gst_invoice") ||
        (filter === "Quotation" && inv.invoiceType === "quotation");

      return matchSearch && matchFilter;
    });
  }, [data, search, filter]);

  const styles = makeStyles(colors, insets);

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={colors.mutedForeground} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search invoices..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
        {search ? (
          <Pressable onPress={() => setSearch("")}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>Could not load invoices</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          scrollEnabled={filtered.length > 0}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Feather name="file-text" size={40} color={colors.mutedForeground} />
              <Text style={styles.emptyTitle}>No invoices found</Text>
              <Text style={styles.emptyText}>
                {search ? "Try a different search term" : "Invoices will appear here"}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => {
                Haptics.selectionAsync();
                router.push(`/invoice/${item.id}`);
              }}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardLeft}>
                  <Text style={styles.invoiceNum}>{item.invoiceNumber}</Text>
                  <Text style={styles.customerName} numberOfLines={1}>
                    {item.customerName ?? `Customer #${item.customerId}`}
                  </Text>
                </View>
                <View style={styles.cardRight}>
                  <Text style={styles.amount}>{formatAmount(item.totalAmount)}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: statusColor(item.status, colors) + "20" },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        { color: statusColor(item.status, colors) },
                      ]}
                    >
                      {item.status}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.cardBottom}>
                <View style={styles.typePill}>
                  <Text style={styles.typeText}>{typeLabel(item.invoiceType)}</Text>
                </View>
                <Text style={styles.dateText}>{formatDate(item.date)}</Text>
                {item.balance !== undefined && (
                  <Text
                    style={[
                      styles.balanceText,
                      { color: balanceColor(item.balance, colors) },
                    ]}
                  >
                    {parseFloat(item.balance) > 0
                      ? `Due: ${formatAmount(item.balance)}`
                      : "Paid"}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) {
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      margin: 16,
      paddingHorizontal: 12,
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      height: 44,
    },
    searchIcon: { marginRight: 8 },
    searchInput: { flex: 1, fontSize: 15, color: colors.foreground },
    filterRow: {
      flexDirection: "row",
      paddingHorizontal: 16,
      gap: 8,
      marginBottom: 8,
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 20,
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    filterText: { fontSize: 13, fontWeight: "500" as const, color: colors.mutedForeground },
    filterTextActive: { color: "#ffffff" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
    list: { padding: 16, paddingBottom: bottomPad + 16, gap: 10 },
    emptyBox: { alignItems: "center", paddingTop: 60, gap: 8 },
    emptyTitle: { fontSize: 16, fontWeight: "600" as const, color: colors.foreground },
    emptyText: { fontSize: 14, color: colors.mutedForeground, textAlign: "center" as const },
    retryBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.primary, borderRadius: 8 },
    retryText: { color: "#fff", fontWeight: "600" as const },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardPressed: { opacity: 0.8 },
    cardTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
    cardLeft: { flex: 1, marginRight: 12 },
    invoiceNum: { fontSize: 15, fontWeight: "700" as const, color: colors.foreground },
    customerName: { fontSize: 13, color: colors.mutedForeground, marginTop: 2 },
    cardRight: { alignItems: "flex-end" },
    amount: { fontSize: 16, fontWeight: "700" as const, color: colors.foreground },
    statusBadge: { marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
    statusText: { fontSize: 11, fontWeight: "600" as const, textTransform: "capitalize" as const },
    cardBottom: { flexDirection: "row", alignItems: "center", gap: 8 },
    typePill: { backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    typeText: { fontSize: 11, fontWeight: "600" as const, color: colors.accentForeground },
    dateText: { fontSize: 12, color: colors.mutedForeground, flex: 1 },
    balanceText: { fontSize: 12, fontWeight: "600" as const },
  });
}
