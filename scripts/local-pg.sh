#!/bin/bash
# Start (or reuse) a throwaway local Postgres 16 for the test suite in a cloud session, then print
# the TEST_DATABASE_URL to use. Usage: eval "$(bash scripts/local-pg.sh)" && npm test
set -e
DIR=${PGDIR:-/tmp/oq-pg}
PORT=${PGPORT_LOCAL:-5433}
BIN=/usr/lib/postgresql/16/bin
mkdir -p "$DIR" && chown postgres "$DIR" && chmod 755 "$DIR"
[ -f "$DIR/data/PG_VERSION" ] || su postgres -c "$BIN/initdb -D $DIR/data -A trust" >/dev/null
if ! psql -h "$DIR" -p "$PORT" -U postgres -Atc "select 1" >/dev/null 2>&1; then
  pid=$(head -1 "$DIR/data/postmaster.pid" 2>/dev/null || true)
  if [ -n "$pid" ] && ! grep -q postgres "/proc/$pid/comm" 2>/dev/null; then rm -f "$DIR/data/postmaster.pid"; fi
  su postgres -c "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/server.log -w start" >/dev/null
fi
psql -h "$DIR" -p "$PORT" -U postgres -Atc "select 1 from pg_database where datname = 'oq_test'" | grep -q 1 \
  || psql -h "$DIR" -p "$PORT" -U postgres -qc "create database oq_test"
echo "export TEST_DATABASE_URL='postgresql://postgres@localhost/oq_test?host=$DIR&port=$PORT'"
