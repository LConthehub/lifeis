# Contributing to Life Is

Thanks for helping. Small fixes and clear bug reports are welcome.

## Run the tests

Run these from the top of the repository. Each line must pass.

```
cd core && npx tsc --noEmit -p . && npx vitest run
cd server && npx tsc --noEmit -p . && npx vitest run
cd frontend && npx vite build
```

If the server tests fail with "fetch failed" or a dropped socket, run that test file on its own. The same tests run
on GitHub for every push and pull request.

## Contributor license agreement

Every contributor must sign a contributor license agreement before a change is merged. The project owner also sells
the phone apps under other terms, so the owner needs the right to do that. The agreement will be sent when you open
a pull request.
