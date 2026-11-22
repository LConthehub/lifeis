# Google Play listing: working draft

Not published anywhere. This is the text and the answers to paste into the Play Console, kept here so they
are written once and reviewed before anything goes live.

## Still to decide

- **The name** is Life Is (decided 2026-11-22), shown in stores with what it is: "Life Is: Home Organizer".
  It has trademark neighbours ("Life is Good", "Life Is Strange"), so a short attorney check is worth having
  before filing a mark or selling in earnest.
- **Website:** https://lifeis.living  **Privacy policy:** https://lifeis.living/privacy (both live).
- **Contact email:** `hello@lifeis.living`, once that address is created in iCloud. Google shows it publicly.
- **Publisher name.** A personal account shows the account holder's legal name.
- **The app ID** is `space.emailmy.lifeis`. It can never change after the first upload.

## Title (30 characters at most)

    Life Is: Home Organizer

(23 characters)

## Short description (80 characters at most)

    Recipes, groceries, belongings, projects and budgets. Private, on your device.

(78 characters)

## Full description (4,000 characters at most)

    Life Is keeps your household in one place, and keeps it yours.

    Most home apps do one thing, charge by the month, and hold your information on their servers. Life Is does the opposite. It links what you own to when and how you use it, costs one payment, and stores everything on your own device.

    WHAT IT DOES

    • Recipes, kept exactly as you wrote them. Bring one in from a website, from a photo of a card or a cookbook page, or by pasting the text. Nothing is shortened or rewritten.
    • The week's meals, a grocery list built from them, and your pantry.
    • Everything you own, in kinds you define yourself: cast iron with its maker and care notes, fabric by the yard, tools, books, films. Say where each thing lives, by room, shelf and bin.
    • Projects: what each one uses, the time you spend on it, and what it costs against what you planned.
    • Plans that become memories: a holiday or a single afternoon, with its food, its things and its photos, to look back on.
    • Spending: an amount for each kind of spending each month, and what is left.
    • A calendar that pulls the meals, plans and projects together.

    YOURS, AND ONLY YOURS

    • No account. No sign-up. No advertising. No tracking.
    • Everything is stored on your device, encrypted with a key that never leaves it.
    • Backups are files you make and keep wherever you like, locked with a passphrase only you know.
    • Life Is has no servers. We could not read your information if we wanted to.

    ONE FAIR PRICE

    • The kitchen (recipes, the week, groceries, pantry, prices) and backups are free, for good.
    • Everything else is free to try for 14 days.
    • One payment unlocks all of it. No subscription, no per-category charges, no limits on how much you keep.
    • If you don't unlock, nothing you entered is hidden or deleted. You can still read it and back it up.

    RUN YOUR OWN

    Life Is is also free software you can run on your own computer for the whole household. The app can connect to it, at no charge, so everyone at home shares what they choose to share.

## Category and tags

- Category: **House & Home** (second choice: Productivity)
- Not a game. Contains no ads.

## Data safety form

Google asks what the app collects and shares. The honest answers:

| Question | Answer |
| --- | --- |
| Does the app collect or share any of the required user data types? | **No** |
| Is all user data encrypted in transit? | Yes. The exception to describe if asked: a person may choose to connect to their own home server over plain http on their home network; the app warns them first. |
| Can users request that their data be deleted? | Not applicable: no data is collected. Everything is on the person's own device and is removed with the app. |

"Collect" in Google's sense means data sent off the device to the developer or a third party. Requests the
person starts themselves (a weather forecast, a barcode lookup, fetching a recipe page) send only what is
needed to answer them and are not tied to any identity; they are described in the privacy policy.

## Content rating questionnaire

No violence, sexual content, profanity, gambling, drugs or user-to-user communication. No location shared
with others. Expected rating: Everyone.

## Target audience

Adults (18 and over). Not designed for children.

## What Google will need that isn't text

- [ ] App icon, 512 x 512
- [ ] Feature graphic, 1024 x 500
- [ ] At least 2 phone screenshots; 4 to 8 is better (recipes, a project with its budget, spending, the "where should this phone keep it" screen)
- [x] A privacy policy web address: https://lifeis.living/privacy
- [ ] A signed release build of the app
- [ ] 12 testers opted in for 14 days, before applying for public release

## Before the first upload

- [ ] Run the app on a real Android device and fix what breaks
- [ ] Build the purchase step and test it with Google's test accounts
- [ ] Camera permission for the barcode scanner, checked on a device
- [ ] Replace the placeholder icon and splash screen in the Android project
- [ ] Create `hello@lifeis.living` in iCloud (custom email domain for lifeis.living) and send it a test message
- [ ] Fill in the publisher name in the privacy policy
