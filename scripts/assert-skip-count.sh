#!/usr/bin/env bash
# Gerbang job `unit`: jumlah uji yang DILEWATI harus tepat seperti yang
# diharapkan.
#
# Di job ini database TIDAK tersedia, jadi uji jaringan memang harus dilewati.
# Yang dijaga: jumlahnya tidak berubah diam-diam. Kalau bertambah, ada uji yang
# berhenti berjalan tanpa ada yang memberi tahu; kalau berkurang, ada uji
# jaringan yang entah bagaimana "lulus" tanpa database.
#
# Pemakaian: assert-skip-count.sh <log> <jumlah-diharapkan>
set -uo pipefail

LOG="${1:?butuh path log}"
EXPECTED="${2:?butuh jumlah yang diharapkan}"

if [ ! -f "$LOG" ]; then
  echo "::error::log uji tidak ditemukan: $LOG"
  exit 1
fi

# HANYA baris ringkasan. Versi pertama gerbang ini memakai `head -1` pada
# seluruh log sehingga membaca jumlah per-berkas (7), bukan total (17).
SUMMARY=$(grep -E "^ *Tests +[0-9]" "$LOG" | tail -1)
if [ -z "$SUMMARY" ]; then
  echo "::error::tidak ada baris ringkasan uji di log."
  exit 1
fi

if ! echo "$SUMMARY" | grep -qE "Tests +[0-9]+ passed"; then
  echo "::error::tidak ada uji yang lulus."
  echo "ringkasan: $SUMMARY"
  exit 1
fi

ACTUAL=$(echo "$SUMMARY" | grep -oE "[0-9]+ skipped" | grep -oE "[0-9]+" || echo 0)
echo "ringkasan: $SUMMARY"
echo "dilewati: $ACTUAL (diharapkan $EXPECTED)"

if [ "$ACTUAL" -ne "$EXPECTED" ]; then
  echo "::error::jumlah uji yang dilewati berubah ($ACTUAL, diharapkan $EXPECTED)."
  echo "Periksa apakah uji jaringan ikut dilewati, atau ada uji baru yang tidak terdaftar."
  exit 1
fi
echo "OK     jumlah uji yang dilewati sesuai."
