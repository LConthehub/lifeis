# Changelog

All notable changes to Life Is are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Holidays, under Plans: a plan that comes back each year, on the same date, on a weekday rule (the fourth Thursday of
  November) or on a day you set each year. Each year starts from last year's, with its own menu, guests, cards, gifts,
  decorations by spot with last year's photo, put-up and take-down lists, a dinner countdown counted back from when
  dinner is (a frozen turkey's thaw included), and a budget from spending tagged to the holiday. A birthday or
  anniversary on the calendar can become a holiday with one tap. Gifts for someone who signs in stay hidden from them
  until the day has passed.
- Receipt photos and in-store savings: a receipt is read on the device, full price and saving are kept apart, savings
  are totaled, price drops are noticed inside a store's window, and a savings book can be typed in. A check step
  asks you to check off what you got first.
- The budget now covers projects and grocery trips: a paid project cost is one spending entry, saved up for and
  flagged when it is over plan. The grocery list splits by store with estimates, and finishing a trip writes one
  entry per store. A bank charge that matches is not counted twice. "Still to get" uses the same store prices as the
  store card.
- Privacy policy and Your data page now list every outside connection.
- Personal keys and Siri Shortcuts (on a Life Is you run): a named key made in Settings, shown once and kept only as a hash,
  that lets a shortcut on your phone read the grocery list, add groceries, read today and the week's meals, and add a
  reminder, in short spoken sentences. A key can be turned off or deleted at once, sees only what its person can see, and
  never reaches guns or ammunition, measures, hidden gifts, money or mail. A new guide, Siri and Shortcuts, builds the
  five shortcuts step by step.

### Changed

- Every page uses Lucide icons in place of the emoji it chose itself.
- The undo button on a paid cost says "Mark not paid".
- A whole recipe page pasted under "Import a recipe" comes in clean: the recipe's own name, not "Skip to content" or
  the site's name, and no buttons, star ratings or photo credits among the steps. The pasted text is still kept whole.

## [0.2.0] - 2026-11-23

### Added

- AGPL-3.0 license, contributor guide, and security policy.
- A test workflow on GitHub that runs the type checks, tests, and build on every push and pull request.
- Version 0.2.0.
- Prep reminders on recipes and planned meals ("thaw the chicken the night before"): counted back from when the meal
  is eaten, shown on the week and the front page, and sent at their time the ways reminders already go.
- Tags across the app: one list per household that can nest (Kitchen > Appliances), on things, recipes, projects,
  plans, spending, collection titles, pets, upkeep jobs and calendar dates. A page per tag, a tag filter on each
  list, tagging many at once, rename and merge. Tags are in search and in downloads. Recipe tags carry over.
- A budget: income, bills (from Upkeep), savings goals, the month's budget and a year view. A tag shows its total
  spending.
- Reading bank accounts through SimpleFIN, off by default and read-only, on a Life Is you host. Spending comes in
  without duplicates.
- The website: the front page words live in docs/home.md, and a "Become an Android tester" section.
- A display name for each person, separate from the sign-in name.
- Routines: times of day with their steps, cycles that wait until they are done, a history, a chore chart, and
  reminders on the phone.
- A cooking view: big ingredients and steps to check off, and the screen stays on.
- Bringing everything back in from a download: projects, plans, prices, coupons, stores, grocery barcodes, tags
  and the budget.
- A writing and study starter set.
- A published image for Intel and ARM computers, ghcr.io/lconthehub/lifeis, built on each tagged release, and a
  README section for running it yourself.

## [0.1.0]

First version.
