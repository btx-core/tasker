/**
 * TIDAK ADA string UI di komponen (i18n.md §2, T-I18N1).
 * Semua teks datang dari sini. Uji memastikan komponen tidak berisi literal
 * teks yang terlihat pengguna.
 */
export const S = {
  boardTitle: "Papan",
  loading: "Memuat papan…",
  empty: "Belum ada task di sini",
  errorGeneric: "Gagal memuat papan",
  errorConflict: "Task sudah diubah orang lain",
  errorConflictHint: "Pilih versi yang ingin dipertahankan.",
  errorForbidden: "Anda tidak berwenang mengubah task ini",
  errorNotFound: "Task tidak lagi tersedia",
  retry: "Coba lagi",
  truncated: "Lihat semua",
  conflictKeepMine: "Pertahankan versi saya",
  conflictKeepTheirs: "Pakai versi server",
  traceLabel: "ID pelacakan",
  movedBack: "Perubahan dibatalkan, kartu dikembalikan",
  offline: "Koneksi terputus, mencoba lagi…",
  resync: "Menyegarkan data…",

  // --- Login (FR-112) ---
  loginTitle: "Masuk ke Kelindan",
  loginEmail: "Email",
  loginPassword: "Password",
  loginSubmit: "Masuk",
  loginSubmitting: "Sedang masuk…",
  /**
   * Pesan ini SENGAJA tidak membedakan "email tidak terdaftar" dan "password
   * salah" — server juga tidak. Kalimat yang membedakan akan mengubah halaman
   * login menjadi alat untuk mencari tahu siapa saja yang punya akun.
   */
  loginFailed: "Email atau password salah",
  loginUnverified: "Email Anda belum diverifikasi",
  loginRateLimited: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
  loginNetwork: "Tidak bisa menghubungi server. Periksa koneksi Anda.",
  logout: "Keluar",
  logoutAll: "Keluar dari semua perangkat",
} as const;

export type StringKey = keyof typeof S;
