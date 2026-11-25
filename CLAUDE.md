# Life Is: rules for working here

Read this before changing anything. It applies to every session and every subagent.

## What it is

A private home organizer. TypeScript core in `core/` (all the logic), a Node 24 server in `server/` (no framework,
runs `.ts` directly), React 18 + Vite + Tailwind 3 pages in `frontend/`, a Capacitor 8 phone app in
`frontend/android` (no iOS project yet), and the website built by `node docs/build-site.mjs` into `docs/site`.
The owner's list of ideas is a Claude Doc (see "The ideas list" below).

## Hard rules

- **Pages never import from `core/`** (except `frontend/src/device/`). The Docker image builds the pages from
  `frontend/` alone, so such an import works on this PC and fails in the image. Anything a page needs from core
  comes through the API. A test enforces this.
- **Database changes:** one new migration at a time, numbered after the last one in `core/src/migrations.ts`, plain
  `CREATE TABLE` / `ALTER TABLE ADD COLUMN` only (migrations run with foreign keys on, so no table rebuilds). A new
  table goes at the FRONT of the drop list in the upgrade test in `server/tests/app.test.ts`.
- **Nothing reaches outside the device** unless the person turns it on and the screen says exactly what is sent and
  to whom. Follow the pattern in `core/src/lookups.ts` (a service with a `sends` sentence, off by default).
- **No drawn or generated art, ever.** The owner is against AI image generation. Art comes only from the owner's own
  files (`frontend/src/art.js` lists them; originals live in `private/my-art/`, never modified). Flat color and layout
  are fine.
- **Privacy:** no personal names, addresses, emails or the owner's personal domain in code, commits, the website or
  the demo. Sworkr's details never enter Life Is (only times cross, busy-only).
- **Money in cents**, integers only.
- **Words:** plain American English (store, check a box, catalog, color, buggy for the shopping cart). Short
  sentences, no jargon, no marketing words, no em dashes, no emoji beyond what pages already use.
- **Phones:** every page fits 375px wide with no sideways scroll; controls at least 44px tall.
- **TMDB film lookups** are offered only on a Life Is the person hosts (never in the phone app keeping data on the
  phone); see the comment in `frontend/src/pages/Settings.jsx`.

## This PC

- Windows, 16 GB RAM, running many other services. Run one heavy job at a time. No Android build without asking.
- The Bash tool is Git Bash: shell heredocs and `sed` mangle apostrophes and backslashes. Edit files with the
  Edit/Write tools. Prefix Docker commands that carry container paths with `MSYS_NO_PATHCONV=1`.
- Never touch `D:\needtogothrough\Downloads\Dropbox`.

## Tests

```
cd core && npx tsc --noEmit -p . && npx vitest run
cd server && npx tsc --noEmit -p . && npx vitest run   # "fetch failed"/dropped socket under load: rerun that file alone
cd frontend && npx vite build
node docs/build-site.mjs && node e2e/site.mjs          # every line PASS
node e2e/run.mjs <names>                               # browser walk-throughs; no names = all; add --slow for screen-sizes
```

A subagent runs the tests and walk-throughs for what it touched. The full set runs once, on the combined result.
A single walk-through failure that passes when rerun alone is a flake; anything else is real.

## Deploying

Only when the owner says so ("deploy", "merge and deploy"). Then, from the branch to deploy:

```
bash scripts/deploy.sh            # build image, back up, start, health check, merge to main, push, demo, website
bash scripts/deploy.sh --check    # the same, but runs every test first and stops if any fails
```

The script builds the image before stopping anything, and puts the previous version back if the new one does not
start. Never run the steps by hand unless the script fails. After a good deploy the script keeps the 5 newest
`before-*.tgz` backups and removes older ones (owner, Nov 25, 2026); never delete anything else in `private/backups`.
Save deploy and test logs as `private/logs/<what>-<date>.log` and keep only the 5 newest there.

## Subagents

- Give each one a short brief: the task, the exact files it may and may not edit, what done looks like, and which
  tests and walk-throughs to run. Point it at this file for everything else instead of repeating these rules.
- Haiku for small, exact fixes; Sonnet for anything needing judgment or touching several parts.
- **Reports are short:** at most about ten lines: what changed (files), what passed (the result lines), and anything
  uncertain or not verified. No essays, no repeating the brief. Details only when asked.
- Check their work yourself before trusting it: read the diff and look at screenshots for what tests cannot see.

## The ideas list

The owner's list is a Claude Doc: https://claude.ai/artifact/Cgmy3UDTx19AtZuzvbDgfM (doc id
5ea23e64-e16f-46a2-8e03-12460407518c, body node fe4476cd-6b94). Read it with the docs tools, never web-fetch it.
"Work the list" means: read the Inbox, ask about anything unclear, hand the ready items to subagents, check their work,
run the tests, report briefly, and ask before deploying. A nightly run (about 3 am) does the same on a branch and
never deploys; a Sunday review checks the week's work. Keep sessions short: start a fresh one per day or batch; the
doc and memory carry everything over.
