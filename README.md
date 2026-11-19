# Life Is

Life is chaotic, unorganised and overwhelming sometimes. Life Is helps put it back on track: a planner for everyday
life that runs on your own computer, with your records kept there, encrypted.

It starts with the kitchen.

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
- **Your recipes, yours to take.** Bring them in by pasting text or recipe JSON (from the Nextcloud Cookbook app or
  a recipe website). Take them all out as Nextcloud Cookbook folders, ready to drop into your Nextcloud.

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

- `backend/`: FastAPI on an SQLCipher-encrypted SQLite database. `kitchen.py` is the kitchen, `units.py` reads
  amounts and converts units, `migrations.py` is the database's shape (a shipped migration is never edited).
- `frontend/`: React, Vite and Tailwind.
- `core/`: the kitchen again, in TypeScript, so the same code can run on the server, in the browser and inside
  a phone app. It must give the same answers as `backend/`: `python core/tests/golden.py` writes the Python
  answers down and `npm test` (in `core/`) checks the TypeScript against them.
- `server/`: the program again, on Node, with `core/` as its kitchen: the same addresses, the same sign-in and
  the same encrypted database file as `backend/`, so records made by one open in the other. Docker still runs
  `backend/`; this takes its place once it has been tried. To try it: `npm install` in `core/` and `server/`,
  then `npm start` in `server/` (Node 24, no build step). Tests: `npm test` in `server/`.
- Tests: `docker compose -f docker-compose.dev.yml run --rm tests`.
- Working on it: `docker compose -f docker-compose.dev.yml up --build` (the program on port 8020, the pages with
  live reload on port 5180).

Life Is shares its sign-in and encryption code with its sister project, Sworkr. The plan is to move that shared
part into one package both use.
