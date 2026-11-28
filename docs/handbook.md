# Keeping Life Is running: the handbook

This is for the person who runs a Life Is on their own computer and does not write code. It covers the jobs that
come up when nothing new is being built: checking it, restarting it, backing it up, putting a backup back, updating
it, and handing a job to a helper. You do not need to know TypeScript for any of it.

The other half of this is [the map](map.md), which says where each part of Life Is lives in the code.

**How to type the commands.** Open Git Bash in the Life Is folder (the folder that holds `docker-compose.yml`).
Use Git Bash, not PowerShell, for anything here that makes or reads a backup file: PowerShell changes the file as
it passes through and the backup comes out broken.

## 1. Is it up?

```
docker ps --format '{{.Names}} {{.Status}}'
curl -s http://localhost:8020/api/health
```

- You should see `lifeis-lifeis-1 Up ... (healthy)` and the second command should answer with `ok` in it.
- `lifeis-demo-lifeis-1` is the public demo. It is separate and holds no real data.
- If the list is empty, Docker Desktop is probably not open. See "After the computer restarts" below.

## 2. Start, stop, restart

```
docker compose up -d        # start it (also brings it back after a stop)
docker compose restart      # stop and start again
docker compose stop         # stop it; nothing is deleted
```

None of these touch your data. **Never run `docker compose down -v`.** The `-v` deletes the data.

**After the computer restarts,** two things do not come back by themselves:

1. Open Docker Desktop and wait until it says it is running. Life Is then starts by itself.
2. Start Caddy, the program that puts your sites on the web. Until it runs, Life Is works at
   `http://localhost:8020` on this computer but not at its web address.

## 3. Something is wrong: read what it said

```
docker logs lifeis-lifeis-1 --tail 100
```

This prints the last 100 lines Life Is wrote. Look for the last line that says `error` or `Error`. You do not have
to understand it. Copy it, and the few lines above it, to a helper together with what you were doing when it
broke. Then use "If X breaks, look here" in [the map](map.md) to say which files to look at.

Most trouble is one of these:

| What you see | Most likely | What to do |
|---|---|---|
| The page will not load at all | Docker Desktop or Caddy is not running | Section 2 |
| It loads on this computer but not at its web address | Caddy is not running | Start Caddy |
| It says it is restarting over and over | It cannot open its database or its keys | Read the logs; do not delete anything; ask a helper |
| One page shows an error, the rest work | A bug in that part | Read the logs, find the part in the map |
| It is very slow | The computer is out of memory | Close other programs; check Docker Desktop's memory |

## 4. Backups

Everything Life Is holds is in two Docker volumes: `lifeis_lifeis_data` (the database, pictures and papers) and
`lifeis_lifeis_keys` (the keys that unlock saved passwords and links). A backup is a copy of both. One without the
other is not enough.

**Backups you already have.** Every deploy makes one before it changes anything:
`private/backups/before-<name>-<date>.tgz`. The 5 newest are kept. Life Is also keeps its own copy of the database
inside the data volume before each database upgrade (`lifeis.before-v<number>.db`).

**Make one by hand** (Life Is is down for about a minute):

```
docker compose stop
MSYS_NO_PATHCONV=1 docker run --rm -v lifeis_lifeis_data:/data:ro -v lifeis_lifeis_keys:/keys:ro --entrypoint sh lifeis-lifeis -c 'cd / && tar cf - data keys' | gzip > private/backups/by-hand-$(date +%Y%m%d-%H%M).tgz
docker compose start
ls -la private/backups | tail -3
```

The last line shows the new file. It should be many megabytes, not a few bytes. If it is tiny, it did not work:
delete that one file and try again.

**Keep a copy somewhere else.** `private/backups` is on the same disk as Life Is. A disk that dies takes both.
Copy the newest `.tgz` to another disk or another computer now and then. Whoever holds that file holds everything
in your Life Is, so keep it somewhere you trust.

**From inside Life Is:** Settings, Your data, Export everything makes a zip of plain spreadsheets, pictures and
papers that you can read without Life Is at all. It is the copy to make if you ever want to leave.

## 5. Put a backup back

Do this only when the data is truly damaged or lost. It replaces what is there now with what the backup held.
Anything added since that backup was made will be gone. If you are not sure, stop and ask a helper first.

The steps below set today's database aside before they put the old one back. Nothing is deleted.

