# A map of the Life Is code

This map is for the owner. Its job is simple: when something breaks, you find the few files it lives in and tell a
helper (a person you hire, or an AI model) where to look. You do not need to read any code.

All paths are from the top folder of the project. A "helper" can open any path below as written.

## The big picture

Life Is has four parts.

1. **core** (`core/src`). All the logic. What a recipe is, how a grocery list is made, when a chore is due. Each file
   starts with a short comment in plain words saying what it does.
2. **server** (`server/src`). The program that runs in Docker. It answers the pages over the web, and it signs
   people in. It holds almost no logic of its own. It passes requests to core.
3. **frontend** (`frontend/src`). The pages people see and tap. Built with React (a tool for making web pages).
   `frontend/src/pages` has one file per page. `frontend/src/components` has the pieces pages share.
4. **The phone app** (`frontend/src/device` and `frontend/android`). The same pages, wrapped as an Android app. It
   can keep all data on the phone, with no server at all.

How a tap travels:

1. You tap a button on a page (a file in `frontend/src/pages`).
2. The page asks for an address that starts with `/api/...` (for example `/api/kitchen/grocery`).
3. A "routes" file in `server/src` answers that address. It reads what was sent and passes it on.
4. A file in `core/src` does the real work and reads or writes the database.
5. The database is one SQLite file (SQLite is a small database kept in a single file). It is locked with
   encryption.

In the phone app, steps 3 and 4 happen inside the phone. `frontend/src/device/answer.js` hands the page's request
to the same routes files the server uses.

Where data lives: on the server, in one encrypted database file under the data folder (in Docker, the volume
`lifeis_data`). The key that opens it is kept apart, in its own volume (`lifeis_keys`). Never run
`docker compose down -v`, because the `-v` deletes those volumes. On the phone, the database is on the phone.

## Where things live, by what people see

Each entry gives the page, the routes file, the core file, the tests, and the walk-throughs (a walk-through is a
script that opens a real browser and clicks through the app like a person).

Test files are in `core/tests` (logic) and `server/tests` (addresses). Walk-throughs are in `e2e/specs`, and each
name below is a file there ending in `.mjs`.

Many routes live in one big file, `server/src/everydayRoutes.ts`. It also hands out to the smaller routes files.

### Home (the front page)

- Page: `frontend/src/pages/Home.jsx`
- Routes: `server/src/everydayRoutes.ts` (`/api/home`)
- Core: `core/src/home.ts` (gathers cards from every section), `core/src/dontForget.ts` (the three quiet
  "don't forget" lines), `core/src/weather.ts` (off until the person turns it on)
- Tests: `core/tests/home.test.ts`, `dashboard.test.ts`, `dontForget.test.ts`
- Walk-throughs: `home`, `dont-forget`

### Recipes and cooking

- Pages: `frontend/src/pages/Recipes.jsx`. Pieces: `frontend/src/components/CookingView.jsx`, `CookTimers.jsx`,
  `RecipeFile.jsx`, `unpackRecipes.js`
