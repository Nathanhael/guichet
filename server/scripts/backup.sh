#!/usr/bin/env bash
#
# Database backup script for Guichet.
#
# Usage:
#   ./scripts/backup.sh                 # uses DATABASE_URL from .env
#   ./scripts/backup.sh --docker        # dumps from the Docker 'db' container
#
# Backups are stored in server/backups/ with a timestamp.
# The script keeps the 10 most recent backups and deletes older ones.

set -euo pipefail

BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
KEEP=10

mkdir -p "$BACKUP_DIR"

OUTFILE="$BACKUP_DIR/guichet_${TIMESTAMP}.sql.gz"

if [[ "${1:-}" == "--docker" ]]; then
  CONTAINER="${GUICHET_DB_CONTAINER:-guichet-db-1}"
  echo "Dumping from Docker container: $CONTAINER"
  docker exec "$CONTAINER" pg_dump -U "${POSTGRES_USER:-user}" "${POSTGRES_DB:-guichet}" \
    | gzip > "$OUTFILE"
else
  # Parse DATABASE_URL from .env if not already set
  if [[ -z "${DATABASE_URL:-}" ]]; then
    ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
    if [[ -f "$ENV_FILE" ]]; then
      DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d'=' -f2-)"
    fi
  fi

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL not set and no .env found." >&2
    exit 1
  fi

  echo "Dumping from DATABASE_URL"
  pg_dump "$DATABASE_URL" | gzip > "$OUTFILE"
fi

SIZE="$(du -h "$OUTFILE" | cut -f1)"
echo "Backup saved: $OUTFILE ($SIZE)"

# Prune old backups, keep the $KEEP most recent
BACKUPS=($(ls -1t "$BACKUP_DIR"/guichet_*.sql.gz 2>/dev/null))
if (( ${#BACKUPS[@]} > KEEP )); then
  for OLD in "${BACKUPS[@]:$KEEP}"; do
    rm -f "$OLD"
    echo "Pruned old backup: $(basename "$OLD")"
  done
fi
