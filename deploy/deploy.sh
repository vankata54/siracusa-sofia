#!/usr/bin/env bash
# Siracusa: a new version on the server (docs/DEPLOY.md). Run as the user "siracusa", never as root:
#   deploy/deploy.sh [git ref]        default: build/v1
#
# The layout it works with (SIRACUSA_BASE, default /srv/siracusa):
#   repo/                 a clone of the git repository (the script only fetches from it)
#   shared/.env           the secrets of the server (never in git); shared/data/ the database and the uploads;
#   shared/backups/       the backups (scripts/backup.mjs)
#   releases/<time>-<commit>/   one folder per version, with its own node_modules and dist
#   current -> releases/...     what the service runs (deploy/siracusa.service)
#
# The steps: 1. a backup of the database; 2. the new version in its own folder (npm ci); 3. the site is built with the
# LIVE menu from a copy of the database (server/build-live.ts), while the old version still serves; 4. the link "current"
# is switched and the service restarted (a few seconds); 5. the health check; when it fails the link goes back to the
# previous version and the service is restarted again. The last 3 versions are kept.
# Nothing here prints or stores a secret.
set -euo pipefail
# everything the deploy writes (the versions, the copy of the database, the backups) is private to the user siracusa
umask 077
export ASTRO_TELEMETRY_DISABLED=1

BASE="${SIRACUSA_BASE:-/srv/siracusa}"
REPO="${SIRACUSA_REPO:-$BASE/repo}"
REF="${1:-${SIRACUSA_REF:-build/v1}}"
SERVICE="${SIRACUSA_SERVICE:-siracusa}"
KEEP="${SIRACUSA_KEEP:-3}"
# how the service is restarted (tests replace it); the user "siracusa" may run exactly this with sudo (docs/DEPLOY.md)
RESTART_CMD="${SIRACUSA_RESTART_CMD:-sudo systemctl restart $SERVICE}"

say() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { printf 'deploy: FAILED. %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" != "0" ] || die "run it as the user siracusa, not as root"
for c in git node npm curl tar flock; do command -v "$c" >/dev/null || die "$c is not installed"; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' || die "Node.js 22.12 or newer is needed (found $(node -v))"
[ -d "$REPO" ] || die "no repository at $REPO (docs/DEPLOY.md, the first setup)"
[ -f "$BASE/shared/.env" ] || die "no $BASE/shared/.env (docs/DEPLOY.md, the first setup)"
mkdir -p "$BASE/releases" "$BASE/shared/data" "$BASE/shared/backups"
chmod 700 "$BASE/shared/data" "$BASE/shared/backups"
chmod 600 "$BASE/shared/.env"

# one deploy at a time
exec 9>"$BASE/deploy.lock"
flock -n 9 || die "another deploy is running"

PORT="$(sed -n 's/^PORT=\([0-9][0-9]*\).*/\1/p' "$BASE/shared/.env" | tail -1)"; PORT="${PORT:-8787}"
DB_REL="$(sed -n 's/^DB_FILE=\(.*\)$/\1/p' "$BASE/shared/.env" | tail -1)"; DB_REL="${DB_REL:-data/siracusa.db}"
case "$DB_REL" in data/*) ;; *) die "DB_FILE in shared/.env must be inside data/ (found: $DB_REL)";; esac
DB="$BASE/shared/$DB_REL"

say "fetching $REF"
git -C "$REPO" fetch --quiet --prune origin "$REF" || die "git fetch of $REF failed"
SHA="$(git -C "$REPO" rev-parse FETCH_HEAD)"
REL="$BASE/releases/$(date -u +%Y%m%d-%H%M%S)-${SHA:0:8}"
PREV="$(readlink -f "$BASE/current" 2>/dev/null || true)"
say "version ${SHA:0:8} -> $REL"

cleanup() { [ -n "${DONE:-}" ] || { rm -rf "$REL"; }; }
trap cleanup EXIT

mkdir "$REL"
git -C "$REPO" archive "$SHA" | tar -x -C "$REL"
ln -s "$BASE/shared/.env" "$REL/.env"
ln -s "$BASE/shared/data" "$REL/data"
cd "$REL"

say "installing the packages (npm ci)"
npm ci --no-audit --no-fund --loglevel=error >/dev/null || die "npm ci failed"
npm run --silent gen >/dev/null || die "npm run gen failed"

if [ -f "$DB" ]; then
  say "backup of the database before the change"
  node scripts/backup.mjs --db "$DB" --dir "$BASE/shared/backups" --no-remote --quiet || die "the backup failed: nothing was changed"
  # a private copy for the build: the migrations of the new version run on it, never on the live database
  node --input-type=module -e 'import D from "better-sqlite3"; const s = new D(process.argv[1], { readonly: true }); await s.backup(process.argv[2]); s.close();' "$DB" "$REL/.build.db" || die "the copy of the database failed"
  chmod 600 "$REL/.build.db"
fi

say "building the site with the live menu"
node --experimental-strip-types --no-warnings server/build-live.ts --db "$REL/.build.db" --dist dist || { rm -f "$REL"/.build.db*; die "the build failed: the old version keeps running"; }
rm -f "$REL"/.build.db*
[ -f "$REL/dist/index.html" ] && [ -f "$REL/dist/redirects.json" ] || die "the build has no index.html or redirects.json"

say "switching to the new version"
ln -sfn "$REL" "$BASE/current.new"
mv -T "$BASE/current.new" "$BASE/current"
DONE=1
$RESTART_CMD || true

healthy() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true'; then
      [ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" = "200" ] && return 0
    fi
    sleep 1
  done
  return 1
}
if healthy; then
  say "the new version answers on port $PORT"
else
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    say "the new version does not answer: back to $(basename "$PREV")"
    ln -sfn "$PREV" "$BASE/current.new"
    mv -T "$BASE/current.new" "$BASE/current"
    $RESTART_CMD || true
    healthy && die "the new version did not start; the previous one is running again. Look at: journalctl -u $SERVICE -n 100. If the new version changed the database before it stopped, restore the backup made a minute ago (deploy/restore.sh)."
    die "the new version did not start and the previous one does not answer either. Look at: journalctl -u $SERVICE -n 100"
  fi
  die "the version did not start. Look at: journalctl -u $SERVICE -n 100"
fi

# keep the newest $KEEP versions (and always the running and the previous one)
cd "$BASE/releases"
ls -1d */ 2>/dev/null | sed 's#/$##' | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do
  [ "$BASE/releases/$old" = "$REL" ] || [ "$BASE/releases/$old" = "$PREV" ] || rm -rf "${BASE:?}/releases/$old"
done
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SHA" "$REF" >> "$BASE/shared/deploy.log"
say "done: ${SHA:0:8} is live"
