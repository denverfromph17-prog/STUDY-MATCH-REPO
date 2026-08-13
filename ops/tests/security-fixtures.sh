#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
backup_script="$repo_root/ops/scripts/backup.sh"
verify_script="$repo_root/ops/scripts/verify-restore.sh"

for command in sqlite3 tar sha256sum realpath mktemp mkfifo; do
  command -v "$command" >/dev/null || { echo "SKIP: required fixture command is unavailable: $command" >&2; exit 77; }
done

workdir="$(mktemp -d)"
cleanup() { status=$?; rm -rf -- "$workdir"; exit "$status"; }
trap cleanup EXIT

mock_bin="$workdir/bin"
mkdir -p "$mock_bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$mock_bin/restic"
chmod 0700 "$mock_bin/restic"
printf '#!/usr/bin/env bash\nexit 0\n' > "$mock_bin/findmnt"
chmod 0700 "$mock_bin/findmnt"

storage="$workdir/storage"
outside="$workdir/outside"
mkdir -p "$storage/database" "$storage/uploads" "$outside/uploads"
sqlite3 "$storage/database/study-match.db" 'CREATE TABLE profiles (photo_id TEXT);'
printf 'password\n' > "$workdir/restic-password"

run_backup_expect_failure() {
  local expected="$1"
  shift
  local output
  local secret_name="AWS_SECRET_ACCESS_"'KEY'
  if output="$(env PATH="$mock_bin:$PATH" \
      STORAGE_ROOT="$storage" \
      DATABASE_PATH="$storage/database/study-match.db" \
      UPLOAD_DIR="$storage/uploads" \
      RESTIC_REPOSITORY='fixture:test' \
      RESTIC_PASSWORD_FILE="$workdir/restic-password" \
      AWS_ACCESS_KEY_ID='fixture' \
      "$secret_name=fixture" \
      "$@" bash "$backup_script" 2>&1)"; then
    echo "Expected backup validation failure: $expected" >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output" >/dev/null || { echo "$output" >&2; exit 1; }
}

ln -s "$storage/database/study-match.db" "$storage/database/symlink.db"
run_backup_expect_failure 'DATABASE_PATH must not be a symbolic link.' env DATABASE_PATH="$storage/database/symlink.db"

ln -s "$outside/uploads" "$storage/upload-link"
run_backup_expect_failure 'UPLOAD_DIR must not be a symbolic link.' env UPLOAD_DIR="$storage/upload-link"

ln -s "$outside" "$storage/escaped-parent"
sqlite3 "$outside/escaped.db" 'CREATE TABLE profiles (photo_id TEXT);'
run_backup_expect_failure 'Resolved DATABASE_PATH is outside STORAGE_ROOT.' env DATABASE_PATH="$storage/escaped-parent/escaped.db"

mkfifo "$storage/uploads/unsafe-fifo"
run_backup_expect_failure 'Upload directory contains a symlink or other unsafe file type; refusing backup.' env
rm "$storage/uploads/unsafe-fifo"

payload="$workdir/payload"
mkdir -p "$payload/database" "$workdir/archive-source"
cp "$storage/database/study-match.db" "$payload/database/study-match.db"
printf 'photo' > "$workdir/archive-source/photo.png"
tar -C "$workdir/archive-source" -czf "$payload/uploads.tar.gz" .
(cd "$payload" && sha256sum database/study-match.db uploads.tar.gz > manifest.sha256)
bash "$verify_script" --local "$payload" >/dev/null

ln -s photo.png "$workdir/archive-source/photo-link.png"
tar -C "$workdir/archive-source" -czf "$payload/uploads.tar.gz" .
(cd "$payload" && sha256sum database/study-match.db uploads.tar.gz > manifest.sha256)
if bash "$verify_script" --local "$payload" >/dev/null 2>&1; then
  echo 'Expected restore verification to reject a symlink archive entry.' >&2
  exit 1
fi

rm "$workdir/archive-source/photo-link.png"
ln "$workdir/archive-source/photo.png" "$workdir/archive-source/photo-hard.png"
tar -C "$workdir/archive-source" -czf "$payload/uploads.tar.gz" .
(cd "$payload" && sha256sum database/study-match.db uploads.tar.gz > manifest.sha256)
if bash "$verify_script" --local "$payload" >/dev/null 2>&1; then
  echo 'Expected restore verification to reject a hard-link archive entry.' >&2
  exit 1
fi

rm "$workdir/archive-source/photo-hard.png"
mkfifo "$workdir/archive-source/unsafe-fifo"
tar -C "$workdir/archive-source" -czf "$payload/uploads.tar.gz" .
(cd "$payload" && sha256sum database/study-match.db uploads.tar.gz > manifest.sha256)
if bash "$verify_script" --local "$payload" >/dev/null 2>&1; then
  echo 'Expected restore verification to reject a FIFO archive entry.' >&2
  exit 1
fi

rm "$workdir/archive-source/unsafe-fifo"
tar -C "$workdir/archive-source" --transform='s|^\./|../|' -czf "$payload/uploads.tar.gz" .
(cd "$payload" && sha256sum database/study-match.db uploads.tar.gz > manifest.sha256)
if bash "$verify_script" --local "$payload" >/dev/null 2>&1; then
  echo 'Expected restore verification to reject a traversal archive path.' >&2
  exit 1
fi

echo 'Operations security fixtures passed.'
