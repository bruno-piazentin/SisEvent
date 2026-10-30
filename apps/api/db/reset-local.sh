#!/usr/bin/env bash
# Recria o banco local do zero e aplica migrações + seed (uso em desenvolvimento)
set -euo pipefail
cd "$(dirname "$0")"
DB_URL="${DATABASE_URL_ADMIN:-postgres://postgres@localhost:5432/postgres}"
DB_NAME="${DB_NAME:-sisevent}"
psql "$DB_URL" -q -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" -c "CREATE DATABASE $DB_NAME;"
TARGET="${DB_URL%/*}/$DB_NAME"
for f in migrations/*.sql; do
  echo "→ $f"
  psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$f"
done
if [[ "${SEM_SEED:-}" != "1" ]]; then
  echo "→ seed.sql"; psql "$TARGET" -v ON_ERROR_STOP=1 -q -f seed.sql
fi
echo "Banco $DB_NAME pronto."
