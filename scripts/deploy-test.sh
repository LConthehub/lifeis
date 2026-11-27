#!/usr/bin/env bash
# Tries scripts/deploy.sh on a throwaway copy: a made-up git folder, with stand-ins for docker, curl, node and sleep
# that only write down what they were asked to do. Nothing real is stopped, started, built or pushed.
#   bash scripts/deploy-test.sh            tries scripts/deploy.sh
#   bash scripts/deploy-test.sh <file>     tries another copy of it
# Everything it makes is in a temporary folder, removed at the end.
set -uo pipefail
script=$(cd "$(dirname "${1:-$0}")" && pwd)/$(basename "${1:-deploy.sh}")
here=$(mktemp -d)
trap 'cd /; rm -rf "$here"' EXIT
pass=0; bad=0
check() { if eval "$2"; then pass=$((pass + 1)); echo "  PASS $1"; else bad=$((bad + 1)); echo "  FAIL $1"; fi; }

fakes="$here/fakes"
rm -rf "$fakes" && mkdir -p "$fakes"
cat > "$fakes/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
if [ "$1" = "run" ]; then
  # Putting the database back after a start that failed: takes the copy in, and works unless FAKE_PUTBACK says no.
  case " $* " in *"failed-"*) cat > /dev/null; [ "${FAKE_PUTBACK:-ok}" = ok ]; exit ;; esac
  # The backup comes in two parts: everything but the live database while running (FAKE_FIRST), then the live
  # database and keys while stopped (FAKE_BACKUP). A good part is a real little tar, so the two can be joined.
  mode="${FAKE_BACKUP:-ok}"; case " $* " in *"--exclude"*) mode="${FAKE_FIRST:-ok}" ;; esac
  case "$mode" in
    ok) d=$(mktemp -d) && head -c 300000 /dev/urandom > "$d/part" && tar cf - -C "$d" part; rm -rf "$d" ;;
    db) d=$(mktemp -d) && mkdir "$d/data" && head -c 300000 /dev/urandom > "$d/data/lifeis.db" && tar cf - -C "$d" data; rm -rf "$d" ;;
    empty) : ;;
    small) printf 'only a little'; exit 1 ;;
  esac
fi
exit 0
EOF
cat > "$fakes/curl" <<'EOF'
#!/usr/bin/env bash
# FAKE_HEALTH: up, down, or back (the new version never answers; the one from before does, once it is started again)
case " $* " in *" -w "*) printf 200 ;; *)
  case "${FAKE_HEALTH:-up}" in up) printf '{"status":"ok"}' ;; back) grep -q -- "compose up -d --build" "$FAKE_LOG" && printf '{"status":"ok"}' ;; esac ;;
