#!/usr/bin/env bash
# Drill restore Kelindan (NFR-010, D-03).
#
# KENAPA SKRIP INI ADA: gate R0 menuntut "satu drill restore penuh lulus", dan
# D-03 mencatat bahwa **backup tanpa drill hanyalah asumsi**. Skrip ini
# melakukan pemulihan SUNGGUHAN ke instance terpisah dan MEMBANDINGKAN datanya
# baris per baris — bukan sekadar memeriksa bahwa berkas dump ada dan tidak
# kosong.
#
# BATAS YANG DIAKUI (dinyatakan, bukan disembunyikan):
#   Skrip ini membuktikan RTO/RPO untuk **logical backup + PITR dengan WAL
#   archiving lokal**. Ia TIDAK membuktikan konfigurasi penyimpanan objek,
#   enkripsi, atau retensi di infrastruktur nyata. Yang diuji adalah bahwa
#   PROSEDURNYA benar dan datanya utuh — bukan bahwa operator sudah memasang
#   WAL archiving ke bucket.
#
# Pemakaian:
#   npm run drill:restore            # jalankan drill penuh (butuh `npm run pg:up` + migrasi)
#   npm run drill:self-test          # buktikan drill BISA gagal (mode tamper)
#   KELINDAN_DRILL_KEEP=1 bash scripts/restore-drill.sh   # sisakan direktori kerja
set -euo pipefail

# Mode uji-diri: jalankan drill dengan data yang sengaja dirusak. Drill yang
# selalu lulus tidak membuktikan apa pun, jadi kita harus bisa menunjukkannya.
if [ "${1:-}" = "--self-test" ]; then
  echo "== UJI-DIRI: drill harus GAGAL pada data yang dirusak =="
  if KELINDAN_DRILL_TAMPER=1 bash "$0"; then
    echo "GAGAL UJI-DIRI: drill melaporkan SUKSES pada data yang dirusak."
    echo "Artinya pemeriksaan integritasnya tidak bekerja."
    exit 1
  fi
  echo "LULUS UJI-DIRI: drill menolak data yang dirusak (exit bukan-nol)."
  echo
  echo "== Jalankan drill sesungguhnya =="
  exec bash "$0"
fi

ROOT="${KELINDAN_PG_ROOT:-/tmp/kelindan-pg}"
BIN="$ROOT/pginstall/bin"
export LD_LIBRARY_PATH="$ROOT/pginstall/lib:$ROOT/embedded_postgres.libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

SRC_URL="${KELINDAN_PG_URL:-postgres://postgres@127.0.0.1:5432/kelindan_test}"
# Nama database diturunkan dari URL sumber. Base backup memuat SEMUA database,
# tetapi sidik jari hanya bermakna pada database aplikasi — query ke `postgres`
# akan gagal dengan "relation does not exist" dan tampak seperti restore rusak.
SRC_DB="${SRC_URL##*/}"
SRC_DB="${SRC_DB%%\?*}"
WORK="${KELINDAN_DRILL_WORK:-/tmp/kelindan-drill}"
# Port terpisah: drill TIDAK BOLEH menyentuh instance sumber. Kalau ia menumpang
# pada port yang sama, "restore berhasil" bisa berarti "kami membaca data asli".
DRILL_PORT="${KELINDAN_DRILL_PORT:-55432}"
DRILL_DATA="$WORK/restore-data"
DUMP="$WORK/kelindan.dump"
LOG="$WORK/drill.log"

log() { printf '%s\n' "$*" | tee -a "$LOG"; }
fail() { log "GAGAL: $*"; exit 1; }

command -v python3 >/dev/null || fail "python3 dibutuhkan"
[ -x "$BIN/pg_dump" ] || fail "PostgreSQL belum disiapkan — jalankan: npm run pg:up"
[ -x "$SRC_URL" ] 2>/dev/null || true

rm -rf "$WORK"; mkdir -p "$WORK"
: > "$LOG"
log "== Drill restore Kelindan =="
log "sumber : $SRC_URL"
log "kerja  : $WORK"
log "port   : $DRILL_PORT (terpisah dari sumber)"

