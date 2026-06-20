import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface CompanyOption {
  id: number;
  name: string;
}

export default function LoginScreen() {
  const { user, login } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInput>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [companiesLoaded, setCompaniesLoaded] = useState(false);

  useEffect(() => {
    const base = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
    fetch(`${base}/api/system/companies-public`)
      .then((r) => r.json())
      .then((list: CompanyOption[]) => {
        const valid = Array.isArray(list) ? list : [];
        setCompanies(valid);
        if (valid.length === 1) {
          setSelectedCompanyId(valid[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setCompaniesLoaded(true));
  }, []);

  const handleLogin = async () => {
    if (!username.trim()) {
      setError("Please enter your username");
      return;
    }
    if (!password.trim()) {
      setError("Please enter your password");
      return;
    }
    if (companies.length > 1 && selectedCompanyId == null) {
      setError("Please select a company first");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await login(username.trim(), password, selectedCompanyId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Login failed. Check your credentials.";
      setError(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  const topInset = Platform.OS === "web" ? 60 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.primary }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topInset, paddingBottom: bottomInset + 24 },
        ]}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.logoRing}>
            <Feather name="bar-chart-2" size={36} color="#ffffff" />
          </View>
          <Text style={styles.appName}>Vipro ERP</Text>
          <Text style={styles.tagline}>Business Management System</Text>
        </View>

        {/* Card */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Sign In</Text>

          {/* Company chips — only when multiple */}
          {companiesLoaded && companies.length > 1 && (
            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  COMPANY
                </Text>
                {selectedCompanyId != null && (
                  <TouchableOpacity
                    onPress={() => setSelectedCompanyId(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[styles.clearBtn, { color: colors.primary }]}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.chipRow}>
                {companies.map((c) => {
                  const active = selectedCompanyId === c.id;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[
                        styles.chip,
                        { borderColor: colors.border, backgroundColor: colors.muted },
                        active && { backgroundColor: colors.primary, borderColor: colors.primary },
                      ]}
                      onPress={() => setSelectedCompanyId(c.id)}
                      activeOpacity={0.7}
                    >
                      <Feather
                        name="briefcase"
                        size={13}
                        color={active ? "#ffffff" : colors.mutedForeground}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          { color: colors.mutedForeground },
                          active && { color: "#ffffff" },
                        ]}
                      >
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Single company badge */}
          {companiesLoaded && companies.length === 1 && (
            <View style={[styles.singleBadge, { backgroundColor: colors.accent }]}>
              <Feather name="briefcase" size={13} color={colors.primary} />
              <Text style={[styles.singleBadgeText, { color: colors.primary }]}>
                {companies[0]?.name}
              </Text>
            </View>
          )}

          {/* Username */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>USERNAME</Text>
            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.muted }]}>
              <Feather name="user" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Enter username"
                placeholderTextColor={colors.mutedForeground}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!loading}
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>PASSWORD</Text>
            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.muted }]}>
              <Feather name="lock" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
              <TextInput
                ref={passwordRef}
                style={[styles.input, styles.inputFlex, { color: colors.foreground }]}
                placeholder="Enter password"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                editable={!loading}
              />
              <TouchableOpacity
                onPress={() => setShowPassword((v) => !v)}
                style={styles.eyeBtn}
                activeOpacity={0.6}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Feather
                  name={showPassword ? "eye-off" : "eye"}
                  size={16}
                  color={colors.mutedForeground}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Error */}
          {!!error && (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={14} color="#dc2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Sign In button */}
          <TouchableOpacity
            style={[
              styles.signInBtn,
              { backgroundColor: colors.primary },
              loading && styles.signInBtnDisabled,
            ]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.signInBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
  hero: { alignItems: "center", paddingTop: 40, paddingBottom: 40 },
  logoRing: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  appName: { fontSize: 28, fontWeight: "700", color: "#ffffff", letterSpacing: 0.5 },
  tagline: { fontSize: 13, color: "rgba(255,255,255,0.75)", marginTop: 4 },
  card: { marginHorizontal: 20, borderRadius: 16, padding: 24 },
  cardTitle: { fontSize: 20, fontWeight: "700", marginBottom: 20 },
  field: { marginBottom: 16 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  clearBtn: { fontSize: 12, fontWeight: "600" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: "500" },
  singleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  singleBadgeText: { fontSize: 13, fontWeight: "600" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, height: 48, fontSize: 15 },
  inputFlex: { flex: 1 },
  eyeBtn: { padding: 4 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  errorText: { fontSize: 13, color: "#dc2626", flex: 1 },
  signInBtn: {
    height: 52,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  signInBtnDisabled: { opacity: 0.7 },
  signInBtnText: { fontSize: 16, fontWeight: "700", color: "#ffffff" },
});
