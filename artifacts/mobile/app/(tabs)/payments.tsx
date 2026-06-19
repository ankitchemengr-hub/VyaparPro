import { Feather } from "@expo/vector-icons";
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

interface Payment {
  id: number;
  receiptNumber: string;
  entityId: number;
  entityName?: string;
  amount: string;
  mode: string;
  date: string;
  notes?: string;
  status?: string;
}

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

function modeIcon(mode: string): "credit-card" | "dollar-sign" | "smartphone" | "check-square" {
  if (mode === "cash") return "dollar-sign";
  if (mode === "online" || mode === "upi") return "smartphone";
  if (mode === "cheque") return "check-square";
  return "credit-card";
}

function modeColor(mode: string, colors: ReturnType<typeof useColors>): string {
  if (mode === "cash") return colors.success;
  if (mode === "online" || mode === "upi") return colors.primary;
  if (mode === "cheque") return "#8b5cf6";
  return colors.mutedForeground;
}

export default function PaymentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<Payment[]>({
    queryKey: ["payments"],
    queryFn: () => apiGet<Payment[]>("/payments"),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(
      (p) =>
        p.receiptNumber?.toLowerCase().includes(q) ||
        p.entityName?.toLowerCase().includes(q) ||
        p.mode?.toLowerCase().includes(q)
    );
  }, [data, search]);

  const totalAmount = useMemo(() => {
    if (!filtered.length) return 0;
    return filtered.reduce((sum, p) => sum + parseFloat(p.amount ?? "0"), 0);
  }, [filtered]);

  const styles = makeStyles(colors, insets);

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={colors.mutedForeground} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search receipts..."
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

      {data && filtered.length > 0 ? (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryCount}>{filtered.length} payments</Text>
          <Text style={styles.summaryTotal}>{formatAmount(totalAmount)}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>Could not load payments</Text>
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
              <Feather name="credit-card" size={40} color={colors.mutedForeground} />
              <Text style={styles.emptyTitle}>No payments found</Text>
              <Text style={styles.emptyText}>
                {search ? "Try a different search" : "Payments will appear here"}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View
                style={[
                  styles.modeIcon,
                  { backgroundColor: modeColor(item.mode, colors) + "15" },
                ]}
              >
                <Feather
                  name={modeIcon(item.mode)}
                  size={18}
                  color={modeColor(item.mode, colors)}
                />
              </View>
              <View style={styles.info}>
                <View style={styles.topRow}>
                  <Text style={styles.receiptNum}>{item.receiptNumber}</Text>
                  <Text style={styles.amount}>{formatAmount(item.amount)}</Text>
                </View>
                <View style={styles.bottomRow}>
                  <Text style={styles.entityName} numberOfLines={1}>
                    {item.entityName ?? `Entity #${item.entityId}`}
                  </Text>
                  <Text style={styles.date}>{formatDate(item.date)}</Text>
                </View>
                <View style={styles.modePill}>
                  <View
                    style={[
                      styles.modeDot,
                      { backgroundColor: modeColor(item.mode, colors) },
                    ]}
                  />
                  <Text style={[styles.modeText, { color: modeColor(item.mode, colors) }]}>
                    {item.mode?.toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>
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
      marginBottom: 8,
      paddingHorizontal: 12,
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      height: 44,
    },
    searchIcon: { marginRight: 8 },
    searchInput: { flex: 1, fontSize: 15, color: colors.foreground },
    summaryBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    summaryCount: { fontSize: 12, color: colors.mutedForeground },
    summaryTotal: { fontSize: 13, fontWeight: "700" as const, color: colors.foreground },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
    list: { padding: 16, paddingTop: 4, paddingBottom: bottomPad + 16, gap: 8 },
    emptyBox: { alignItems: "center", paddingTop: 60, gap: 8 },
    emptyTitle: { fontSize: 16, fontWeight: "600" as const, color: colors.foreground },
    emptyText: { fontSize: 14, color: colors.mutedForeground, textAlign: "center" as const },
    retryBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.primary, borderRadius: 8 },
    retryText: { color: "#fff", fontWeight: "600" as const },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12,
    },
    modeIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    info: { flex: 1 },
    topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    receiptNum: { fontSize: 14, fontWeight: "700" as const, color: colors.foreground },
    amount: { fontSize: 16, fontWeight: "700" as const, color: colors.foreground },
    bottomRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 4,
      marginBottom: 6,
    },
    entityName: { fontSize: 12, color: colors.mutedForeground, flex: 1, marginRight: 8 },
    date: { fontSize: 12, color: colors.mutedForeground },
    modePill: { flexDirection: "row", alignItems: "center", gap: 4 },
    modeDot: { width: 6, height: 6, borderRadius: 3 },
    modeText: { fontSize: 11, fontWeight: "600" as const },
  });
}