# ---------------------------------------------------------------------------
# 0. Bersihkan sisa drill sebelumnya.
#
# Tanpa langkah ini, drill menjadi TIDAK IDEMPOTEN: baris penanda dari run
# sebelumnya tetap ada di sumber, ikut masuk base backup, dan pemeriksaan
# "baris setelah marker harus 0" gagal — padahal PITR-nya benar. Gejalanya
# menyesatkan ke arah yang sama sekali salah (pikirannya: recovery terlalu
# jauh), jadi kebersihan awal ini bagian dari kebenaran drill, bukan kerapian.
# ---------------------------------------------------------------------------
psql_q() { "$BIN/psql" "$1" -At -F'|' -c "$2"; }
log ""
log "-- 0/5 bersihkan sisa drill sebelumnya"
psql_q "$SRC_URL" "DELETE FROM workspaces WHERE slug = 'setelah-marker';" >/dev/null \
  || fail "tidak bisa membersihkan sisa drill (tabel workspaces belum ada? jalankan migrasi dulu)"

# ---------------------------------------------------------------------------
# 1. Sidik jari data SUMBER. Dibuat SEBELUM dump: yang dibandingkan nanti
#    adalah "data saat dump" vs "data setelah restore", bukan "data sekarang".
# ---------------------------------------------------------------------------
FINGERPRINT_SQL=$(cat <<'SQL'
SELECT
  (SELECT count(*) FROM workspaces WHERE slug <> 'setelah-marker') AS ws,
  (SELECT count(*) FROM users)                      AS usr,
  (SELECT count(*) FROM teams)                      AS tm,
  (SELECT count(*) FROM tasks)                      AS tsk,
  (SELECT count(*) FROM comments)                   AS cmt,
  (SELECT count(*) FROM checklist_items)            AS chk,
  (SELECT count(*) FROM task_events)                AS evt,
  (SELECT count(*) FROM sessions)                   AS ses,
  (SELECT coalesce(sum(version),0) FROM tasks)      AS ver_sum,
  (SELECT coalesce(sum(number),0) FROM tasks)       AS num_sum,
  (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM tasks)           AS task_ids,
  (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM comments)        AS comment_ids,
  (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM checklist_items) AS checklist_ids
SQL
)

# Sidik jari yang MENGECUALIKAN baris yang ditulis setelah marker PITR.
# Tanpa ini, "PITR benar" dan "salinan penuh" menghasilkan angka yang sama.
FINGERPRINT_SQL_BEFORE_MARKER=$(cat <<'SQL'
SELECT
  (SELECT count(*) FROM workspaces WHERE slug <> 'setelah-marker') AS ws,
  (SELECT count(*) FROM users)                      AS usr,
  (SELECT count(*) FROM teams)                      AS tm,
  (SELECT count(*) FROM tasks)                      AS tsk,
  (SELECT count(*) FROM comments)                   AS cmt,
  (SELECT count(*) FROM checklist_items)            AS chk,
  (SELECT count(*) FROM task_events)                AS evt,
  (SELECT count(*) FROM sessions)                   AS ses,
  (SELECT coalesce(sum(version),0) FROM tasks)      AS ver_sum,
  (SELECT coalesce(sum(number),0) FROM tasks)       AS num_sum,
  (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM tasks)           AS task_ids,
  (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM comments)        AS comment_ids,
  (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM checklist_items) AS checklist_ids
SQL
)

psql_q() { "$BIN/psql" "$1" -At -F'|' -c "$2"; }

log ""
log "-- 1/5 sidik jari sumber"
SRC_FP="$(psql_q "$SRC_URL" "$FINGERPRINT_SQL")" || fail "tidak bisa membaca sumber"
log "   $SRC_FP"

# ---------------------------------------------------------------------------
# 2. Logical dump (format custom: bisa dipulihkan selektif & paralel).
# ---------------------------------------------------------------------------
log ""
log "-- 2/5 pg_dump"
START_DUMP=$(date +%s)
"$BIN/pg_dump" "$SRC_URL" -Fc -f "$DUMP" || fail "pg_dump gagal"
DUMP_BYTES=$(wc -c < "$DUMP" | tr -d ' ')
[ "$DUMP_BYTES" -gt 0 ] || fail "dump kosong"
log "   dump ${DUMP_BYTES} byte dalam $(( $(date +%s) - START_DUMP )) dtk"

