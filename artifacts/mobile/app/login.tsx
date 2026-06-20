import { Feather } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
        setCompanies(list ?? []);
        if (list?.length === 1) {
          setSelectedCompanyId(list[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setCompaniesLoaded(true));
  }, []);

  if (user) {
    return <Redirect href="/(tabs)/" />;
  }

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError("Enter username and password");
      return;
    }
    if (companies.length > 1 && selectedCompanyId == null) {
      setError("Please select a company");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await login(username.trim(), password, selectedCompanyId);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Login failed";
      setError(msg);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const styles = makeStyles(colors, insets);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.logoRing}>
            <Feather name="bar-chart-2" size={36} color="#ffffff" />
          </View>
          <Text style={styles.appName}>Vipro ERP</Text>
          <Text style={styles.tagline}>Business Management System</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign In</Text>

          {/* Company selector — shown only when multiple companies */}
          {companiesLoaded && companies.length > 1 && (
            <View style={styles.field}>
              <Text style={styles.label}>Company</Text>
              <View style={styles.companyList}>
                {companies.map((c) => (
                  <Pressable
                    key={c.id}
                    style={[
                      styles.companyChip,
                      selectedCompanyId === c.id && styles.companyChipActive,
                    ]}
                    onPress={() => setSelectedCompanyId(c.id)}
                  >
                    <Feather
                      name="briefcase"
                      size={13}
                      color={
                        selectedCompanyId === c.id ? "#ffffff" : colors.mutedForeground
                      }
                    />
                    <Text
                      style={[
                        styles.companyChipText,
                        selectedCompanyId === c.id && styles.companyChipTextActive,
                      ]}
                    >
                      {c.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Single company — show as read-only badge */}
          {companiesLoaded && companies.length === 1 && (
            <View style={styles.singleCompanyRow}>
              <Feather name="briefcase" size={13} color={colors.primary} />
              <Text style={styles.singleCompanyName}>{companies[0]?.name}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <View style={styles.inputWrapper}>
              <Feather
                name="user"
                size={16}
                color={colors.mutedForeground}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Enter username"
                placeholderTextColor={colors.mutedForeground}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrapper}>
              <Feather
                name="lock"
                size={16}
                color={colors.mutedForeground}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, styles.inputFlex]}
                placeholder="Enter password"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                onPress={() => setShowPassword((v) => !v)}
                style={styles.eyeBtn}
                activeOpacity={0.6}
              >
                <Feather
                  name={showPassword ? "eye-off" : "eye"}
                  size={16}
                  color={colors.mutedForeground}
                />
              </TouchableOpacity>
            </View>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.loginBtn,
              (loading || !companiesLoaded) && styles.loginBtnDisabled,
              pressed && styles.loginBtnPressed,
            ]}
            onPress={handleLogin}
            disabled={loading || !companiesLoaded}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(
  colors: ReturnType<typeof useColors>,
  insets: ReturnType<typeof useSafeAreaInsets>
) {
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.primary },
    scroll: {
      flexGrow: 1,
      paddingTop: topInset,
      paddingBottom: bottomInset + 24,
    },
    hero: {
      alignItems: "center",
      paddingTop: 40,
      paddingBottom: 40,
    },
    logoRing: {
      width: 80,
      height: 80,
      borderRadius: 20,
      backgroundColor: "rgba(255,255,255,0.2)",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    appName: {
      fontSize: 28,
      fontWeight: "700" as const,
      color: "#ffffff",
      letterSpacing: 0.5,
    },
    tagline: { fontSize: 13, color: "rgba(255,255,255,0.75)", marginTop: 4 },
    card: {
      marginHorizontal: 20,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 24,
    },
    cardTitle: {
      fontSize: 20,
      fontWeight: "700" as const,
      color: colors.foreground,
      marginBottom: 20,
    },
    singleCompanyRow: {
      flexDirection: "row" as const,
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 16,
    },
    singleCompanyName: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: colors.primary,
    },
    field: { marginBottom: 16 },
    label: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: colors.mutedForeground,
      marginBottom: 6,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
    },
    companyList: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
    companyChip: {
      flexDirection: "row" as const,
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.muted,
    },
    companyChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    companyChipText: {
      fontSize: 13,
      fontWeight: "500" as const,
      color: colors.mutedForeground,
    },
    companyChipTextActive: { color: "#ffffff" },
    inputWrapper: {
      flexDirection: "row" as const,
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.muted,
      paddingHorizontal: 12,
    },
    inputIcon: { marginRight: 8 },
    input: { flex: 1, height: 46, fontSize: 15, color: colors.foreground },
    inputFlex: { flex: 1 },
    eyeBtn: { padding: 4 },
    errorBox: {
      flexDirection: "row" as const,
      alignItems: "center",
      gap: 6,
      backgroundColor: "#fef2f2",
      borderRadius: 8,
      padding: 10,
      marginBottom: 12,
    },
    errorText: { fontSize: 13, color: colors.destructive, flex: 1 },
    loginBtn: {
      height: 50,
      backgroundColor: colors.primary,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
    },
    loginBtnDisabled: { opacity: 0.7 },
    loginBtnPressed: { opacity: 0.85 },
    loginBtnText: { fontSize: 16, fontWeight: "700" as const, color: "#ffffff" },
  });
}
