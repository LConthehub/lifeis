#!/usr/bin/env bash
# Deploys Life Is from the branch that is checked out: the owner's own copy, then main, the demo and the website.
#
#   bash scripts/deploy.sh           deploy what is checked out
#   bash scripts/deploy.sh --check   run every test first, and stop if any fails
#
# Order matters, and is why this is a script: the new image is built BEFORE the running copy is stopped (so a build
# that fails leaves Life Is running). While it is stopped, the data is only COPIED (a plain .tar, no compression,
# so the downtime is short) and the copy's size is checked. Then the new version starts. The copy is squeezed into
# the final private/backups/before-<branch>-<stamp>.tgz AFTER the health check (or after the previous version is
# back, if the new one failed), and the .tar is removed only once the .tgz is written and its size checked. If the
# new version does not come up healthy the previous version is put back. After a good deploy only the 5 newest
# before-*.tgz backups are kept; nothing else in private/backups is ever deleted.
# Run only when the owner has said to deploy.
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }
healthy() { # $1 = port; waits up to about 80 seconds
  for _ in $(seq 1 40); do curl -s -m 3 "http://localhost:$1/api/health" | grep -q ok && return 0; sleep 2; done; return 1
}
compress_backup() { # squeezes $raw into $backup (the app is running again); removes $raw only after $backup is checked
  say "Compressing the backup"
  if gzip -c "$raw" > "$backup.partial" && [ "$(wc -c < "$backup.partial")" -gt 100000 ]; then
    mv "$backup.partial" "$backup" && rm -f "$raw" && echo "backup: $backup ($(( $(wc -c < "$backup") / 1048576 )) MB)" && return 0
  fi
  rm -f "$backup.partial" # only our own half-written file; $raw is kept
  echo "warning: the backup could not be compressed; the uncompressed copy is kept at $raw" >&2
  backup="$raw"; return 1
}

branch=$(git branch --show-current)
[ -n "$branch" ] || fail "no branch is checked out"
[ -z "$(git status --porcelain)" ] || fail "there are changes not yet committed; commit them first"
docker info >/dev/null 2>&1 || fail "Docker Desktop is not running; open it and try again"
previous=$(git rev-parse main)
say "Deploying $branch ($(git log --oneline -1 | cut -c1-70))"

if [ "${1:-}" = "--check" ]; then
  say "Checking everything first"
  (cd core && npx tsc --noEmit -p . && npx vitest run) || fail "core tests failed"
  (cd server && npx tsc --noEmit -p . && npx vitest run) || fail "server tests failed"
  (cd frontend && npx vite build) >/dev/null || fail "the pages did not build"
  { node docs/build-site.mjs >/dev/null && node e2e/site.mjs; } || fail "the website check failed"
  node e2e/run.mjs || fail "a browser walk-through failed"
  # The walk-throughs take the website's pictures of the app again; keep the committed ones, so the merge below can switch branches.
  git checkout -- docs/site/img
fi

say "Building the image (Life Is keeps running meanwhile)"
docker compose build >/dev/null || fail "the image did not build; nothing was changed"
# The website is built again to be sure it matches its words (its pictures of the app come from the latest walk-through, so the committed ones are kept). Pages that differ only in line endings (Windows) are put
# back as committed; a page whose words really changed means the committed site is out of date, so stop before anything moves.
node docs/build-site.mjs >/dev/null
git diff --ignore-cr-at-eol --quiet -- docs/site ':!docs/site/img' || fail "the website in docs/site is out of date with its words; run node docs/build-site.mjs, commit it, and deploy again (nothing was changed)"
git checkout -- docs/site
[ -z "$(git status --porcelain)" ] || fail "files changed during the checks: $(git status --porcelain | head -5 | tr '\n' ' '); nothing was changed"

say "Backing up"
stamp=$(date +%Y%m%d-%H%M)
backup="private/backups/before-$branch-$stamp.tgz"
raw="private/backups/before-$branch-$stamp.tar" # a quick uncompressed copy, made while stopped; squeezed into $backup later
[ ! -e "$backup" ] && [ ! -e "$raw" ] && [ ! -e "$backup.partial" ] || fail "a backup named before-$branch-$stamp already exists; wait a minute and try again (nothing was changed)"
docker compose stop
docker run --rm -v lifeis_lifeis_data:/data:ro -v lifeis_lifeis_keys:/keys:ro --entrypoint tar lifeis-lifeis cf - /data /keys > "$raw" && size=$(wc -c < "$raw") || size=0
[ "$size" -gt 100000 ] || { docker compose up -d; fail "the backup copy looks too small ($size bytes, kept at $raw); Life Is was started again unchanged"; }
echo "copy of the data: $raw ($((size / 1048576)) MB); it is compressed after the new version is up"

say "Starting the new version"
docker compose up -d
if ! healthy 8020; then
  say "It did not start; putting the previous version back"
  git checkout -q "$previous"
  docker compose up -d --build
  git checkout -q "$branch"
  if healthy 8020; then
    compress_backup || true
    fail "the new version did not start; the previous one is running again (backup: $backup)"
  fi
  compress_backup || true
  fail "the new version did not start, and neither did the previous one; restore from $backup"
fi
docker logs lifeis-lifeis-1 2>&1 | grep -i "upgrad" | tail -1 || true
if compress_backup; then
  # Keep the 5 newest deploy backups (owner, Nov 25, 2026). Only finished before-*.tgz files count; a kept .tar, a
  # .partial and anything else in the folder (such as the git history bundle) are never touched.
  ls -1t private/backups/before-*.tgz 2>/dev/null | tail -n +6 | while read -r old; do
    rm -f -- "$old" && echo "removed old backup: $old"
  done
else
  echo "warning: the new version is running, but the backup is only the uncompressed copy: $backup" >&2
fi

say "Merging and pushing"
if [ "$branch" != "main" ]; then
  git checkout -q main || fail "the new version is running, but main could not be checked out to merge $branch; merge it by hand"
  git merge --ff-only "$branch" || fail "the new version is running, but $branch could not be merged into main; merge it by hand"
fi
git push origin main || fail "the new version is running and main is merged here, but the push to GitHub failed; push it by hand"

say "The demo"
docker compose -f docker-compose.demo.yml --env-file .env.demo up -d
healthy 8021 || echo "warning: the demo did not answer"

say "The website"
rm -rf private/site.new && cp -r docs/site private/site.new && rm -rf private/site && mv private/site.new private/site
for url in https://lifeis.living/ https://demo.lifeis.living/api/health; do
  host=$(echo "$url" | cut -d/ -f3)
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 --resolve "$host:443:71.94.12.25" "$url" || true)
  echo "$url $code"
  [ "$code" = "200" ] || echo "warning: $host did not answer; Caddy may need starting (see the memory note 'Caddy after a restart')"
done

say "Done. Live: your Life Is, the demo and the website. Backup: $backup"
