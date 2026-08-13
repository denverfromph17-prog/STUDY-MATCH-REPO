#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

for command in sqlite3 tar sha256sum awk mktemp rm mkdir dirname; do
  command -v "$command" >/dev/null || { echo "Required command is unavailable: $command" >&2; exit 1; }
done

workdir=''
cleanup() { status=$?; [[ -z "$workdir" ]] || rm -rf -- "$workdir"; exit "$status"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "${1:-}" == '--local' ]]; then
  [[ -n "${2:-}" && -d "$2" ]] || { echo 'Usage: verify-restore.sh --local PAYLOAD_DIRECTORY' >&2; exit 2; }
  payload="$(cd "$2" && pwd -P)"
else
  command -v restic >/dev/null || { echo 'Required command is unavailable: restic' >&2; exit 1; }
  required=(RESTIC_REPOSITORY RESTIC_PASSWORD_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY)
  for name in "${required[@]}"; do
    [[ -n "${!name:-}" ]] || { echo "Required restore setting is missing: ${name}" >&2; exit 1; }
  done
  workdir="$(mktemp -d /var/tmp/study-match-restore.XXXXXX)"
  restic restore latest --tag study-match --target "$workdir"
  payload="$workdir/payload"
fi

[[ -f "$payload/database/study-match.db" && -f "$payload/uploads.tar.gz" && -f "$payload/manifest.sha256" ]] || { echo 'Backup payload is incomplete.' >&2; exit 1; }
[[ ! -L "$payload/database/study-match.db" && ! -L "$payload/uploads.tar.gz" && ! -L "$payload/manifest.sha256" ]] || { echo 'Backup payload contains an unsafe symbolic link.' >&2; exit 1; }
awk '
  NF != 2 || length($1) != 64 || $1 !~ /^[0-9a-fA-F]+$/ { exit 1 }
  $2 == "database/study-match.db" { database++ ; next }
  $2 == "uploads.tar.gz" { uploads++ ; next }
  { exit 1 }
  END { exit !(NR == 2 && database == 1 && uploads == 1) }
' "$payload/manifest.sha256" || { echo 'Backup checksum manifest is unsafe or incomplete.' >&2; exit 1; }
(cd "$payload" && sha256sum -c manifest.sha256)
[[ "$(sqlite3 "$payload/database/study-match.db" 'PRAGMA integrity_check;')" == 'ok' ]] || { echo 'Restored SQLite integrity check failed.' >&2; exit 1; }
[[ -z "$(sqlite3 "$payload/database/study-match.db" 'PRAGMA foreign_key_check;')" ]] || { echo 'Restored SQLite foreign-key check failed.' >&2; exit 1; }

if tar -tzf "$payload/uploads.tar.gz" | awk '/^\// || /(^|\/)\.\.($|\/)/ { found=1 } END { exit !found }'; then
  echo 'Upload archive contains an unsafe path.' >&2
  exit 1
fi
if tar -tvzf "$payload/uploads.tar.gz" | awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { found=1 } END { exit !found }'; then
  echo 'Upload archive contains a symlink, hard link, device, FIFO, socket, or other unsafe entry type.' >&2
  exit 1
fi
extract="${workdir:-$(mktemp -d /var/tmp/study-match-local-restore.XXXXXX)}/uploads"
[[ -n "$workdir" ]] || workdir="$(dirname "$extract")"
mkdir -p "$extract"
tar -xzf "$payload/uploads.tar.gz" -C "$extract" --no-same-owner --no-same-permissions

missing=0
while IFS= read -r photo; do
  [[ -z "$photo" || -f "$extract/$photo" ]] || { echo "Referenced profile photo is absent: $photo" >&2; missing=1; }
done < <(sqlite3 "$payload/database/study-match.db" "SELECT photo_id FROM profiles WHERE photo_id IS NOT NULL ORDER BY photo_id;")
(( missing == 0 )) || exit 1

if [[ -n "${BETTER_STACK_RESTORE_SUCCESS_URL:-}" && "${1:-}" != '--local' ]]; then
  command -v curl >/dev/null || { echo 'Required command is unavailable: curl' >&2; exit 1; }
  curl --fail --silent --show-error --retry 3 --max-time 15 "$BETTER_STACK_RESTORE_SUCCESS_URL" >/dev/null
fi

echo 'Backup restore verification passed: checksums, SQLite integrity, foreign keys, archive paths, and profile-photo references are valid.'