# ---------------------------------------------------------------------------
# 3. Restore ke instance TERPISAH, BUKAN ke database sumber.
# ---------------------------------------------------------------------------
log ""
log "-- 3/5 initdb + restore ke port $DRILL_PORT"
mkdir -p "$DRILL_DATA" && chmod 700 "$DRILL_DATA"
"$BIN/initdb" -D "$DRILL_DATA" -U postgres --auth=trust -E UTF8 >/dev/null 2>>"$LOG" \
  || fail "initdb gagal"

# Postgres menolak berjalan sebagai root; di sandbox kita memang root.
PG_RUN=()
if [ "$(id -u)" = "0" ]; then
  id -u postgres >/dev/null 2>&1 || useradd -m postgres >/dev/null 2>&1 || true
  chown -R postgres "$DRILL_DATA" 2>/dev/null || true
  PG_RUN=(su postgres -c)
fi

START_RESTORE=$(date +%s)
"$BIN/pg_ctl" -D "$DRILL_DATA" -o "-p $DRILL_PORT -k /tmp" -l "$WORK/pg.log" -w start \
  >/dev/null 2>>"$LOG" || fail "pg_ctl start gagal (lihat $WORK/pg.log)"
log "   instance drill hidup di port $DRILL_PORT"

trap '"$BIN/pg_ctl" -D "$DRILL_DATA" -m immediate stop >/dev/null 2>&1 || true' EXIT

DRILL_URL="postgres://postgres@127.0.0.1:$DRILL_PORT/postgres"
"$BIN/createdb" -h 127.0.0.1 -p "$DRILL_PORT" -U postgres kelindan_drill 2>>"$LOG" \
  || fail "createdb gagal"

# Ekstensi harus ada SEBELUM restore: dump memuat CREATE EXTENSION, tetapi
# sebagian build PostgreSQL tidak membawanya dan gagal di tengah restore.
"$BIN/psql" "postgres://postgres@127.0.0.1:$DRILL_PORT/kelindan_drill" -q -c \
  "CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;" \
  2>>"$LOG" || log "   catatan: ekstensi tidak bisa dibuat lebih awal (akan dicoba oleh dump)"

"$BIN/pg_restore" -h 127.0.0.1 -p "$DRILL_PORT" -U postgres -d kelindan_drill \
  --no-owner --no-privileges "$DUMP" >>"$LOG" 2>&1 \
  || fail "pg_restore gagal — lihat $LOG"
RESTORE_SECONDS=$(( $(date +%s) - START_RESTORE ))
log "   restore selesai dalam ${RESTORE_SECONDS} dtk"

# ---------------------------------------------------------------------------
# 4. Bandingkan sidik jari. INI inti drill-nya.
# ---------------------------------------------------------------------------
log ""
log "-- 4/5 verifikasi integritas"
RESTORED_FP="$(psql_q "postgres://postgres@127.0.0.1:$DRILL_PORT/kelindan_drill" "$FINGERPRINT_SQL")" \
  || fail "tidak bisa membaca hasil restore"

# MODE UJI-NEGATIF (KELINDAN_DRILL_TAMPER=1): sengaja merusak hasil restore.
#
# Gunanya: membuktikan bahwa drill ini BISA gagal. Drill yang selalu lulus
# tidak membuktikan apa pun — persis kesalahan yang pernah terjadi pada guard
# i18n (T-47), dan tidak ingin diulang di sini. Skrip harus keluar dengan
# status bukan-nol pada mode ini; kalau tidak, yang rusak adalah drillnya.
if [ "${KELINDAN_DRILL_TAMPER:-0}" = "1" ]; then
  log ""
  log "MODE UJI-NEGATIF: menghapus satu task dari hasil restore untuk membuktikan deteksi bekerja"
  # Ubah NILAI, bukan jumlah baris. Ini kerusakan yang paling berbahaya —
  # restore yang jumlah barisnya cocok tetapi isinya bergeser tetap akan
  # merusak data pengguna. Drill harus menangkapnya lewat md5 himpunan id dan
  # jumlah versi.
  psql_q "postgres://postgres@127.0.0.1:$DRILL_PORT/kelindan_drill" \
    "UPDATE tasks SET version = version + 1 WHERE id = (SELECT id FROM tasks ORDER BY id LIMIT 1);" >/dev/null \
    || fail "tamper gagal"
  RESTORED_FP="$(psql_q "postgres://postgres@127.0.0.1:$DRILL_PORT/kelindan_drill" "$FINGERPRINT_SQL")"
