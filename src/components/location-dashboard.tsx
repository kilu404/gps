"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const LocationMap = dynamic(() => import("@/components/location-map"), {
  ssr: false,
  loading: () => (
    <div className="map-placeholder">
      <span className="loading-dot" />
      Memuat peta...
    </div>
  ),
});

type LocationRecord = {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updated_at: string;
  profiles: { display_name: string | null; sharing_enabled: boolean } | null;
};

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function isFresh(value: string) {
  return Date.now() - new Date(value).getTime() < 2 * 60 * 1000;
}

export default function LocationDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setError("");
      setLocations([]);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const loadLocations = useCallback(async () => {
    if (!supabase || !session) return;
    setFetching(true);
    const { data, error: queryError } = await supabase
      .from("locations")
      .select(
        "user_id, latitude, longitude, accuracy, updated_at, profiles!inner(display_name, sharing_enabled)",
      )
      .eq("profiles.sharing_enabled", true)
      .order("updated_at", { ascending: false });
    setFetching(false);
    if (queryError) {
      setError(
        queryError.code === "42501"
          ? "Akun ini belum mendapat akses admin untuk melihat lokasi."
          : queryError.message,
      );
      return;
    }
    setError("");
    setLocations((data ?? []) as unknown as LocationRecord[]);
  }, [session]);

  useEffect(() => {
    if (!supabase || !session) return;
    const initialLoad = window.setTimeout(() => void loadLocations(), 0);
    const freshnessRefresh = window.setInterval(
      () => void loadLocations(),
      30_000,
    );
    const channel = supabase
      .channel("admin-locations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "locations" },
        () => void loadLocations(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        () => void loadLocations(),
      )
      .subscribe();
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(freshnessRefresh);
      void supabase?.removeChannel(channel);
    };
  }, [loadLocations, session]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signInError) setError(signInError.message);
  }

  async function signOut() {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
  }

  const freshCount = locations.filter((location) =>
    isFresh(location.updated_at),
  ).length;

  if (!isSupabaseConfigured) {
    return (
      <main className="setup-screen">
        <section className="setup-card">
          <div className="brand-mark">T</div>
          <p className="eyebrow">TRACKER / ADMIN</p>
          <h1>Siapkan koneksi Supabase</h1>
          <p>
            Dashboard ini siap digunakan. Tambahkan URL dan anon key Supabase
            ke <code>.env.local</code>, lalu jalankan migrasi database.
          </p>
          <div className="setup-steps">
            <span>1</span>
            <p>
              Salin <code>.env.example</code> menjadi <code>.env.local</code>.
            </p>
            <span>2</span>
            <p>
              Jalankan <code>supabase/migrations/001_location_sharing.sql</code>{" "}
              di SQL Editor Supabase.
            </p>
            <span>3</span>
            <p>
              Tambahkan akun admin ke tabel <code>admin_users</code>.
            </p>
          </div>
          <div className="privacy-note">
            <span aria-hidden="true">◆</span>
            Lokasi hanya dapat dibaca akun admin yang diizinkan.
          </div>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <div className="brand-mark">T</div>
          <p className="eyebrow">TRACKER / ADMIN</p>
          <h1>Selamat datang</h1>
          <p className="login-description">
            Masuk dengan akun admin untuk melihat pengguna yang sedang berbagi
            lokasi.
          </p>
          <form onSubmit={signIn} className="login-form">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@perusahaan.id"
              required
            />
            <label htmlFor="password">Kata sandi</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Masukkan kata sandi"
              required
            />
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Memeriksa..." : "Masuk ke dashboard"}
            </button>
          </form>
          <div className="privacy-note">
            <span aria-hidden="true">◆</span>
            Lokasi hanya terlihat oleh admin yang berwenang.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-mark small">T</div>
          <div>
            <strong>temu</strong>
            <span>LOCATION CONSOLE</span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="admin-email">{session.user.email}</span>
          <button className="text-button" onClick={signOut}>
            Keluar
          </button>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">OVERVIEW / LOKASI</p>
            <h1>Lokasi pengguna</h1>
            <p className="page-subtitle">
              Pantau lokasi terkini dari pengguna yang mengaktifkan berbagi.
            </p>
          </div>
          <div className="live-badge">
            <span className="live-dot" />
            Sinkronisasi aktif
          </div>
        </div>

        {error && <div className="alert-error">{error}</div>}

        <section className="stats-grid" aria-label="Ringkasan lokasi">
          <article className="stat-card">
            <div className="stat-label">SEDANG BERBAGI</div>
            <div className="stat-value">{locations.length}</div>
            <div className="stat-caption">pengguna mengaktifkan berbagi</div>
            <div className="stat-icon purple">↗</div>
          </article>
          <article className="stat-card">
            <div className="stat-label">LOKASI TERBARU</div>
            <div className="stat-value">{freshCount}</div>
            <div className="stat-caption">diperbarui dalam 2 menit terakhir</div>
            <div className="stat-icon green">◎</div>
          </article>
          <article className="stat-card">
            <div className="stat-label">PEMBARUAN</div>
            <div className="stat-value small-value">Realtime</div>
            <div className="stat-caption">
              {fetching ? "Memuat data..." : "data tersinkron otomatis"}
            </div>
            <div className="stat-icon orange">⟳</div>
          </article>
        </section>

        <section className="map-panel">
          <div className="panel-heading">
            <div>
              <h2>Peta pengguna</h2>
              <p>Lokasi terakhir yang dibagikan secara sukarela</p>
            </div>
            <span className="map-count">{locations.length} titik</span>
          </div>
          <LocationMap locations={locations} />
          <div className="map-attribution">
            Peta © OpenStreetMap contributors
          </div>
        </section>

        <section className="people-panel">
          <div className="panel-heading">
            <div>
              <h2>Pengguna aktif</h2>
              <p>Informasi lokasi terakhir yang diterima</p>
            </div>
            <button className="refresh-button" onClick={() => void loadLocations()}>
              {fetching ? "Memuat..." : "↻ Perbarui"}
            </button>
          </div>
          {locations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⌖</div>
              <strong>Belum ada lokasi dibagikan</strong>
              <span>
                Lokasi muncul di sini ketika pengguna memilih untuk mulai
                berbagi.
              </span>
            </div>
          ) : (
            <div className="people-list">
              {locations.map((location) => (
                <article className="person-row" key={location.user_id}>
                  <div className="avatar">
                    {(location.profiles?.display_name || "P")
                      .slice(0, 1)
                      .toUpperCase()}
                  </div>
                  <div className="person-details">
                    <strong>
                      {location.profiles?.display_name || "Pengguna"}
                    </strong>
                    <span>
                      {location.latitude.toFixed(5)},{" "}
                      {location.longitude.toFixed(5)}
                      {location.accuracy
                        ? ` · akurasi ±${Math.round(location.accuracy)} m`
                        : ""}
                    </span>
                  </div>
                  <div className="person-status">
                    <span
                      className={
                        isFresh(location.updated_at)
                          ? "status-dot fresh"
                          : "status-dot stale"
                      }
                    />
                    <span>
                      {isFresh(location.updated_at)
                        ? "Aktif"
                        : "Data lama"}{" "}
                      · {formatUpdatedAt(location.updated_at)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="dashboard-footer">
          <span>
            <span className="footer-shield">◆</span> Data lokasi hanya untuk
            penggunaan yang telah disetujui.
          </span>
          <span>Waktu ditampilkan dalam zona waktu perangkat admin.</span>
        </footer>
      </div>
    </main>
  );
}
