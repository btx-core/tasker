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

# Vitest menulis "N skipped" pada ringkasan. Kita mencocokkan ANGKA + kata,
# bukan kata sendirian — versi pertama gerbang ini gagal karena kata "skipped"
# juga muncul di jalur berkas.
if grep -qE "[0-9]+ skipped" "$LOG"; then
  echo "::error::ada uji yang DILEWATI padahal database seharusnya tersedia."
  grep -E "[0-9]+ skipped" "$LOG" | head -5
  echo "Periksa KELINDAN_PG_URL dan kesiapan database."
  exit 1
fi

if grep -qE "no tests|Tests +0 " "$LOG"; then
  echo "::error::tidak ada uji yang berjalan sama sekali."
  exit 1
fi

echo "OK     tidak ada uji yang dilewati."