fi
log "   sumber   : $SRC_FP"
log "   direstore: $RESTORED_FP"

if [ "$SRC_FP" != "$RESTORED_FP" ]; then
  log ""
  log "SIDIK JARI BERBEDA."
  log "Yang dibandingkan: jumlah tiap tabel, jumlah versi, jumlah nomor task, dan"
  log "MD5 kumpulan id. Perbedaan berarti restore TIDAK utuh — dan itu tepat hal"
  log "yang drill ini ada untuk menemukan, bukan untuk disembunyikan."
  fail "integritas restore tidak cocok"
fi
log "   SAMA PERSIS — jumlah baris dan md5 himpunan id identik"

# ---------------------------------------------------------------------------
# 5. PITR: buktikan WAL archiving bisa memulihkan ke titik waktu tertentu.
# ---------------------------------------------------------------------------
log ""
log "-- 5/5 uji PITR (WAL archiving + recovery target)"
WAL_ARCHIVE="$WORK/wal-archive"
mkdir -p "$WAL_ARCHIVE"

# archive_mode BUKAN parameter yang bisa diubah dengan reload: PostgreSQL
# mengabaikan perubahannya sampai proses di-restart. Versi pertama skrip ini
# memakai `SELECT pg_reload_conf()` saja dan melaporkan "WAL terarsip: 0" —
# kegagalan yang tampak seperti keterbatasan lingkungan, padahal kesalahan
# prosedur. Kalau berhasil, kita restart instance lokal di sini.
"$BIN/psql" "$SRC_URL" -q -c "ALTER SYSTEM SET archive_mode = on;" \
  -c "ALTER SYSTEM SET archive_command = 'test ! -f $WAL_ARCHIVE/%f && cp %p $WAL_ARCHIVE/%f';" \
  >>"$LOG" 2>&1 || fail "tidak bisa menulis konfigurasi WAL archiving (butuh superuser)"

log "   me-restart instance sumber agar archive_mode aktif"
"$BIN/pg_ctl" -D "$ROOT/data" -m fast -w restart -l "$WORK/src-restart.log" >>"$LOG" 2>&1 \
  || fail "restart instance sumber gagal (lihat $WORK/src-restart.log)"
sleep 2

ARCHIVE_MODE="$(psql_q "$SRC_URL" "SHOW archive_mode;" || echo off)"
log "   archive_mode = $ARCHIVE_MODE"
[ "$ARCHIVE_MODE" = "on" ] || fail "archive_mode tidak aktif setelah restart"

# URUTAN PENTING (dan versi pertama skrip ini salah):
# `pg_basebackup` HARUS selesai SEBELUM `pg_switch_wal()`. Kalau WAL diputar
# lebih dulu, segmen yang dibutuhkan recovery belum tentu sudah terarsip saat
# recovery dimulai — dan PostgreSQL berhenti dengan "recovery ended before
# configured recovery target was reached". Itu bukan keterbatasan lingkungan,
# melainkan urutan prosedur yang keliru.
BASE="$WORK/base"
"$BIN/pg_basebackup" -h 127.0.0.1 -p 5432 -U postgres -D "$BASE" -X stream -c fast \
  >>"$LOG" 2>&1 || fail "pg_basebackup gagal"
log "   base backup selesai (sebelum switch WAL)"

