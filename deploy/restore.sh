#!/usr/bin/env bash
# Siracusa: bring the database back from a backup (docs/DEPLOY.md, "Връщане от архив"). Run as the user "siracusa":
#   deploy/restore.sh <backup file>   a file from shared/backups/db/ (siracusa-YYYYMMDD-HHMM.db.gz or .db.gz.gpg)
#   deploy/restore.sh --list          the backups there are, newest first
#   options: --yes (no question), --photos (also copy the photos of the backup back into data/media and data/receipts)
# Everything made after that backup (orders, reservations, changes of the menu) is lost: the script asks before it acts.
# The steps: the copy is unpacked and checked FIRST; the service is stopped; the present database is kept next to the
# live one as siracusa.db.before-restore-<time>; the copy takes its place; the service is started; the health check.
set -euo pipefail

BASE="${SIRACUSA_BASE:-/srv/siracusa}"
SERVICE="${SIRACUSA_SERVICE:-siracusa}"
STOP_CMD="${SIRACUSA_STOP_CMD:-sudo systemctl stop $SERVICE}"
START_CMD="${SIRACUSA_START_CMD:-sudo systemctl start $SERVICE}"
die() { printf 'restore: FAILED. %s\n' "$*" >&2; exit 1; }
say() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }

[ "$(id -u)" != "0" ] || die "run it as the user siracusa, not as root"
ENVF="$BASE/shared/.env"
[ -f "$ENVF" ] || die "no $ENVF"
val() { sed -n "s/^$1=\(.*\)$/\1/p" "$ENVF" | tail -1; }
PORT="$(val PORT)"; PORT="${PORT:-8787}"
DB_REL="$(val DB_FILE)"; DB_REL="${DB_REL:-data/siracusa.db}"
DB="$BASE/shared/$DB_REL"
BK="$(val BACKUP_DIR)"; BK="${BK:-$BASE/shared/backups}"

FILE=""; YES=""; PHOTOS=""
for a in "$@"; do
  case "$a" in
    --list) ls -1t "$BK/db" 2>/dev/null | grep -E '^siracusa-[0-9]{8}-[0-9]{4}\.db\.gz(\.gpg)?$' || echo "(no backups in $BK/db)"; exit 0;;
    --yes) YES=1;;
    --photos) PHOTOS=1;;
    -*) die "unknown option $a";;
    *) FILE="$a";;
  esac
done
[ -n "$FILE" ] || die "which backup? (deploy/restore.sh --list)"
[ -f "$FILE" ] || FILE="$BK/db/$FILE"
[ -f "$FILE" ] || die "no such file: $FILE"
[ -d "$BASE/current" ] || die "no running version at $BASE/current"

TMP="$(mktemp -d "$BASE/shared/restore.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"
say "unpacking $(basename "$FILE")"
case "$FILE" in
  *.gpg)
    PASS="$(val BACKUP_PASSFILE)"
    [ -n "$PASS" ] && [ -f "$PASS" ] || die "the backup is encrypted and BACKUP_PASSFILE is not set (or the file is missing)"
    gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASS" --output "$TMP/db.gz" --decrypt "$FILE" || die "wrong passphrase or a damaged file";;
  *) cp "$FILE" "$TMP/db.gz";;
esac
gunzip "$TMP/db.gz" || die "the file is damaged (gunzip)"
cd "$BASE/current"
node --input-type=module -e '
  import D from "better-sqlite3";
  const d = new D(process.argv[1], { readonly: true, fileMustExist: true });
  const ok = d.pragma("integrity_check", { simple: true });
  const n = d.prepare("select count(*) as n from sqlite_master where type = \x27table\x27").get().n;
  d.close();
  if (ok !== "ok" || !n) { console.error("integrity_check: " + ok + ", tables: " + n); process.exit(1); }
  console.log("          the copy is whole: " + n + " tables");
' "$TMP/db" || die "the copy did not pass the check: nothing was changed"

if [ -z "$YES" ]; then
  printf 'Everything made after this backup will be lost (orders, reservations, changes). Type YES to go on: '
  read -r ans
  [ "$ans" = "YES" ] || die "stopped: nothing was changed"
fi

say "stopping the service"
$STOP_CMD || true
sleep 1
if [ -f "$DB" ]; then
  KEEP="$DB.before-restore-$(date -u +%Y%m%d-%H%M%S)"
  # the present database with everything still in its journal, as one whole file
  node --input-type=module -e 'import D from "better-sqlite3"; const s = new D(process.argv[1], { fileMustExist: true }); await s.backup(process.argv[2]); s.close();' "$DB" "$KEEP" || die "could not keep the present database: nothing was changed (start the service: $START_CMD)"
  chmod 600 "$KEEP"
  say "the present database is kept as $(basename "$KEEP")"
fi
# the journal files of the old database must never meet the restored one
rm -f "$DB-wal" "$DB-shm"
mv -f "$TMP/db" "$DB"
chmod 600 "$DB"
if [ -n "$PHOTOS" ]; then
  for d in media receipts; do
    [ -d "$BK/$d" ] && { mkdir -p "$(dirname "$DB")/$d"; cp -n "$BK/$d"/* "$(dirname "$DB")/$d"/ 2>/dev/null || true; }
  done
  say "the photos of the backup are copied back (the present ones are kept)"
fi
say "starting the service"
$START_CMD || true
for i in $(seq 1 60); do
  if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true'; then say "done: the site answers with the restored database"; exit 0; fi
  sleep 1
done
die "the service does not answer after the restore. Look at: journalctl -u $SERVICE -n 100. The database from before is kept next to the live one (siracusa.db.before-restore-*)."
