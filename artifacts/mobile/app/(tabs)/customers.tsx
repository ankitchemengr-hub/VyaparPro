import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
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

interface Entity {
  id: number;
  name: string;
  mobile?: string;
  gstin?: string;
  type: string;
  city?: string;
  outstanding?: string | number;
}

function formatAmount(val: string | number | undefined): string {
  if (val === undefined || val === null) return "₹0";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "₹0";
  return "₹" + num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const AVATAR_COLORS = [
  "#ff8800", "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444",
];

function avatarColor(id: number): string {
  return AVATAR_COLORS[id % AVATAR_COLORS.length] ?? "#ff8800";
}

export default function CustomersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<Entity[]>({
    queryKey: ["entities", "customer"],
    queryFn: () => apiGet<Entity[]>("/entities?type=customer"),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.mobile?.includes(q) ||
        e.gstin?.toLowerCase().includes(q) ||
        e.city?.toLowerCase().includes(q)
    );
  }, [data, search]);

  const styles = makeStyles(colors, insets);

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={colors.mutedForeground} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, mobile..."
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

      {data && (
        <Text style={styles.countText}>
          {filtered.length} {filtered.length === 1 ? "customer" : "customers"}
        </Text>
      )}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>Could not load customers</Text>
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
              <Feather name="users" size={40} color={colors.mutedForeground} />
              <Text style={styles.emptyTitle}>No customers found</Text>
              <Text style={styles.emptyText}>
                {search ? "Try a different search term" : "Customers will appear here"}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const outstanding = typeof item.outstanding === "string"
              ? parseFloat(item.outstanding)
              : (item.outstanding ?? 0);
            const hasBalance = outstanding > 0;

            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => Haptics.selectionAsync()}
              >
                <View
                  style={[styles.avatar, { backgroundColor: avatarColor(item.id) }]}
                >
                  <Text style={styles.avatarText}>{initials(item.name)}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.meta}>
                    {item.mobile ? (
                      <View style={styles.metaItem}>
                        <Feather name="phone" size={11} color={colors.mutedForeground} />
                        <Text style={styles.metaText}>{item.mobile}</Text>
                      </View>
                    ) : null}
                    {item.city ? (
                      <View style={styles.metaItem}>
                        <Feather name="map-pin" size={11} color={colors.mutedForeground} />
                        <Text style={styles.metaText}>{item.city}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={styles.balanceCol}>
                  <Text
                    style={[
                      styles.balanceAmt,
                      { color: hasBalance ? colors.destructive : colors.success },
                    ]}
                  >
                    {formatAmount(item.outstanding)}
                  </Text>
                  <Text style={styles.balanceLabel}>
                    {hasBalance ? "Due" : "Clear"}
                  </Text>
                </View>
              </Pressable>
            );
          }}
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
    countText: {
      fontSize: 12,
      color: colors.mutedForeground,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
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
    },
    cardPressed: { opacity: 0.8 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    avatarText: { fontSize: 15, fontWeight: "700" as const, color: "#ffffff" },
    info: { flex: 1, marginRight: 8 },
    name: { fontSize: 15, fontWeight: "600" as const, color: colors.foreground },
    meta: { flexDirection: "row", gap: 10, marginTop: 4 },
    metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
    metaText: { fontSize: 12, color: colors.mutedForeground },
    balanceCol: { alignItems: "flex-end" },
    balanceAmt: { fontSize: 15, fontWeight: "700" as const },
    balanceLabel: { fontSize: 11, color: colors.mutedForeground, marginTop: 2 },
  });
}
