#!/usr/bin/env bash
# Gerbang "jangan hijau palsu" untuk uji yang butuh database.
#
# MASALAHNYA: uji jaringan memakai `describe.skipIf(!hasRealPg())`. Bila
# `KELINDAN_PG_URL` salah ketik atau database belum siap, vitest akan
# melaporkan "lulus" dengan SEMUA uji dilewati — CI hijau, tidak ada yang
# diuji. Hijau palsu lebih berbahaya daripada merah, karena ia menghapus
# alasan untuk memeriksa.
#
# Pemakaian: assert-not-skipped.sh <file-log>
set -uo pipefail

LOG="${1:?butuh path file log}"
if [ ! -f "$LOG" ]; then
  echo "::error::log uji tidak ditemukan: $LOG"
  exit 1
fi

# Vitest menulis "Tests  N passed | M skipped" ATAU "Tests  N skipped (N)".
# Kita HANYA memeriksa baris ringkasan, bukan seluruh log: pada CI, ringkasan
# juga memuat baris "Test Files ... skipped" dan nama berkas, sehingga
# pencocokan `[0-9]+ skipped` pada seluruh log memberi positif palsu — itu
# yang memerahkan CI pada run kedua meski 28 uji lulus.
SUMMARY=$(grep -E "^ *Tests +[0-9]" "$LOG" | tail -1)

if echo "$SUMMARY" | grep -qE "\| *[0-9]+ skipped|^ *Tests +[0-9]+ skipped"; then
  echo "::error::ada uji yang DILEWATI padahal database seharusnya tersedia."
  echo "ringkasan: $SUMMARY"
  echo "Periksa KELINDAN_PG_URL dan kesiapan database."
  exit 1
fi

if ! echo "$SUMMARY" | grep -qE "Tests +[0-9]+ passed"; then
  echo "::error::tidak ada uji yang lulus."
  echo "ringkasan: ${SUMMARY:-<tidak ada baris ringkasan>}"
  exit 1
fi

if echo "$SUMMARY" | grep -qE "no tests"; then
  echo "::error::tidak ada uji yang berjalan sama sekali."
  exit 1
fi

echo "OK     tidak ada uji yang dilewati."
