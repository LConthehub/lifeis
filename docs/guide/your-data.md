---
title: Your data
blurb: Where everything is kept, how it is locked, what can leave, and how to keep a copy.
---
# Your data

Nobody else holds your household. There is no Life Is account and no Life Is cloud.

## Where it is kept

- **In the phone app:** in an encrypted database on the phone. The key that opens it is kept in the phone's own secure storage.
- **On a computer you run:** in an encrypted database in the folder you chose, with the key kept apart from it.

A stolen disk shows only scrambled data.

## What can leave, and when

Life Is works without the internet. A few things reach outside, and each one is **off until you turn it on** (importing a recipe has no switch: it acts only when you paste an address) and **says exactly what it sends**:

| What | Sends |
|---|---|
| Barcode look-ups | The number under the barcode, and nothing else |
| The weather | The town you type, then the place you pick, rounded to about half a mile |
| A recipe from a website | A request for that one page |
| Car recall checks | The make, model and year of each car, to the U.S. traffic safety agency (NHTSA) |
| An AI assistant | Your question, only when you ask it, to the model at the address you give |
| Reminders by ntfy, browser push or email (on a Life Is you run) | Each morning's reminder, to the ntfy server you choose, your browser maker's push service, or your own mail account. See [Upkeep](upkeep.html#how-you-are-told) |
| Your own mail account (on a Life Is you run) | Only between Life Is and your mail provider |
| Calendar links you follow (on a Life Is you run) | A request for the calendar, about once an hour |
| Photos from Immich, and media and book servers (on a Life Is you run) | Only to the servers you name, with the key you give. Life Is only reads, and changes nothing there |
| Film and show look-ups from TMDB (on a Life Is you run) | The title you type, with your own key |
| Reading your bank | Only on a Life Is you run, and only when you press Read now. Your setup token once, then a read-only request for the accounts you chose. Nothing of yours is sent. See [Reading your bank](bank-reading.html) |

All of them are listed in one place: **Settings › Connections**. The phone app can also show its own morning reminders, made on the phone, with nothing sent. The [privacy policy](../privacy) has the full list.

## Keeping a copy

**In the phone app:** Settings › Your data makes a backup file, locked with a passphrase you choose. Keep it wherever you like. Life Is makes no copies of itself anywhere.

**On a computer you run:** copy the data folder and the keys folder you chose when you [installed it](install.html). Keep both together: one is no use without the other. Life Is also saves a copy of the database by itself before every upgrade.

## Taking it with you

**Export everything** (Settings › Your data, under Import and export) makes one zip of it all. Recipes export as a zip on their own. The home inventory prints or saves as a PDF. A backup holds everything.

## Sharing inside a household

See [Get started](getting-started.html). Nothing is seen by anyone else unless it is shared.

## The privacy policy

It is short: [read it](../privacy).
