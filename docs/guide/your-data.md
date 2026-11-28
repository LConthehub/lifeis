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
| A personal key, for Siri Shortcuts (on a Life Is you run) | Nothing. A key only lets your own phone ask your own Life Is for a few things, with the key. Life Is sends nothing anywhere because of one. See [Siri and Shortcuts](siri.html) |
| Use Life Is from your AI app (on a Life Is you run) | Only when your AI app asks: what is in the sections you checked for that connection, to the company that makes the app (Anthropic, for Claude). See [Use Life Is from your AI app](ai-app.html) |
| Reading your bank | Only on a Life Is you run, and only when you press Read now. Your setup token once, then a read-only request for the accounts you chose. Nothing of yours is sent. See [Reading your bank](bank-reading.html) |

All of them are listed in one place: **Settings › Connections**. The phone app can also show its own morning reminders, made on the phone, with nothing sent. The [privacy policy](../privacy) has the full list.

## Personal keys

A personal key lets one shortcut on your phone, like Siri, read or add a few things in your Life Is without signing in. Keys are **off until you make one** (Settings, Account & sign-in, Personal keys), work only on a Life Is you run, and are shown once: Life Is keeps only a scrambled form. Each key does only what you checked, sees only what you can see, and never reaches guns or ammunition, measures, hidden gifts, money or mail. You can turn a key off or delete it at any time, and it stops working at once. Life Is keeps the name, the list of what it may do and the last day it was used, and nothing else about its use. Keys are not in your export. See [Siri and Shortcuts](siri.html).

## Use Life Is from your AI app

This lets an AI app you use, such as Claude, read the parts you check and add a few safe things. It is **off until the person in charge turns it on** (Settings, Connections, More), and works only on a Life Is someone hosts. It sends something only when the AI app asks: what is in the checked sections goes to the company that makes the app, through its servers, and that company's privacy policy covers the rest. It never reaches guns or ammunition, measures, gifts, passwords and keys, the house manual or mail. To stop it, cut off a connection, or have the person in charge turn it off, and it stops at once. The connections and the log are kept in Life Is, with the rest of your data. They are not in the download of everything. See [Use Life Is from your AI app](ai-app.html).

## Keeping a copy

**In the phone app:** Settings › Your data makes a backup file, locked with a passphrase you choose. Keep it wherever you like. Life Is makes no copies of itself anywhere.

**A backup every week, by itself:** turn it on in the same place and choose a passphrase once. The phone remembers it, locked away. Each week Life Is makes a fresh backup and puts it in the phone's Documents, in a folder called Life Is, keeping the newest two. These stay on the phone, so save a copy somewhere else now and then: one tap, nothing to type. On a new phone, choose **I have a backup** on the first screen.

**On a computer you run:** copy the data folder and the keys folder you chose when you [installed it](install.html). Keep both together: one is no use without the other. Life Is also saves a copy of the database by itself before every upgrade.

## Taking it with you

**Export everything** (Settings › Your data, under Import and export) makes one zip of it all. Recipes export as a zip on their own. The home inventory prints or saves as a PDF. A backup holds everything.

**Letterboxd, in and out.** On the Lists tab, **From Letterboxd** brings in the zip from Letterboxd's Export your data: watched days, watchlist, lists, half-star ratings and reviews. The files are read here, you see the counts first, and nothing is kept until you say so. Reading the same download again adds nothing. Any list can also be saved as a CSV that Letterboxd's importer takes (**Make a Letterboxd file**). Neither way sends anything to Letterboxd: you carry the file yourself. Your ratings are in the download of everything too. [Films, music and books](collection.html#letterboxd) has the details.

**Bring in from HomeBox.** On Things, choose **Bring in from HomeBox** and pick the CSV that HomeBox exports. You see the kinds, places and tags first, and nothing is kept until you say so. Bringing in the same file again adds nothing. [Your home](home.html#bringing-in-from-homebox) says what is brought across.

## Sharing inside a household

See [Get started](getting-started.html). Nothing is seen by anyone else unless it is shared.

**Measures are yours alone.** The numbers you keep on the Measures chip of Routines can never be shared, not even with the person in charge. They are in your own download of everything, and nobody else's.

## The privacy policy

It is short: [read it](../privacy).