```
docker compose stop
MSYS_NO_PATHCONV=1 docker run --rm -v lifeis_lifeis_data:/data --entrypoint sh lifeis-lifeis -c 'mkdir -p /data/set-aside-now && for f in /data/lifeis.db*; do [ ! -e "$f" ] || mv "$f" /data/set-aside-now/; done'
gzip -dc private/backups/THE-BACKUP-FILE.tgz | MSYS_NO_PATHCONV=1 docker run --rm -i -v lifeis_lifeis_data:/data -v lifeis_lifeis_keys:/keys --entrypoint sh lifeis-lifeis -c 'cd / && tar xf -'
docker compose start
curl -s http://localhost:8020/api/health
```

Put the real file name in place of `THE-BACKUP-FILE.tgz`.

**One thing to know first.** A backup can only be opened by a Life Is that is the same version as the one that
made it, or newer. If the backup is older than the Life Is that is running, that is fine: it upgrades the database
when it starts. If you have gone back to an older Life Is (section 7), use a backup made by that version or an
earlier one.

If it does not come up healthy, read the logs (section 3). The database you set aside is still in the data volume,
in the folder `set-aside-now`.

## 6. Update Life Is (deploy)

When a change is ready on a branch, from that branch:

```
bash scripts/deploy.sh --check
```

`--check` runs every test first. Then the script builds the new version while the old one keeps running, makes a
backup, starts the new version, checks that it answers, and only then merges and pushes. If the new version does
not start, it puts the old one back by itself.

How to read what it says:

- `STOPPED: ... nothing was changed`: it stopped before touching anything. Fix what it names and run it again.
- `STOPPED: ... tests failed`: a test failed. Nothing was changed. One test that fails with "fetch failed" when the
  computer is busy, and passes when run alone, is not a real failure. Anything else is.
- `the new version did not start; the previous one is running again`: the update was bad. You are back on the old
  version and the backup it names is safe.
- `Done. Live: ...`: it worked.

Run the script from the main Life Is folder, on a branch whose name has no slash in it.

## 7. Go back to an earlier version

If an update works but turns out to be bad, the safest way back is forward: have a helper fix it on a new branch
and deploy again.

Going back to older code is possible, but mind the database. Each version of Life Is may upgrade the database, and
an older Life Is cannot open a database a newer one has upgraded. So going back means two things together: the
older code, and a backup made before the update (the `before-...` file from that deploy). That loses whatever was
added since. Ask a helper before doing this.

## 8. Jobs that come round about once a year

You do not need to do these yourself, but you need to know they exist so you can ask for them.

- **The tools Life Is is built on get security fixes.** Ask a helper: "Update the dependencies in core, server and
  frontend to their newest safe versions, run every test and walk-through, and tell me what changed." Then deploy.
- **The phone apps must be rebuilt for the stores about once a year.** Google and Apple each ask that an app be
  built against a recent version of their system, or it stops being offered to new people. Ask a helper: "Raise
  the Android target version to what Google Play asks for now, rebuild, and test on a phone."
- **Node, the program Life Is runs on, gets new versions.** The `Dockerfile` names the one in use. A helper can
  raise it and run the tests.

If none of this is done, your own Life Is keeps running as it is. These jobs matter for safety on the open web and
for staying in the app stores.

## 9. Handing a job to a helper

A helper can be a hired person, a cheaper AI model, or a free model running on your own computer. The project is
set up so a weaker helper is caught when it gets something wrong.

Give every helper the same four things:

1. `CLAUDE.md` in the project folder. It holds the rules of this project. Tell them to read it first.
2. [The map](map.md), and the names of the files the job touches.
3. The job in one or two sentences, and what "done" looks like.
4. This rule: "Work on a new branch. Do not merge, push or deploy. Run the tests in CLAUDE.md and show me the
   result lines."

Then you check three things, none of which needs code:

- The tests passed. The result lines say so.
- The change does what you asked. Look at the real page.
- It changed only the files it said it would: `git diff --stat main` lists them.

Only then deploy (section 6). The deploy runs every test again and puts the old version back if the new one fails,
so a bad change is very unlikely to reach your data.

**Good jobs for a weak helper:** change some words, fix one small bug in one part, explain what a file does.
**Jobs that need a strong helper:** anything that changes the database, anything across many parts, the phone
apps, sign-in and security.

## 10. If the computer is lost

You need two things: the code and a backup.

1. The code is on GitHub. Install Docker Desktop and Git on the new computer and download ("clone") the project.
2. In the project folder: `docker compose up -d`. This builds and starts an empty Life Is.
3. Put your newest backup back (section 5). This is why a copy of the backup must live somewhere else.

Without a backup kept somewhere else, the data is gone. The code can always be downloaded again.
