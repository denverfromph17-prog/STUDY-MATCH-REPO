#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SERVICE_NAME="${SERVICE_NAME:-study-match.service}"
STORAGE_ROOT="${STORAGE_ROOT:-/srv/study-match-data}"
STAGING_PARENT="${STAGING_PARENT:-/var/tmp}"
RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-/var/cache/restic}"

required=(DATABASE_PATH UPLOAD_DIR RESTIC_REPOSITORY RESTIC_PASSWORD_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then echo "Required backup setting is missing: ${name}" >&2; exit 1; fi
done
for command in sqlite3 restic tar sha256sum findmnt flock systemctl find grep hostname mktemp mkdir rm realpath; do
  command -v "$command" >/dev/null || { echo "Required command is unavailable: $command" >&2; exit 1; }
done
if [[ -n "${BETTER_STACK_SUCCESS_URL:-}${BETTER_STACK_FAILURE_URL:-}" ]]; then
  command -v curl >/dev/null || { echo 'Required command is unavailable: curl' >&2; exit 1; }
fi
[[ "$DATABASE_PATH" = /* && "$UPLOAD_DIR" = /* && "$STORAGE_ROOT" = /* ]] || { echo 'Production data paths must be absolute.' >&2; exit 1; }
[[ ! -L "$DATABASE_PATH" ]] || { echo 'DATABASE_PATH must not be a symbolic link.' >&2; exit 1; }
[[ ! -L "$UPLOAD_DIR" ]] || { echo 'UPLOAD_DIR must not be a symbolic link.' >&2; exit 1; }
[[ -f "$DATABASE_PATH" && -d "$UPLOAD_DIR" ]] || { echo 'Database or upload directory is missing.' >&2; exit 1; }
STORAGE_ROOT="$(realpath -e -- "$STORAGE_ROOT")"
DATABASE_PATH="$(realpath -e -- "$DATABASE_PATH")"
UPLOAD_DIR="$(realpath -e -- "$UPLOAD_DIR")"
case "$DATABASE_PATH" in "$STORAGE_ROOT"/*) ;; *) echo 'Resolved DATABASE_PATH is outside STORAGE_ROOT.' >&2; exit 1;; esac
case "$UPLOAD_DIR" in "$STORAGE_ROOT"/*) ;; *) echo 'Resolved UPLOAD_DIR is outside STORAGE_ROOT.' >&2; exit 1;; esac
findmnt -M "$STORAGE_ROOT" >/dev/null || { echo "Persistent volume is not mounted at $STORAGE_ROOT." >&2; exit 1; }
[[ -r "$RESTIC_PASSWORD_FILE" ]] || { echo 'RESTIC_PASSWORD_FILE is not readable.' >&2; exit 1; }
if find -P "$UPLOAD_DIR" -mindepth 1 ! \( -type f -o -type d \) -print -quit | grep -q .; then
  echo 'Upload directory contains a symlink or other unsafe file type; refusing backup.' >&2
  exit 1
fi

mkdir -p "$STAGING_PARENT" "$RESTIC_CACHE_DIR" /run/lock
exec 9>/run/lock/study-match-backup.lock
flock -n 9 || { echo 'Another Study Match backup is already running.' >&2; exit 1; }

staging="$(mktemp -d "$STAGING_PARENT/study-match-backup.XXXXXX")"
payload="$staging/payload"
mkdir -p "$payload/database"
service_stopped=0

cleanup() {
  status=$?
  if (( service_stopped )); then systemctl start "$SERVICE_NAME" || true; fi
  rm -rf -- "$staging"
  if (( status != 0 )) && [[ -n "${BETTER_STACK_FAILURE_URL:-}" ]]; then
    curl --fail --silent --show-error --max-time 15 "$BETTER_STACK_FAILURE_URL" >/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

systemctl is-active --quiet "$SERVICE_NAME" || { echo "$SERVICE_NAME must be active before backup." >&2; exit 1; }
systemctl stop "$SERVICE_NAME"
service_stopped=1

sqlite3 "$DATABASE_PATH" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
sqlite3 "$DATABASE_PATH" ".backup '$payload/database/study-match.db'"
[[ "$(sqlite3 "$payload/database/study-match.db" 'PRAGMA integrity_check;')" == 'ok' ]] || { echo 'SQLite integrity check failed.' >&2; exit 1; }
[[ -z "$(sqlite3 "$payload/database/study-match.db" 'PRAGMA foreign_key_check;')" ]] || { echo 'SQLite foreign-key check failed.' >&2; exit 1; }
tar -C "$UPLOAD_DIR" -czf "$payload/uploads.tar.gz" .
(cd "$payload" && sha256sum database/study-match.db uploads.tar.gz > manifest.sha256)

systemctl start "$SERVICE_NAME"
service_stopped=0

export RESTIC_CACHE_DIR
(cd "$staging" && restic backup payload --tag study-match --tag "host:$(hostname -s)")
restic forget --tag study-match --keep-hourly 28 --keep-daily 30 --keep-weekly 12 --keep-monthly 12 --prune

if [[ -n "${BETTER_STACK_SUCCESS_URL:-}" ]]; then
  curl --fail --silent --show-error --retry 3 --max-time 15 "$BETTER_STACK_SUCCESS_URL" >/dev/null
fi

echo 'Study Match backup completed and uploaded successfully.'