- Routes: `server/src/everydayRoutes.ts` (`/api/kitchen/recipes`), `server/src/cookingTimerRoutes.ts` and
  `server/src/cookTimers.ts` (cooking timers; they live in the server's memory, so a restart loses running ones)
- Core: `core/src/kitchen.ts` (recipes, week, pantry and groceries are all linked here), `recipeText.ts` (splitting
  typed recipes into lines and steps), `recipeFiles.ts` (recipes from other apps' files), `recipeWeb.ts` (a recipe
  from a web page), `units.ts` (reading "1 1/2 cups"), `cookTimer.ts` (reading "simmer 12 minutes")
- Tests: `core/tests/kitchen.test.ts`, `recipeText.test.ts`, `recipeFiles.test.ts`, `recipeWeb.test.ts`,
  `units.test.ts`, `cookTimer.test.ts`, `recipePhotos.test.ts`; `server/tests/cookingTimers.test.ts`
- Walk-throughs: `cooking`, `recipe-photos`, `bring-in`

### The week and prep reminders

- Page: `frontend/src/pages/Week.jsx`. Piece: `frontend/src/components/WeekTools.jsx`, `PrepSteps.jsx`
- Routes: `server/src/everydayRoutes.ts` (`/api/kitchen/plan`, `/api/prep/...`)
- Core: `core/src/kitchen.ts` (the week's meals), `core/src/prep.ts` ("thaw the chicken the night before")
- Tests: `core/tests/week.test.ts`, `prep.test.ts`
- Walk-throughs: `kitchen-week`, `prep`

### Groceries and shopping

- Page: `frontend/src/pages/Groceries.jsx`. Pieces: `frontend/src/components/groceryText.js`, `PasteList.jsx`,
  `ArrangeAisles.jsx`, `Scanner.jsx`, `BulkScan.jsx`
- Routes: `server/src/everydayRoutes.ts` (`/api/kitchen/grocery`), `server/src/shoppingRoutes.ts` (`/api/shopping`:
  prices, coupons, the running total)
- Core: `core/src/kitchen.ts` (the list itself), `core/src/shopping.ts` (prices, total, coupons), `core/src/trips.ts`
  (done shopping at a store: becomes spending), `core/src/receipt.ts` (reading a receipt)
- Tests: `core/tests/shopping.test.ts`, `groceryText.test.ts`, `aisles.test.ts`, `receipt.test.ts`,
  `receipts.test.ts`, `budgetTrips.test.ts`
- Walk-throughs: `kitchen-week`, `grocery-line-scan`, `receipts`, `budget-trips`

### Pantry and prices

- Pages: `frontend/src/pages/Pantry.jsx`, `frontend/src/pages/Prices.jsx`. Pieces: `ScanToPantry.jsx`, `UseItUp.jsx`
- Routes: `server/src/everydayRoutes.ts` (`/api/kitchen/pantry`), `server/src/shoppingRoutes.ts`
  (`/api/shopping/stores`, `/api/shopping/trends`)
- Core: `core/src/kitchen.ts`, `core/src/shopping.ts`
- Tests: `core/tests/pantry.test.ts`, `quickUse.test.ts`, `shopping.test.ts`
- Walk-throughs: `kitchen-week`, `barcode-lookups` (barcode lookups go online)

### Things and places

"Things" are what a person keeps (tools, fabric, anything). "Places" are where they are kept.

- Pages: `frontend/src/pages/Things.jsx`, `Thing.jsx`, `Places.jsx`, `FillPlace.jsx`, `WalkThrough.jsx`,
  `ThingStickers.jsx`, `SharedThing.jsx`, `HomeReport.jsx`, `GunList.jsx`
- Routes: `server/src/makingRoutes.ts` (`/api/things`)
- Core: `core/src/inventory.ts` (things, kinds, places), `starters.ts` (ready-made kinds), `history.ts` (what
  happened to a thing), `whereabouts.ts` (what a scanned sticker was), `homebox.ts` (bringing things in from
  HomeBox), `packing.ts` (numbered boxes for a move)
- Tests: `core/tests/thingsKept.test.ts`, `records.test.ts`, `whereabouts.test.ts`, `homebox.test.ts`,
  `packing.test.ts`, `guns.test.ts`, `starters.test.ts`
- Walk-throughs: `books-and-places`, `fill-a-place`, `things-kept`, `gear-and-copy-history`, `homebox-in`, `packing`,
  `records`, `guns`

### Upkeep and chores

- Pages: `frontend/src/pages/Upkeep.jsx` (also holds the single job page), `ChoreChart.jsx`, `Activities.jsx`
- Routes: `server/src/makingRoutes.ts` (`/api/things/upkeep`)
- Core: `core/src/upkeep.ts` (jobs that come round again, and each time they were done)
- Tests: `core/tests/upkeep.test.ts`, `upkeepChart.test.ts`, `upkeepSets.test.ts`
- Walk-throughs: `upkeep`, `household`, `family`

### Routines and measures

- Pages: `frontend/src/pages/Routines.jsx`, `Measures.jsx`. Piece: `frontend/src/components/Routines.jsx`
- Routes: `server/src/routineRoutes.ts` (`/api/routines`, `/api/routine-day`), `server/src/measureRoutes.ts`
- Core: `core/src/routines.ts` (checklists for parts of the day), `core/src/measures.ts` (a person's own numbers
  over time; private to that person)
- Tests: `core/tests/routines.test.ts`, `measures.test.ts`; `server/tests/routines.test.ts`, `measures.test.ts`
- Walk-throughs: `routines`, `pet-routines`, `workouts`, `measures`

### Calendar

- Page: `frontend/src/pages/Calendar.jsx`
- Routes: `server/src/enjoyingRoutes.ts` (`/api/calendar`)
- Core: `core/src/calendar.ts` (gathers each day from other sections), `feed.ts` (the link a phone's calendar app
  reads), `follow.ts` (other calendars shown busy-only)
- Tests: `core/tests/feed.test.ts`, `follow.test.ts`, `enjoying.test.ts`
- Walk-throughs: `calendar-link`

### Plans, holidays and trips

- Pages: `frontend/src/pages/Plans.jsx`, `Holidays.jsx`, `Trips.jsx`. Piece: `components/HolidayCard.jsx`
- Routes: `server/src/planRoutes.ts` (`/api/plans`, `/api/photos`), `holidayRoutes.ts`, `outdoorTripRoutes.ts`
- Core: `core/src/plans.ts`, `holidays.ts`, `holidayDates.ts` (when a holiday falls), `outdoorTrips.ts`,
  `photos.ts` (an Immich photo library, off until connected)
- Tests: `core/tests/plans.test.ts`, `holidays.test.ts`, `holidayDates.test.ts`, `outdoorTrips.test.ts`;
  `server/tests/holidays.test.ts`, `outdoorTrips.test.ts`, `photos.test.ts`
- Walk-throughs: `holidays`, `trips`, `photo-library` (needs Docker test setup)

### Money and budget

- Pages: `frontend/src/pages/Money.jsx`, `Budgeting.jsx`. Pieces: `components/Budget.jsx`, `Goals.jsx`,
  `BankReading.jsx`, `Statement.jsx`
- Routes: `server/src/moneyRoutes.ts` (`/api/money`)
- Core: `core/src/money.ts` (planned and spent), `budget.ts` (income, bills, savings), `goals.ts`,
  `goalFigures.ts`, `bankStatement.ts` (a bank's CSV file brought in), `simplefin.ts` (bank accounts through
  SimpleFIN, off until turned on)
- Tests: `core/tests/money.test.ts`, `budget.test.ts`, `goals.test.ts`, `bankStatement.test.ts`,
  `simplefin.test.ts`; `server/tests/bank.test.ts`
- Walk-throughs: `spending`, `budget`, `goals`, `bank-reading`
- Rule: money is whole cents, never decimals.

### Media and collection (films, shows, music, books, games)

- Pages: `frontend/src/pages/Media.jsx` (the collection), `Lists.jsx` (lists of titles), `Servers.jsx` (media
  servers), `CollectionPrint.jsx`. Pieces: `components/MediaList.jsx`, `BookList.jsx`, `BookServers.jsx`,
  `LetterboxdIn.jsx`
- Routes: `server/src/enjoyingRoutes.ts` (`/api/media`), `server/src/connectionRoutes.ts` (`/api/connections`)
- Core: `core/src/media.ts`, `mediaLists.ts`, `connections.ts` (Jellyfin and Emby), `libraries.ts` (book servers),
  `letterboxd.ts`, `bookList.ts`, `lookups.ts` (looking a title up from a barcode; off until turned on),
  `digest.ts` (one way of signing in to a book server)
- Tests: `core/tests/mediaLists.test.ts`, `libraries.test.ts`, `letterboxd.test.ts`, `audiobooks.test.ts`,
  `lookups.test.ts`, `enjoying.test.ts`; `server/tests/connections.test.ts`, `libraries.test.ts`,
  `letterboxd.test.ts`
- Walk-throughs: `collection`, `book-servers`, `media-servers`, `letterboxd`, `film-lookup`, `bring-in`

### Pets

- Page: `frontend/src/pages/Pets.jsx`
- Routes: `server/src/makingRoutes.ts` (`/api/things/pets`)
- Core: `core/src/pets.ts` (a pet's care is upkeep, so it comes due like any job)
- Tests: `core/tests/pets.test.ts`
- Walk-throughs: `pets`, `pet-routines`

### House manual

- Pages: `frontend/src/pages/Manual.jsx`, `HomeServices.jsx`. Printing: `frontend/src/print/ManualSheets.jsx`,
  `manualParts.js`
- Routes: `server/src/everydayRoutes.ts` (`/api/manual`, `/api/home-services`). The shared link that needs no
  sign-in is served from `server/src/app.ts`.
- Core: `core/src/manual.ts`, `core/src/homeServices.ts`
- Tests: `core/tests/manual.test.ts`, `homeServices.test.ts`
- Walk-throughs: `manual`, `home-services`, `printouts`

### Projects

- Page: `frontend/src/pages/Projects.jsx`
- Routes: `server/src/makingRoutes.ts` (`/api/projects`)
- Core: `core/src/projects.ts`
- Tests: `core/tests/making.test.ts`
- Walk-throughs: none named for projects alone; `things-kept` and `gear-and-copy-history` touch them (not checked
  in detail)

### Licenses and permits

- Page: `frontend/src/pages/Licenses.jsx`
- Routes: `server/src/licenseRoutes.ts`
- Core: `core/src/licenses.ts` (a license can set up a renewal in upkeep)
- Tests: `core/tests/licenses.test.ts`
- Walk-throughs: `licenses`

### Car recalls

- Piece: `frontend/src/components/Recalls.jsx`
- Routes: `server/src/recallRoutes.ts`
- Core: `core/src/recalls.ts` (asks the U.S. government's recall service; off until turned on)
- Tests: `core/tests/recalls.test.ts`; `server/tests/recalls.test.ts`
- Walk-throughs: `recalls`

### Mail

- Page: `frontend/src/pages/Mail.jsx`
- Routes: `server/src/mailRoutes.ts`; `server/src/postbox.ts` is what really talks to the mail provider
- Core: `core/src/mail.ts` (no message is ever stored)
- Tests: `core/tests/mail.test.ts`; `server/tests/postbox.test.ts`
- Walk-throughs: `mail` (needs the Docker test setup)

### Reminders (the morning digest and notifications)

- Piece: `frontend/src/components/Reminders.jsx` (shown inside Settings)
- Routes: `server/src/everydayRoutes.ts` (`/api/reminders`); `server/src/push.ts` (browser notifications)
- Core: `core/src/reminders.ts`, `core/src/prep.ts`
- Phone: `frontend/src/device/phoneReminders.js` makes the reminders on the phone itself
- Tests: `core/tests/reminders.test.ts`, `prep.test.ts`
- Walk-throughs: `reminders`

### Settings

- Page: `frontend/src/pages/Settings.jsx` (one big page that holds many groups)
- Routes: many, since Settings calls the address of whatever it shows (reminders, backups, the assistant, mail,
  the calendar link and more)
- Walk-throughs: `settings`, `household`
- Also: `core/src/displayName.ts` (the name shown for a person), `core/src/life.ts` (what a person wants Life Is to
  look after, which decides which sections show)

### Sign-in and security

- Pages: `frontend/src/pages/Login.jsx`; piece `frontend/src/components/Security.jsx`, `passkeys.js`
- Server: `server/src/auth.ts` (passwords and sessions), `securityRoutes.ts`, `secondStep.ts` (authenticator codes),
  `passkeys.ts`, `vault.ts` (locks saved keys), `keys.ts` (the key files kept apart from the database),
  `database.ts` (the encrypted database file)
- Tests: `server/tests/security.test.ts`, `server/tests/app.test.ts`
- Walk-throughs: `security`

### Backups and export

- Pieces: `frontend/src/components/YourFiles.jsx` (download everything, bring it back), `AutoBackup.jsx`
- Routes: `server/src/exportRoutes.ts` (`/api/export`)
- Core: `core/src/backup.ts` (one locked file, opened only by a passphrase), `core/src/exportAll.ts` (everything
  as open files: spreadsheets, recipes, pictures)
- Phone: `frontend/src/device/autoBackup.js`, `handOver.js`
- Tests: `core/tests/backup.test.ts`, `exportAll.test.ts`
- Walk-throughs: `backup` (on the phone app's pages), `export`

### The first-run start

- Pieces: `frontend/src/components/Start.jsx` (the short questions for a new household);
  `frontend/src/device/Welcome.jsx` (the phone app's first screen)
- Routes: `server/src/startRoutes.ts` (`/api/start`)
- Core: `core/src/start.ts`, `life.ts`, `starters.ts`
- Tests: `core/tests/start.test.ts`, `life.test.ts`, `starters.test.ts`
- Walk-throughs: `start`, `easing-in`

### The assistant, the AI connector and voice

- Assistant: `frontend/src/components/Assistant.jsx`, `server/src/assistantRoutes.ts`, `core/src/assistant.ts`,
  `frontend/src/device/phoneModel.js` (the phone's own AI); test `core/tests/assistant.test.ts`; walk-through
  `assistant`
- Use Life Is from your AI app: `frontend/src/pages/Connect.jsx`, `components/Connector.jsx`,
  `server/src/connectorRoutes.ts`, `connectorAuth.ts` (the sign-in an AI app does), `core/src/connector.ts`; tests
  `core/tests/connector.test.ts`, `server/tests/connector.test.ts`; walk-through `connector`
- Short requests and voice shortcuts: `frontend/src/pages/DoAction.jsx`, `server/src/actionRoutes.ts`,
  `keyRoutes.ts`, `personalKeys.ts`, `core/src/actions.ts`, `voice.ts`; tests `core/tests/actions.test.ts`,
  `voice.test.ts`, `server/tests/keys.test.ts`; walk-through `keys`

### Search

- Piece: `frontend/src/components/Search.jsx`
- Routes: `server/src/everydayRoutes.ts` (`/api/search`)
- Core: `core/src/search.ts`
- Tests: `core/tests/search.test.ts`
- Walk-throughs: `search`

### Tags

- Page: `frontend/src/pages/Tags.jsx`. Piece: `frontend/src/components/tags.jsx`
- Routes: `server/src/tagRoutes.ts`
- Core: `core/src/tags.ts`
- Tests: `core/tests/tags.test.ts`
- Walk-throughs: `tags`

### Free versus unlocked

- Core: `core/src/access.ts` (what is free, and what the one-time unlock covers; the week-long trial)
- Piece: `frontend/src/components/AccessNote.jsx`
- Tests: `core/tests/access.test.ts`
- Walk-throughs: `trial`

### The demo copy

- Server: `server/src/demo.ts` (turned on with `DEMO_MODE=1`, see `docker-compose.demo.yml`)
- Tests: `server/tests/demo.test.ts`
- Walk-throughs: `demo`

## The phone app

The phone app runs the same pages as the website. `frontend/src/device` is what makes it work with no server.

| File | What it does |
|---|---|
| `main.jsx` | Where the app starts. Decides whether requests are answered on the phone or sent to a Life Is you host. |
| `Welcome.jsx` | The first screen: Start, "I have a backup", or the address of a Life Is you host. |
| `answer.js` | Answers the pages' `/api/...` requests inside the app, using the server's own routes files. |
| `nativeDatabase.js` | The database on the phone (encrypted). The key is made on the phone and kept in its keystore. |
| `database.js` | A stand-in database for trying the phone app in a browser. Not the real one on the phone. |
| `kept.js` | The few settings the app must remember: where Life Is is kept, and the pass for a hosted one. |
| `remote.js` | The mode where the phone is only a window onto a Life Is you host yourself. |
| `outside.js` | How the phone asks an outside address for something (weather, a recipe web page), only when a page asks. |
| `autoBackup.js` | The weekly backup, made when the app is opened, put in the phone's Documents. |
| `handOver.js` | Gives a file the app made (a backup) to the phone's share sheet. |
| `phoneReminders.js` | Works out the next seven mornings' reminders and hands them to the phone. |
| `phoneContacts.js` | Choosing one person from the phone's contacts, for a "who to call" entry. |
| `phoneModel.js` | The phone's built-in AI, for the assistant. |

Other files for the phone app:

- `frontend/vite.device.config.js` and `frontend/device.html`: how the phone app's pages are built (into
  `frontend/dist-device`). The website's pages come from `frontend/vite.config.js` into `frontend/dist`.
- `frontend/capacitor.config.json`: Capacitor, the tool that wraps the pages as an Android app.
- Android settings, in `frontend/android/app/src/main`:
  - `AndroidManifest.xml`: what the app may do (camera, internet, notifications) and the links it opens.
  - `java/living/lifeis/home/MainActivity.java`: the one Android code file. It only starts Capacitor.
  - `res/xml/shortcuts.xml`: what long-pressing the app icon offers.
  - `res/xml/carried_backup.xml` and `carried_backup_older.xml`: what the phone's own backup may take (one
    folder, and nothing else).
  - `res/xml/file_paths.xml`: folders the app may hand files out from.
  - `res`: icons and splash screens.
- An Android build needs the owner's yes first (it is heavy on this PC).

## The database

- On the server: one encrypted SQLite file under the data folder (`DATA_DIR`). The key is in a separate folder
  (`KEY_DIR`). See `server/src/database.ts` and `server/src/keys.ts`.
- On the phone: the file made by `frontend/src/device/nativeDatabase.js`.
- The shape of the database is `core/src/migrations.ts`. It is a numbered list of changes, called migrations
  (61 as of this map). Each runs once, in order, and the database remembers the last one it ran.
- The rules:
  - A new change is always a new migration at the end of the list. Never edit an old one.
  - One new migration at a time.
  - Only plain `CREATE TABLE` and `ALTER TABLE ADD COLUMN`. No rebuilding tables.
  - A new table must also be added at the front of the drop list in the upgrade test, in `server/tests/app.test.ts`.
- If a database is newer than the program knows, the program refuses to start. It says to update Life Is or
  restore the copy made before the upgrade.
- `core/src/db.ts` is the one door to the database. `core/src/serialDb.ts` makes one connection take turns.

## The safety nets

These are run by a helper, from the project folder. The first four are tests.

| Command | What it catches |
|---|---|
| `cd core && npx tsc --noEmit -p . && npx vitest run` | A spell-check for the logic code (`tsc`), then the logic tests. Catches wrong answers in recipes, groceries, money, dates and so on. |
| `cd server && npx tsc --noEmit -p . && npx vitest run` | The same for the server: sign-in, the addresses, backups on the server. A "fetch failed" under load means rerun that one file alone. |
| `cd frontend && npx vite build` | Builds the pages. Catches a broken page or a page that reaches into `core/` (which works here and fails in Docker). |
| `node docs/build-site.mjs && node e2e/site.mjs` | Builds the website and checks it. Every line should say PASS. |
| `node e2e/run.mjs <names>` | The browser walk-throughs. Each starts a fresh empty Life Is on a spare port and clicks through it. No names runs all. `--slow` adds every screen size. `--build` builds the pages first. Never touches your real Life Is. |

A walk-through that fails once but passes when run alone is a flake (a one-time glitch). Anything else is real.

Deploying is `bash scripts/deploy.sh`. Only when the owner says "deploy". In order, it:

1. Builds the new image first, while Life Is keeps running. If the build fails, nothing was changed.
2. Backs up the data (`private/backups/before-<branch>-<time>.tgz`) and checks the copy's size.
3. Starts the new version and waits for it to answer `/api/health`.
4. If it does not come up healthy, puts the previous version back.
5. After a good start, merges to `main`, pushes, and updates the demo and the website.

`bash scripts/deploy.sh --check` runs every test above first and stops if any fails. After a good deploy only the 5
newest `before-*.tgz` backups are kept. `scripts/deploy-test.sh` tries the deploy script on a pretend copy. It
changes nothing real.

Other files at the top: `Dockerfile` and `docker-compose.yml` (how Life Is runs in Docker),
`docker-compose.demo.yml` (the demo), `CHANGELOG.md`, and the guides in `docs/guide` (the website's words).

## If X breaks, look here

| What you see | Point a helper at |
|---|---|
| Groceries wrong, missing, or will not add | `frontend/src/pages/Groceries.jsx`, `core/src/kitchen.ts`, `core/src/shopping.ts` |
| A recipe will not save or import | `core/src/recipeText.ts`, `core/src/recipeFiles.ts`, `core/src/recipeWeb.ts`, `frontend/src/pages/Recipes.jsx` |
| Quantities or units read wrong ("1 1/2 cups") | `core/src/units.ts` and `core/tests/units.golden.json` |
| The week's meals or the week's grocery list is off | `frontend/src/pages/Week.jsx`, `core/src/kitchen.ts`, `core/src/prep.ts` |
| Morning reminders stopped | `core/src/reminders.ts`, `server/src/push.ts`; on the phone, `frontend/src/device/phoneReminders.js` |
| A chore or upkeep job shows the wrong due date | `core/src/upkeep.ts`, `frontend/src/pages/Upkeep.jsx` |
| The phone app will not open, or opens to the wrong screen | `frontend/src/device/main.jsx`, `Welcome.jsx`, `kept.js`, `frontend/android/app/src/main/AndroidManifest.xml` |
| The phone app lost or cannot read its data | `frontend/src/device/nativeDatabase.js`, `core/src/migrations.ts`, `core/src/db.ts` |
| A backup will not make or will not restore | `core/src/backup.ts`, `frontend/src/device/autoBackup.js`, `frontend/src/components/YourFiles.jsx`, `server/src/exportRoutes.ts` |
| "Download everything" is missing something | `core/src/exportAll.ts`, `server/src/exportRoutes.ts` |
| Cannot sign in, or the second step fails | `server/src/auth.ts`, `server/src/secondStep.ts`, `server/src/passkeys.ts`, `frontend/src/pages/Login.jsx` |
| The server says the database cannot be opened | `server/src/database.ts`, `server/src/keys.ts` (is the keys volume attached?) |
| Money, budget or a bank file import is wrong | `core/src/money.ts`, `core/src/budget.ts`, `core/src/bankStatement.ts`, `frontend/src/pages/Money.jsx` |
| The calendar is missing something, or the phone calendar link is empty | `core/src/calendar.ts`, `core/src/feed.ts`, `server/src/enjoyingRoutes.ts` |
| A shared house manual link does not work | `core/src/manual.ts`, `server/src/app.ts`, `frontend/src/pages/Manual.jsx` |
| Search misses something | `core/src/search.ts` |
| Things or places: wrong place, sticker will not scan | `core/src/inventory.ts`, `core/src/whereabouts.ts`, `frontend/src/pages/Places.jsx`, `ThingStickers.jsx` |
| A film, show or book lookup finds nothing | `core/src/lookups.ts`, `frontend/src/pages/Media.jsx` (lookups are off until turned on in Settings) |
| The assistant or the AI-app connector will not answer | `core/src/assistant.ts`, `server/src/assistantRoutes.ts`, `core/src/connector.ts`, `server/src/connectorRoutes.ts` |
| A page looks broken on a phone-sized screen | The page file in `frontend/src/pages`, then `node e2e/run.mjs screen-sizes --slow` and `touch-targets` |
| An update did not start and the old one came back | `scripts/deploy.sh` output and the log in `private/logs` |

A good first message to a helper: name the part of the app and the symptom, then give the files from this map. For
example: "Groceries will not add an item on the phone. Look at `frontend/src/pages/Groceries.jsx`,
`core/src/kitchen.ts` and `frontend/src/device/answer.js`. Run the kitchen tests in `core/tests` first."
