# Life Is

Life is chaotic, unorganised and overwhelming sometimes. Life Is helps put it back on track: a planner for everyday
life that runs on your own computer, with your records kept there, encrypted.

So far: the kitchen, the calendar, the things you keep, the projects that use them, and what you watch, read and hear.

## The kitchen

- **Recipes kept exactly as you wrote them.** Every ingredient line and every step is stored word for word, with
  your section headings ("For the sauce"). Nothing shortens, summarises or rewrites a recipe. When you paste or
  import one, the original is kept beside it too.
- **One list of ingredients behind everything.** "Flour" in a recipe, in the pantry and on the grocery list is the
  same thing, so the three stay connected.
- **The week's meals.** Plan breakfast, lunch, dinner and snacks, with a recipe or just a note ("leftovers").
  Change the servings and the amounts follow.
- **A grocery list that knows your pantry.** It's what the week's meals need, for the servings you planned, minus
  what you already have. Grams and pounds add up, and so do cups and spoons; weight and volume never get mixed
  (a cup of flour and a cup of honey weigh different amounts), so those are listed in full and marked.
- **The pantry.** What you have, how much, where (fridge, freezer, cupboard), when to use it by, and when it's
  running low. Ticking something off the grocery list puts it in the pantry; marking a meal as cooked takes out
  what it used.
- **A recipe knows what it's cooked in.** Pans, dishes and tools from the things you keep (the cast iron skillet,
  the 8x8 baking dishes), or just by name. The week then tells you when one meal needs more of something than you
  own: "Thursday dinner: 4 × 8x8 baking dish, and you have 2."
- **Your recipes, yours to take.** Bring them in by pasting text or recipe JSON (from the Nextcloud Cookbook app or
  a recipe website). Take them all out as Nextcloud Cookbook folders, ready to drop into your Nextcloud.

## The front page

What today holds and what wants attention, gathered from every section you use: the next three days, today's
meals and any pan you're short of, what's running low or about to go off, the projects in hand, what's lent out.
Also the birthdays and anniversaries coming round, and the week in numbers. Each card leads to its page, and you
choose which cards show.

## Outside services, only if you turn them on

Life Is works without reaching outside your computer. The few things that do are listed in one place in Settings,
each off until you turn it on, each saying exactly what it sends:

- **Weather on the front page**, from [Open-Meteo](https://open-meteo.com) (no account, no key). It is sent the
  town you look up, then that place's position rounded to about a kilometre. Turning it off forgets the place.
- **Email, to read and answer your inbox**, with any provider that lets mail programs in (IMAP and SMTP): Gmail,
  iCloud, Fastmail, Yahoo, your own server, Proton through its Bridge. Life Is signs in from your computer with
  the password you give (for most providers an "app password"), stored locked. No message is ever kept: the inbox
  is read when you look. Opening a message doesn't mark it read. The line is always encrypted, and the account is
  only saved if signing in works.
- **Your Jellyfin or Emby**, read-only, at the address you give.

## It asks what you need

The first time you sign in, Life Is asks what life needs looking after: cooking, what you own, projects, sewing,
the garden. It shows the parts that fit and adds ready-made kinds of things to start from. Change the answer any
time in Settings; unticking something only puts it out of sight.

## The things you keep

- **Your own kinds of things.** Fabric, yarn, tools, seeds, board games: a kind is whatever you say it is, with
  the fields you care about (a fabric's width, a seed packet's sow-by date). Start from a ready-made set (sewing,
  knitting, woodworking, gardening, around the house, cookware with cast iron) and change it, or make your own
  from nothing.
- **Where everything is.** A room, a shelf in it, a bin on the shelf, as far down as helps you find things.
- **How much is free.** What you have, less what your projects have set aside.

## Projects

- **Anything made or done over more than a day**: a dress, a jumper, a bookshelf, the spring planting.
- **A list of what it uses**, drawn from your things. An amount ("3 yd of the blue linen") is set aside, so two
  projects can't count on the same cloth, and each says what it's short of. Using it, or finishing, takes it
  out of what you keep.
- **The days you worked on it**, how long, and what you watched or listened to.

## The calendar

- **One place to see what's on each day.** Your own dates (a day or several, with a time if it has one), with
  the week's meals, the time on projects and the days they're wanted by, what's about to go off in the pantry,
  and what you watched, read or heard. Each of those leads back to the page it lives on.
- **Birthdays and anniversaries.** Tick "Every year" and give the day it first happened: it shows each year, counting
  the years.

## Films, shows, music, books and games

- **A title, and your copies of it.** Alien on VHS and on Blu-ray is one film with two copies, each in its own
  place, each lent out or at home. A format is any word you like: Betamax, 8-track, vinyl, paperback.
- **What you'd like to have.** A title with no copy can be marked as wanted.
- **Scan a barcode with the camera.** Point your phone or tablet at the back of the case: if you have it, you're
  taken to it; if not, add it with the barcode kept on the copy. The picture is read on the device and never sent
  anywhere. Typing the number, or a handheld scanner, works too.
- **Your Jellyfin or Emby library, beside the discs.** Connect the server with its address and a key, and its
  films, shows, albums and books come into the collection, with their covers, kept in step as often as you choose.
  A film you also own on disc is one title with both copies. Life Is only reads from the server.
- **What you've watched, read and heard**, by day. Add a film to the time on a project and "watched Alien while
  sewing" shows from the project, from the film, and on the calendar.

## Try it

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows or Mac) or Docker (Linux).

