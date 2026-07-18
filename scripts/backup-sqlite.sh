#!/usr/bin/env sh
set -eu

# Creates a consistent SQLite backup in the persistent server-data volume.
# Run from the repository root on the VPS, for example via cron.
docker compose exec -T server sh -ec '
  test -n "${SQLITE_PATH:-}" || {
    echo "SQLITE_PATH is not configured" >&2
    exit 1
  }
  test -f "$SQLITE_PATH" || {
    echo "SQLite database does not exist at $SQLITE_PATH" >&2
    exit 1
  }

  mkdir -p /data/backups
  backup_file="/data/backups/trucoviski-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
  sqlite3 "$SQLITE_PATH" ".backup \"$backup_file\""
  echo "SQLite backup created: $backup_file"
'
