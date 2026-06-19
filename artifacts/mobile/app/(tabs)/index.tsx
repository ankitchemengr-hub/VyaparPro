import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { apiGet } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

interface CapitalSnapshot {
  totalOutstanding?: string | number;
  totalReceivable?: string | number;
  todayCollection?: string | number;
  thisMonthCollection?: string | number;
  totalInventoryValue?: string | number;
  cashBalance?: string | number;
  bankBalance?: string | number;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  invoiceType: string;
  status: string;
  customerId: number;
  customerName?: string;
  date: string;
  totalAmount: string;
  balance?: string;
}

function fmt(val: string | number | undefined, compact = true): string {
  if (val === undefined || val === null) return "₹0";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "₹0";
  if (compact && Math.abs(n) >= 100000) {
    return "₹" + (n / 100000).toFixed(1) + "L";
  }
  if (compact && Math.abs(n) >= 1000) {
    return "₹" + (n / 1000).toFixed(1) + "K";
  }
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return s;
  }
}

function typeLabel(t: string): string {
  if (t === "gst_invoice") return "GST";
  if (t === "non_gst_invoice") return "Non-GST";
  if (t === "quotation") return "Quotation";
  return t;
}

export default function DashboardScreen() {
  const { user, companyName, logout } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const {
    data: snapshot,
    isLoading: snapLoading,
    refetch: refetchSnap,
    isRefetching: snapRefetching,
  } = useQuery<CapitalSnapshot>({
    queryKey: ["capital-snapshot"],
    queryFn: () => apiGet<CapitalSnapshot>("/dashboard/capital"),
    retry: 1,
  });

  const {
    data: invoices,
    isLoading: invLoading,
    refetch: refetchInv,
  } = useQuery<Invoice[]>({
    queryKey: ["invoices"],
    queryFn: () => apiGet<Invoice[]>("/invoices"),
    retry: 1,
  });

  const recentInvoices = invoices?.slice(0, 6) ?? [];
  const isLoading = snapLoading || invLoading;
  const isRefreshing = snapRefetching;

  const handleRefresh = () => {
    refetchSnap();
    refetchInv();
  };

  const handleLogout = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await logout();
  };

  const styles = makeStyles(colors, insets);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.topBar}>
        <View>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.userName}>{user?.username ?? "User"}</Text>
          {companyName ? (
            <Text style={styles.companyName}>{companyName}</Text>
          ) : null}
        </View>
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
          onPress={handleLogout}
        >
          <Feather name="log-out" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {snapLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Loading snapshot...</Text>
        </View>
      ) : snapshot ? (
        <View>
          <Text style={styles.sectionTitle}>Financial Overview</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statsRow}
          >
            {snapshot.totalOutstanding !== undefined && (
              <StatCard
                label="Outstanding"
                value={fmt(snapshot.totalOutstanding)}
                icon="alert-circle"
                color={colors.destructive}
                colors={colors}
              />
            )}
            {snapshot.todayCollection !== undefined && (
              <StatCard
                label="Today's Collection"
                value={fmt(snapshot.todayCollection)}
                icon="trending-up"
                color={colors.success}
                colors={colors}
              />
            )}
            {snapshot.thisMonthCollection !== undefined && (
              <StatCard
                label="This Month"
                value={fmt(snapshot.thisMonthCollection)}
                icon="calendar"
                color={colors.primary}
                colors={colors}
              />
            )}
            {snapshot.totalInventoryValue !== undefined && (
              <StatCard
                label="Inventory"
                value={fmt(snapshot.totalInventoryValue)}
                icon="package"
                color="#8b5cf6"
                colors={colors}
              />
            )}
            {snapshot.cashBalance !== undefined && (
              <StatCard
                label="Cash"
                value={fmt(snapshot.cashBalance)}
                icon="dollar-sign"
                color={colors.success}
                colors={colors}
              />
            )}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.quickActions}>
        <Text style={styles.sectionTitle}>Quick Access</Text>
        <View style={styles.actionsRow}>
          <QuickAction
            icon="file-text"
            label="Invoices"
            color={colors.primary}
            colors={colors}
            onPress={() => router.push("/(tabs)/invoices")}
          />
          <QuickAction
            icon="users"
            label="Customers"
            color="#3b82f6"
            colors={colors}
            onPress={() => router.push("/(tabs)/customers")}
          />
          <QuickAction
            icon="credit-card"
            label="Payments"
            color={colors.success}
            colors={colors}
            onPress={() => router.push("/(tabs)/payments")}
          />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Invoices</Text>
          <Pressable onPress={() => router.push("/(tabs)/invoices")}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>

        {invLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : recentInvoices.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="file-text" size={32} color={colors.mutedForeground} />
            <Text style={styles.emptyText}>No invoices yet</Text>
          </View>
        ) : (
          <View style={styles.invList}>
            {recentInvoices.map((inv, idx) => {
              const balance = parseFloat(inv.balance ?? "0");
              const isPaid = balance <= 0;
              return (
                <Pressable
                  key={inv.id}
                  style={({ pressed }) => [
                    styles.invCard,
                    idx > 0 && styles.invCardBorder,
                    pressed && { backgroundColor: colors.muted },
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    router.push(`/invoice/${inv.id}`);
                  }}
                >
                  <View style={styles.invLeft}>
                    <Text style={styles.invNum}>{inv.invoiceNumber}</Text>
                    <Text style={styles.invCustomer} numberOfLines={1}>
                      {inv.customerName ?? `Customer #${inv.customerId}`}
                    </Text>
                  </View>
                  <View style={styles.invRight}>
                    <Text style={styles.invAmount}>{fmt(inv.totalAmount)}</Text>
                    <View style={styles.invMeta}>
                      <Text style={styles.invDate}>{formatDate(inv.date)}</Text>
                      <View
                        style={[
                          styles.invStatus,
                          {
                            backgroundColor: isPaid
                              ? colors.success + "20"
                              : colors.destructive + "20",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.invStatusText,
                            { color: isPaid ? colors.success : colors.destructive },
                          ]}
                        >
                          {isPaid ? "Paid" : "Due"}
                        </Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
  colors,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 14,
        padding: 16,
        width: 140,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: color + "15",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 10,
        }}
      >
        <Feather name={icon} size={18} color={color} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: "700" as const, color: colors.foreground }}>
        {value}
      </Text>
      <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  color,
  colors,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  color: string;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: 12,
        padding: 16,
        alignItems: "center",
        gap: 8,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.8 : 1,
      })}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: color + "15",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={22} color={color} />
      </View>
      <Text style={{ fontSize: 13, fontWeight: "600" as const, color: colors.foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) {
  const topInset = Platform.OS === "web" ? 67 : 0;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingBottom: bottomPad + 90 },
    topBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      padding: 20,
      paddingTop: topInset + 20,
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    greeting: { fontSize: 13, color: colors.mutedForeground },
    userName: { fontSize: 22, fontWeight: "700" as const, color: colors.foreground },
    companyName: { fontSize: 13, color: colors.primary, fontWeight: "600" as const, marginTop: 2 },
    logoutBtn: { padding: 8 },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 20,
    },
    loadingText: { fontSize: 14, color: colors.mutedForeground },
    sectionTitle: {
      fontSize: 13,
      fontWeight: "700" as const,
      color: colors.mutedForeground,
      textTransform: "uppercase" as const,
      letterSpacing: 0.8,
      marginBottom: 12,
    },
    statsRow: { paddingHorizontal: 16, paddingVertical: 4, gap: 10 },
    section: { paddingHorizontal: 16, marginTop: 20 },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    seeAll: { fontSize: 13, fontWeight: "600" as const, color: colors.primary },
    quickActions: { paddingHorizontal: 16, marginTop: 20 },
    actionsRow: { flexDirection: "row", gap: 10 },
    center: { padding: 20, alignItems: "center" },
    emptyBox: { alignItems: "center", gap: 8, padding: 24 },
    emptyText: { fontSize: 14, color: colors.mutedForeground },
    invList: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    invCard: { flexDirection: "row", padding: 14, alignItems: "center" },
    invCardBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    invLeft: { flex: 1, marginRight: 12 },
    invNum: { fontSize: 14, fontWeight: "700" as const, color: colors.foreground },
    invCustomer: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    invRight: { alignItems: "flex-end" },
    invAmount: { fontSize: 14, fontWeight: "700" as const, color: colors.foreground },
    invMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
    invDate: { fontSize: 11, color: colors.mutedForeground },
    invStatus: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
    invStatusText: { fontSize: 10, fontWeight: "700" as const },
  });
}
