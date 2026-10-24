import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useEffect, useState } from "react";
import {
  AppState,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { LOCATION_TASK_NAME } from "./src/lib/location-task";
import { isSupabaseConfigured, supabase } from "./src/lib/supabase";

type User = { id: string; email?: string };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sharing, setSharing] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) {
      return;
    }
    supabase.auth.startAutoRefresh();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase?.auth.startAutoRefresh();
      else supabase?.auth.stopAutoRefresh();
    });
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setMessage(error.message);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setSharing(false);
      setMessage("");
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      appStateSubscription.remove();
      void supabase?.auth.stopAutoRefresh();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user) return;
    let active = true;
    supabase
      .from("profiles")
      .select("sharing_enabled")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage(error.message);
        else setSharing(data.sharing_enabled);
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function authenticate() {
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const response = creatingAccount
      ? await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } },
        })
      : await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
    setBusy(false);
    if (response.error) {
      setMessage(response.error.message);
    } else if (creatingAccount && !response.data.session) {
      setMessage("Periksa email Anda untuk mengonfirmasi pendaftaran.");
      setCreatingAccount(false);
    }
  }

  async function startSharing() {
    if (!supabase || !user) return;
    setBusy(true);
    setMessage("");
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== "granted") {
        throw new Error(
          "Izin lokasi saat aplikasi digunakan diperlukan untuk memulai berbagi.",
        );
      }

      const background = await Location.requestBackgroundPermissionsAsync();
      if (background.status !== "granted") {
        throw new Error(
          "Izin lokasi latar belakang belum diberikan. Berbagi lokasi tidak dimulai.",
        );
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ sharing_enabled: true })
        .eq("id", user.id);
      if (profileError) throw profileError;

      try {
        const alreadyRunning =
          await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
        if (!alreadyRunning) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 30_000,
            distanceInterval: 0,
            pausesUpdatesAutomatically: false,
            foregroundService: {
              notificationTitle: "Temu sedang membagikan lokasi",
              notificationBody: "Ketuk untuk membuka pengaturan berbagi lokasi.",
              notificationColor: "#6c5ce7",
            },
            showsBackgroundLocationIndicator: true,
          });
        }

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { error: uploadError } = await supabase.from("locations").upsert(
          {
            user_id: user.id,
            latitude: current.coords.latitude,
            longitude: current.coords.longitude,
            accuracy: current.coords.accuracy,
          },
          { onConflict: "user_id" },
        );
        if (uploadError) throw uploadError;
      } catch (error) {
        let cleanupError: string | null = null;
        try {
          const registered = await TaskManager.isTaskRegisteredAsync(
            LOCATION_TASK_NAME,
          );
          if (registered) {
            await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
          }
        } catch (stopError) {
          cleanupError =
            stopError instanceof Error ? stopError.message : "task lokasi";
        }
        const { error: profileCleanupError } = await supabase
          .from("profiles")
          .update({ sharing_enabled: false })
          .eq("id", user.id);
        if (profileCleanupError) {
          cleanupError = [cleanupError, profileCleanupError.message]
            .filter(Boolean)
            .join("; ");
        }
        const originalMessage =
          error instanceof Error ? error.message : "Gagal memulai berbagi lokasi.";
        throw new Error(
          cleanupError
            ? `${originalMessage} Pembersihan juga gagal: ${cleanupError}`
            : originalMessage,
        );
      }
      setSharing(true);
      setMessage("Berbagi lokasi aktif. Anda dapat menghentikannya kapan saja.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Gagal memulai berbagi lokasi.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function stopSharing(): Promise<boolean> {
    if (!supabase || !user) return false;
    setBusy(true);
    setMessage("");
    const errors: string[] = [];
    try {
      const registered = await TaskManager.isTaskRegisteredAsync(
        LOCATION_TASK_NAME,
      );
      if (registered) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `Penghentian task perangkat gagal: ${error.message}`
          : "Penghentian task perangkat gagal.",
      );
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ sharing_enabled: false })
      .eq("id", user.id);
    if (profileError) errors.push(`Pembaruan server gagal: ${profileError.message}`);
    const { error: deleteError } = await supabase
      .from("locations")
      .delete()
      .eq("user_id", user.id);
    if (deleteError) errors.push(`Penghapusan lokasi gagal: ${deleteError.message}`);
    setSharing(false);
    setBusy(false);
    if (errors.length) {
      setMessage(`Berbagi dihentikan di perangkat. ${errors.join(" ")}`);
      return false;
    }
    setMessage("Berbagi dihentikan dan lokasi terakhir dihapus.");
    return true;
  }

  async function resetPassword() {
    if (!supabase) return;
    if (!email.trim()) {
      setMessage("Masukkan email untuk mengirim tautan reset.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setMessage(
      error
        ? error.message
        : "Jika email terdaftar, tautan reset akan dikirim.",
    );
  }

  async function signOut() {
    if (!supabase) return;
    const client = supabase;
    if (sharing) {
      Alert.alert(
        "Hentikan berbagi lokasi?",
        "Berbagi lokasi perlu dihentikan sebelum Anda keluar.",
        [
          { text: "Batal", style: "cancel" },
          {
            text: "Hentikan dan keluar",
            style: "destructive",
            onPress: async () => {
              const stopped = await stopSharing();
              if (!stopped) return;
              const { error } = await client.auth.signOut();
              if (error) setMessage(error.message);
            },
          },
        ],
      );
      return;
    }
    const { error } = await client.auth.signOut();
    if (error) setMessage(error.message);
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#6c5ce7" />
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Text style={styles.brandLetter}>T</Text>
          </View>
          <View>
            <Text style={styles.brandName}>temu</Text>
            <Text style={styles.brandCaption}>LOCATION SHARING</Text>
          </View>
        </View>

        {!isSupabaseConfigured ? (
          <View style={styles.card}>
            <Text style={styles.eyebrow}>PENYIAPAN</Text>
            <Text style={styles.title}>Hubungkan Supabase</Text>
            <Text style={styles.body}>
              Salin <Text style={styles.inlineCode}>.env.example</Text> menjadi{" "}
              <Text style={styles.inlineCode}>.env</Text>, lalu isi URL dan
              anon key proyek Supabase.
            </Text>
          </View>
        ) : !user ? (
          <View style={styles.card}>
            <Text style={styles.eyebrow}>BERBAGI DENGAN AMAN</Text>
            <Text style={styles.title}>
              {creatingAccount ? "Buat akun" : "Selamat datang"}
            </Text>
            <Text style={styles.body}>
              Lokasi hanya dibagikan setelah Anda memberi izin dan menekan
              tombol mulai.
            </Text>
            {creatingAccount && (
              <>
                <Text style={styles.label}>Nama tampilan</Text>
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Nama Anda"
                  style={styles.input}
                  autoCapitalize="words"
                />
              </>
            )}
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="nama@email.com"
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Text style={styles.label}>Kata sandi</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Minimal 8 karakter"
              style={styles.input}
              secureTextEntry
              autoComplete={creatingAccount ? "new-password" : "password"}
            />
            {!!message && <Text style={styles.message}>{message}</Text>}
            <Text
              onPress={() => {
                setCreatingAccount((value) => !value);
                setMessage("");
              }}
              style={styles.modeToggle}
            >
              {creatingAccount
                ? "Sudah punya akun? Masuk"
                : "Belum punya akun? Daftar"}
            </Text>
            <Text
              onPress={() => void resetPassword()}
              style={styles.forgotPassword}
            >
              Lupa kata sandi?
            </Text>
            <Text
              onPress={() => {
                if (!busy && email.trim() && password.length >= 8) {
                  void authenticate();
                } else if (password.length < 8) {
                  setMessage("Kata sandi harus memiliki minimal 8 karakter.");
                }
              }}
              style={[styles.button, busy && styles.buttonDisabled]}
            >
              {busy ? "Memproses..." : creatingAccount ? "Daftar" : "Masuk"}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.welcome}>
              <Text style={styles.eyebrow}>AKUN ANDA</Text>
              <Text style={styles.title}>Halo, {user.email}</Text>
              <Text style={styles.body}>
                Anda memegang kendali atas kapan lokasi dibagikan.
              </Text>
            </View>
            <View style={styles.consentCard}>
              <View style={styles.consentIcon}>
                <Text style={styles.consentIconText}>⌖</Text>
              </View>
              <Text style={styles.consentTitle}>Berbagi lokasi</Text>
              <Text style={styles.body}>
                {sharing
                  ? "Admin yang berwenang dapat melihat lokasi terakhir Anda. Pembaruan berjalan di latar belakang."
                  : "Lokasi Anda tidak sedang dibagikan. Aktifkan hanya jika Anda setuju admin melihat lokasi."}
              </Text>
              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>
                    {sharing ? "Berbagi aktif" : "Berbagi nonaktif"}
                  </Text>
                  <Text style={styles.toggleDescription}>
                    Pembaruan sekitar tiap 30 detik jika OS mengizinkan
                  </Text>
                </View>
                {busy ? (
                  <ActivityIndicator color="#6c5ce7" />
                ) : (
                  <Switch
                    value={sharing}
                    onValueChange={(enabled) => {
                      if (enabled) {
                        Alert.alert(
                          "Setujui berbagi lokasi",
                          "Admin yang berwenang akan melihat lokasi Anda saat berbagi aktif. Lokasi terakhir akan dihapus ketika Anda menghentikan berbagi. Perangkat dapat membatasi frekuensi pembaruan.",
                          [
                            { text: "Batal", style: "cancel" },
                            {
                              text: "Setuju & mulai",
                              onPress: () => void startSharing(),
                            },
                          ],
                        );
                      } else {
                        void stopSharing();
                      }
                    }}
                    trackColor={{ false: "#d9d8e0", true: "#c4bdfa" }}
                    thumbColor={sharing ? "#6c5ce7" : "#fff"}
                  />
                )}
              </View>
              {!!message && <Text style={styles.message}>{message}</Text>}
              {sharing && (
                <Text onPress={() => void stopSharing()} style={styles.stopLink}>
                  Hentikan berbagi sekarang
                </Text>
              )}
            </View>
            <View style={styles.privacyCard}>
              <Text style={styles.privacyTitle}>Privasi Anda</Text>
              <Text style={styles.privacyText}>
                • Hanya admin terverifikasi dapat membaca lokasi.{"\n"}
                • Tidak ada riwayat perjalanan yang disimpan.{"\n"}
                • Hentikan berbagi kapan saja dari aplikasi ini.
              </Text>
            </View>
            <Text onPress={() => void signOut()} style={styles.signOut}>
              Keluar dari akun
            </Text>
          </>
        )}
        {!user && !!message && isSupabaseConfigured && (
          <Text style={[styles.message, styles.authMessage]}>{message}</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8f8fb" },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8f8fb",
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 62,
    paddingBottom: 42,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 31 },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#6c5ce7",
    alignItems: "center",
    justifyContent: "center",
  },
  brandLetter: { color: "#fff", fontSize: 21, fontWeight: "700" },
  brandName: { color: "#252432", fontSize: 17, fontWeight: "700" },
  brandCaption: {
    marginTop: 2,
    color: "#9997a5",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  card: {
    padding: 23,
    borderWidth: 1,
    borderColor: "#eeedf3",
    borderRadius: 17,
    backgroundColor: "#fff",
  },
  eyebrow: {
    marginBottom: 9,
    color: "#8178c4",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  title: { color: "#232230", fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
  body: { marginTop: 9, color: "#777684", fontSize: 12, lineHeight: 19 },
  inlineCode: { color: "#6254cf", fontWeight: "600" },
  label: { marginTop: 17, marginBottom: 7, color: "#484754", fontSize: 11, fontWeight: "600" },
  input: {
    height: 45,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#e7e6ed",
    borderRadius: 8,
    backgroundColor: "#fff",
    color: "#252432",
    fontSize: 13,
  },
  modeToggle: { marginTop: 18, color: "#6456d1", fontSize: 12, fontWeight: "600", textAlign: "center" },
  forgotPassword: { marginTop: 14, color: "#817f8e", fontSize: 11, textAlign: "center" },
  button: {
    overflow: "hidden",
    marginTop: 22,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: "#6c5ce7",
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  buttonDisabled: { opacity: 0.55 },
  message: { marginTop: 13, color: "#6253cc", fontSize: 11, lineHeight: 17 },
  authMessage: { textAlign: "center" },
  welcome: { marginBottom: 19 },
  consentCard: {
    padding: 22,
    borderWidth: 1,
    borderColor: "#eeedf3",
    borderRadius: 16,
    backgroundColor: "#fff",
  },
  consentIcon: {
    width: 39,
    height: 39,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#f0edff",
  },
  consentIconText: { color: "#6c5ce7", fontSize: 24 },
  consentTitle: { color: "#252432", fontSize: 15, fontWeight: "700" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 22,
    paddingTop: 17,
    borderTopWidth: 1,
    borderTopColor: "#f0eff4",
  },
  toggleCopy: { flex: 1 },
  toggleTitle: { color: "#343341", fontSize: 12, fontWeight: "700" },
  toggleDescription: { marginTop: 5, color: "#9795a1", fontSize: 10, lineHeight: 15 },
  stopLink: { marginTop: 17, color: "#b43b4b", fontSize: 11, fontWeight: "600" },
  privacyCard: {
    marginTop: 13,
    padding: 19,
    borderWidth: 1,
    borderColor: "#eeedf3",
    borderRadius: 14,
    backgroundColor: "#fff",
  },
  privacyTitle: { color: "#343341", fontSize: 12, fontWeight: "700" },
  privacyText: { marginTop: 8, color: "#777684", fontSize: 11, lineHeight: 20 },
  signOut: { marginTop: 24, color: "#898794", fontSize: 11, textAlign: "center" },
});
