#!/usr/bin/env bash
# Menjalankan PostgreSQL SUNGGUHAN lokal untuk uji konkurensi & LISTEN/NOTIFY.
#
# KENAPA skrip ini ada: PGlite (PostgreSQL WASM) hanya punya SATU koneksi,
# sehingga dua penulis bersamaan tidak bisa diuji. Tanpa uji semacam itu,
# klaim "tidak ada update yang hilang" hanyalah harapan.
#
# Paket `embedded-postgres` (pip) membawa binari PostgreSQL lengkap + citext &
# pg_trgm. Tidak perlu Docker, tidak perlu root.
set -euo pipefail

VERSION="${PG_PY_VERSION:-18.6.3}"
ROOT="${KELINDAN_PG_ROOT:-/tmp/kelindan-pg}"
PORT="${PGPORT:-5432}"
DATA="$ROOT/data"
BIN="$ROOT/pginstall/bin"

if [ ! -x "$BIN/postgres" ]; then
  echo "mengunduh PostgreSQL $VERSION (embedded-postgres)…"
  python3 -m pip download "embedded-postgres==$VERSION" --no-deps -d "$ROOT/dl" >/dev/null
  mkdir -p "$ROOT/x" && (cd "$ROOT/x" && unzip -qo "$ROOT"/dl/*.whl)
  mv "$ROOT/x/embedded_postgres/pginstall" "$ROOT/pginstall"
  # Wheel menaruh pustaka bersama TAMBAHAN di `embedded_postgres.libs/`
  # (di luar pginstall), dan binari menautkannya lewat RPATH relatif
  # `../../embedded_postgres.libs`. Tanpa direktori ini, `initdb` gagal dengan
  # "cannot open shared object libpq-<hash>.so". Ini jebakan yang tidak
  # terlihat sampai skrip benar-benar dijalankan dari nol.
  if [ -d "$ROOT/x/embedded_postgres.libs" ]; then
    mv "$ROOT/x/embedded_postgres.libs" "$ROOT/embedded_postgres.libs"
  fi
fi

# Binari di wheel ini menautkan pustaka bersama di `lib/`, bukan rpath sistem.
# Tanpa LD_LIBRARY_PATH, `initdb` gagal: "cannot open shared object".
export LD_LIBRARY_PATH="$ROOT/pginstall/lib:$ROOT/embedded_postgres.libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

if [ ! -d "$DATA" ]; then
  mkdir -p "$DATA" && chmod 700 "$DATA"
  "$BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
fi

"$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" \
  -l "$ROOT/postgres.log" -w start >/dev/null 2>&1 || true

"$BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='kelindan_test'" | grep -q 1 \
  || "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -c "CREATE DATABASE kelindan_test" >/dev/null

"$BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d kelindan_test -q \
  -c "CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;"

echo "PostgreSQL siap: postgres://postgres@127.0.0.1:$PORT/kelindan_test"