```bash
git clone https://github.com/LConthehub/lifeis.git
cd lifeis
docker compose up -d --build
```

Then open <http://localhost:8020> and make your account. It's only reachable from this computer; to use it from
your phone, use [Tailscale](https://tailscale.com) and add it to your home screen.

Your records are kept by Docker, encrypted. **Never run `docker compose down -v`**: the `-v` deletes them.

## For developers

- `core/`: the kitchen, in TypeScript, written so the same code runs on the server, in the browser and inside a
  phone app. `kitchen.ts` is the kitchen, `units.ts` reads amounts and converts units, `recipeText.ts` reads
  and writes recipes, `inventory.ts` is the things you keep, `projects.ts` the projects, `calendar.ts` the calendar, `media.ts` the
  collection, `life.ts` what each person asked for, `migrations.ts` the database's shape (a
  shipped migration is never edited). It reaches
  the database only through the small `Db` interface in `db.ts`, which each place Life Is runs supplies.
- `server/`: the program, on Node 24 with no build step: sign-in, the web addresses the pages call, and an
  SQLCipher-encrypted SQLite database. It installs the encrypted database engine and three mail libraries (imapflow, nodemailer, mailparser). The only
  places it ever reaches out to are the media servers a person connects (`connectionRoutes.ts`), whose keys it
  stores locked (`vault.ts`), the weather service if a person turns it on (core's `weather.ts`), and a person's own mail provider if they add
  an account (`postbox.ts`; the rules are core's `mail.ts`).
- `frontend/`: the pages. React, Vite and Tailwind.
- `backend/`: the first version of the program, in Python. Docker no longer runs it. It is kept for now as the
  reference `core/` is checked against: `python core/tests/golden.py` writes its answers down, and the tests
  hold the TypeScript to them. The database file, its encryption and the passwords are the same in both.
- Tests: `docker compose -p lifeis-dev -f docker-compose.dev.yml run --rm tests`, or `npm test` in `core/` and
  in `server/` (after `npm install` in each).
- Working on it: `docker compose -p lifeis-dev -f docker-compose.dev.yml up` (the program on port 8020, the
  pages with live reload on port 5180). Stop the Life Is you use first: it has the same port.

Life Is shares its sign-in and encryption code with its sister project, Sworkr. The plan is to move that shared
part into one package both use.