esac
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$fakes/node"
printf '#!/usr/bin/env bash\nexit 0\n' > "$fakes/sleep"
chmod +x "$fakes"/*

# A fresh made-up project for each try, on the branch given, with its own pretend GitHub beside it.
fresh() { # $1 = branch
  work="$here/work"; rm -rf "$work" "$here/remote.git"
  git init -q --bare "$here/remote.git"
  mkdir -p "$work/scripts" "$work/docs/site" && cd "$work" || exit 1
  git init -q -b main . && git config user.email t@example.invalid && git config user.name t && git config core.autocrlf false
  cp "$script" scripts/deploy.sh
  echo '<p>site</p>' > docs/site/index.html
  printf 'private/\n' > .gitignore
  git add -A && git commit -q -m first && git remote add origin "$here/remote.git" && git push -q origin main
  git checkout -q -b "$1" && echo change > file.txt && git add -A && git commit -q -m change
  export FAKE_LOG="$here/docker.log"; : > "$FAKE_LOG"
}
try() { PATH="$fakes:$PATH" bash scripts/deploy.sh > "$here/out.log" 2>&1; code=$?; }
log() { grep -c -- "$1" "$FAKE_LOG"; }

echo "1. A branch with a slash in its name, and a good backup"
fresh claude/slash-test; FAKE_BACKUP=ok try
check "it finishes" '[ $code -eq 0 ]'
check "the backup is one file, with a dash where the slash was" 'ls private/backups/before-claude-slash-test-*.tgz >/dev/null 2>&1 && [ "$(ls private/backups | wc -l)" -eq 1 ]'
check "the new version is started, after the stop" '[ "$(log "compose up -d")" -ge 1 ] && [ "$(log "compose stop")" -eq 1 ]'
check "main is merged and pushed" '[ "$(git rev-parse main)" = "$(git rev-parse claude/slash-test)" ] && [ "$(git -C "$here/remote.git" rev-parse main)" = "$(git rev-parse main)" ]'

echo "2. The backup comes out empty"
fresh plain; FAKE_BACKUP=empty try
check "it stops with an error" '[ $code -ne 0 ]'
check "the new version is never started (no compose up)" '[ "$(log "compose up")" -eq 0 ]'
check "the version from before is started again (compose start)" '[ "$(log "compose start")" -eq 1 ]'
check "it says so" 'grep -q "the version from before was started again, and the new one was not" "$here/out.log"'
check "no empty backup file is left behind" '[ -z "$(find private/backups -type f -empty 2>/dev/null)" ]'
check "main is not merged or pushed" '[ "$(git rev-parse main)" != "$(git rev-parse plain)" ] && [ "$(git -C "$here/remote.git" rev-parse main)" = "$(git rev-parse main)" ]'

echo "3. The backup breaks off after a few bytes"
fresh plain; FAKE_BACKUP=small try
check "it stops with an error" '[ $code -ne 0 ]'
check "the new version is never started" '[ "$(log "compose up")" -eq 0 ] && [ "$(log "compose start")" -eq 1 ]'
check "the little that was copied is kept, not deleted" '[ -s "$(ls private/backups/before-plain-*.tar)" ]'

echo "4. The backup file can't be written at all"
fresh plain; mkdir -p private && echo "in the way" > private/backups; FAKE_BACKUP=ok try
check "it stops with an error" '[ $code -ne 0 ]'
check "nothing is stopped or started" '[ "$(log "compose stop")" -eq 0 ] && [ "$(log "compose up")" -eq 0 ] && [ "$(log "compose start")" -eq 0 ]'
check "it says Life Is was not stopped" 'grep -q "Life Is was not stopped" "$here/out.log"'

echo "5. Empty backup, and the version from before does not answer afterward"
fresh plain; FAKE_BACKUP=empty FAKE_HEALTH=down try
check "it stops with an error and says to check" '[ $code -ne 0 ] && grep -q "did not answer after being started again" "$here/out.log"'
check "the new version is still never started" '[ "$(log "compose up")" -eq 0 ]'

echo "6. The first part of the backup, made while Life Is runs, comes out empty"
fresh plain; FAKE_FIRST=empty try
check "it stops with an error" '[ $code -ne 0 ] && grep -q "Life Is was not stopped" "$here/out.log"'
check "nothing is stopped or started" '[ "$(log "compose stop")" -eq 0 ] && [ "$(log "compose up")" -eq 0 ] && [ "$(log "compose start")" -eq 0 ]'
check "no empty backup file is left behind" '[ -z "$(find private/backups -type f -empty 2>/dev/null)" ]'

echo "7. A good backup holds both parts: the first part is copied before the stop, the live database after"
fresh plain; FAKE_BACKUP=ok try
check "it finishes" '[ $code -eq 0 ]'
check "the first part is copied while running, then the stop, then the live database" '[ "$(grep -n -e "--exclude" -e "compose stop" -e "data/lifeis.db\* keys" "$FAKE_LOG" | cut -d: -f2 | cut -c1-20 | tr "\n" "|")" = "docker run --rm -v l|docker compose stop|docker run --rm -v l|" ]'
check "the backup has both parts in it" '[ "$(gzip -dc private/backups/before-plain-*.tgz | tar tf - | wc -l)" -eq 2 ]'

echo "8. The new version does not start: the version from before and its database are put back"
fresh plain; FAKE_BACKUP=db FAKE_HEALTH=back try
check "it stops with an error" '[ $code -ne 0 ]'
check "the database is put back after the stop and before the version from before is started" '[ "$(grep -n -e "^docker compose stop" -e "^docker run --rm -i" -e "^docker compose up -d --build" "$FAKE_LOG" | cut -d: -f2 | cut -c1-17 | tr "\n" "|")" = "docker compose st|docker compose st|docker run --rm -|docker compose up|" ]'
check "it says the data is as it was, and where the failed database is kept" 'grep -q "the previous one is running again, with the data as it was before this deploy" "$here/out.log" && grep -q "kept in the data folder as failed-" "$here/out.log"'
check "the backup is kept and no scratch copy is left" 'ls private/backups/before-plain-*.tgz >/dev/null 2>&1 && [ -z "$(ls -d private/backups/putback-* 2>/dev/null)" ]'
check "main is not merged or pushed" '[ "$(git rev-parse main)" != "$(git rev-parse plain)" ] && [ "$(git -C "$here/remote.git" rev-parse main)" = "$(git rev-parse main)" ]'

echo "9. The new version does not start, and the database can't be put back"
fresh plain; FAKE_BACKUP=db FAKE_PUTBACK=no FAKE_HEALTH=down try
check "it stops with an error and says so" '[ $code -ne 0 ] && grep -q "could NOT be put back" "$here/out.log" && grep -q "restore from" "$here/out.log"'
check "the backup is still kept" 'ls private/backups/before-plain-*.t* >/dev/null 2>&1'

echo "10. The new version does not start, and the backup has no database in it to put back"
fresh plain; FAKE_BACKUP=ok FAKE_HEALTH=back try
check "nothing in the data folder is touched" '[ "$(log "failed-")" -eq 0 ]'
check "it says the database could not be put back" 'grep -q "could NOT be put back" "$here/out.log"'

echo
echo "$pass passed, $bad failed"
[ "$bad" -eq 0 ]