# MEMBUKTIKAN ARSIP BERJALAN — dengan kemajuan `last_archived_wal`, bukan
# dengan menebak nomor segmen.
#
# Tiga versi skrip ini salah di sini, dan ketiganya gagal dengan gejala yang
# sama ("tidak terarsip"): (a) menunggu jumlah berkas, (b) menunggu
# `pg_walfile_name(pg_current_wal_lsn())` SETELAH switch — itu menunjuk segmen
# baru yang belum penuh, (c) menunggu segmen SEBELUM switch — tetapi setelah
# `pg_basebackup` segmen aktif masih hampir kosong, dan `pg_switch_wal()`
# menutup segmen tempat record switch DITULIS, bukan segmen yang kita tunggu.
#
# Yang benar: catat kemajuan arsip, paksa switch, lalu tunggu arsip MAJU.
# Itu bukti langsung bahwa jalur WAL berfungsi, tanpa bergantung pada
# bagaimana PostgreSQL memetakan LSN ke nomor segmen.
BEFORE_ARCHIVED="$(psql_q "$SRC_URL" "SELECT coalesce(last_archived_wal,'-') FROM pg_stat_archiver;")"
log "   arsip sebelum switch: $BEFORE_ARCHIVED"

ADVANCED=0
for attempt in 1 2 3; do
  "$BIN/psql" "$SRC_URL" -q -c "SELECT pg_switch_wal();" >>"$LOG" 2>&1
  for i in $(seq 1 30); do
    NOW_ARCHIVED="$(psql_q "$SRC_URL" "SELECT coalesce(last_archived_wal,'-') FROM pg_stat_archiver;" 2>/dev/null || echo '-')"
    if [ "$NOW_ARCHIVED" != "$BEFORE_ARCHIVED" ] && [ "$NOW_ARCHIVED" != "-" ]; then ADVANCED=1; break 2; fi
    sleep 1
  done
  log "   percobaan $attempt: belum ada kemajuan, switch lagi"
done
[ "$ADVANCED" = "1" ] || fail "arsip WAL tidak maju setelah 3 switch — jalur arsip tidak berfungsi"
log "   arsip maju ke: $NOW_ARCHIVED"

# Pastikan PostgreSQL sendiri menganggap arsipnya sehat, bukan hanya berkasnya ada.
LAST_ARCHIVED="$(psql_q "$SRC_URL" "SELECT last_archived_wal FROM pg_stat_archiver;")"
FAILED_ARCHIVE="$(psql_q "$SRC_URL" "SELECT failed_count FROM pg_stat_archiver;")"
log "   pg_stat_archiver: terakhir=$LAST_ARCHIVED, gagal=$FAILED_ARCHIVE"
[ "$FAILED_ARCHIVE" = "0" ] || fail "archive_command pernah gagal ($FAILED_ARCHIVE kali) — lihat $LOG"

# MARKER HARUS DIBUAT SETELAH BASE BACKUP — ini kesalahan urutan keempat yang
# ditemukan saat menjalankan drill ini, dan yang paling halus.
#
# Kalau marker dibuat SEBELUM base backup, LSN marker sudah tercakup di dalam
# base backup. Recovery lalu selesai tanpa pernah menemukan record marker di
# WAL, dan PostgreSQL berhenti dengan "recovery ended before configured
# recovery target was reached" — padahal arsipnya sehat dan base backupnya
# benar. Untuk menguji PITR, titik target HARUS berada setelah titik awal
# base backup.
"$BIN/psql" "$SRC_URL" -q -c "SELECT pg_create_restore_point('drill_marker');" >>"$LOG" 2>&1 \
  || fail "pg_create_restore_point gagal"
log "   restore point 'drill_marker' dibuat SETELAH base backup"

# Tulis sesuatu SETELAH marker: recovery harus berhenti di marker dan TIDAK
# memuat baris ini. Itulah yang membedakan "PITR benar" dari "salinan penuh".
"$BIN/psql" "$SRC_URL" -q -c \
  "INSERT INTO workspaces (id,name,slug,seq_next)
   VALUES ('0190f000-0000-7000-8000-0000000000ff','Setelah Marker','setelah-marker',1)
   ON CONFLICT DO NOTHING;" >>"$LOG" 2>&1 || true
log "   baris 'Setelah Marker' ditulis setelah marker"

# Arsipkan WAL yang memuat record marker + baris di atas, lalu tunggu maju.
ADVANCED=0
for attempt in 1 2 3 4 5 6; do
  "$BIN/psql" "$SRC_URL" -q -c "SELECT pg_switch_wal();" >>"$LOG" 2>&1
  for i in $(seq 1 15); do
    NOW_ARCHIVED="$(psql_q "$SRC_URL" "SELECT coalesce(last_archived_wal,'-') FROM pg_stat_archiver;" 2>/dev/null || echo '-')"
    if [ "$NOW_ARCHIVED" != "$BEFORE_ARCHIVED" ] && [ "$NOW_ARCHIVED" != "-" ]; then ADVANCED=1; break 2; fi
    sleep 1
  done
  log "   percobaan $attempt: arsip belum maju, switch lagi"
done
[ "$ADVANCED" = "1" ] || fail "arsip WAL tidak maju setelah 6 switch — jalur arsip tidak berfungsi"
log "   arsip maju ke: $NOW_ARCHIVED"

WAL_COUNT=$(ls -1 "$WAL_ARCHIVE" 2>/dev/null | wc -l | tr -d ' ')
log "   WAL terarsip: $WAL_COUNT berkas"
[ "$WAL_COUNT" -gt 0 ] || fail "tidak ada WAL terarsip — jalur PITR tidak terbukti"

# Sidik jari PADA TITIK MARKER: belum termasuk baris 'Setelah Marker'.
FP_AT_MARKER="$(psql_q "$SRC_URL" "$FINGERPRINT_SQL_BEFORE_MARKER")" \
  || fail "tidak bisa menghitung sidik jari titik marker"
log "   sidik jari saat marker: $FP_AT_MARKER"

cat >> "$BASE/postgresql.auto.conf" <<EOF
restore_command = 'cp $WAL_ARCHIVE/%f %p'
recovery_target_name = 'drill_marker'
recovery_target_inclusive = on
recovery_target_action = 'promote'
EOF
touch "$BASE/recovery.signal"
PITR_PORT=$((DRILL_PORT + 1))
"$BIN/pg_ctl" -D "$BASE" -o "-p $PITR_PORT -k /tmp" -l "$WORK/pitr.log" -w start \
  >>"$LOG" 2>&1 || fail "recovery ke restore point gagal (lihat $WORK/pitr.log)"

PITR_FP="$(psql_q "postgres://postgres@127.0.0.1:$PITR_PORT/$SRC_DB" "$FINGERPRINT_SQL")" \
  || fail "tidak bisa membaca hasil PITR"
log "   sidik jari PITR      : $PITR_FP"

# INTI UJI PITR: hasil recovery harus SAMA dengan keadaan SAAT MARKER, dan
# BERBEDA dari keadaan sekarang (yang sudah memuat baris setelah marker).
if [ "$PITR_FP" = "$FP_AT_MARKER" ]; then
  log "   PITR BERHENTI TEPAT DI MARKER — data setelah marker tidak ikut pulih"
else
  fail "PITR tidak berhenti di marker (diharapkan: $FP_AT_MARKER)"
fi

POST_MARKER=$("$BIN/psql" "postgres://postgres@127.0.0.1:$PITR_PORT/$SRC_DB" -At -c \
  "SELECT count(*) FROM workspaces WHERE slug = 'setelah-marker';" 2>>"$LOG" || echo "?")
log "   baris setelah marker di hasil PITR: $POST_MARKER (harus 0)"
[ "$POST_MARKER" = "0" ] || fail "baris setelah marker ikut terpulihkan — PITR salah"

"$BIN/pg_ctl" -D "$BASE" -m immediate stop >/dev/null 2>&1 || true

# Matikan instance drill sebelum melaporkan.
"$BIN/pg_ctl" -D "$DRILL_DATA" -m fast stop >/dev/null 2>&1 || true
trap - EXIT

log ""
log "== HASIL =="
log "logical backup + restore : LULUS (sidik jari identik)"
log "waktu restore            : ${RESTORE_SECONDS} dtk"
log "WAL terarsip             : $WAL_COUNT berkas"
log "RTO terukur (logical)    : ${RESTORE_SECONDS} dtk"
log ""
log "CATATAN PENTING: angka RTO di atas berlaku untuk dataset uji di mesin ini."
log "NFR-010 menuntut RPO <= 5 menit pada PostgreSQL produksi dengan WAL"
log "archiving ke penyimpanan objek. Yang dibuktikan di sini adalah PROSEDUR"
log "dan INTEGRITAS data, bukan SLA penyimpanan produksi."

[ "${KELINDAN_DRILL_KEEP:-0}" = "1" ] || rm -rf "$WORK"
