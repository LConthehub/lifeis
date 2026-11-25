---
title: Siri and Shortcuts
blurb: Ask your iPhone for the grocery list, dinner and your day, and add to them by voice, with a personal key.
---
# Siri and Shortcuts

You can say "Hey Siri, what's for dinner" and hear the answer from your own Life Is. You make a **personal key**, then build a few shortcuts in the iPhone Shortcuts app that use it. Each takes about three minutes.

## What you need

- **A Life Is you run.** Keys work only on a Life Is on your own computer or server. They do not work in the phone app while it keeps everything on the phone, because there is no server for a shortcut to reach.
- **An address your phone can reach over HTTPS.** The address must start with `https://`, and your phone must be able to open it from where you are. [On your phone](phone.html#reaching-a-life-is-at-home) shows ways to do that.
- **The Shortcuts app** on your iPhone. It comes with iOS.

## What is sent, and where

Siri turns your voice into text on your phone or on Apple's side, as it always does. Apple's own privacy information says how. After that, the only thing that happens is a request from your phone to your Life Is, with your key.

Nothing goes through Apple's servers for Life Is's part of it, or through any company's. Life Is sends nothing anywhere because of a key.

## Make a key

1. Open **Settings**, then **Account & sign-in**, then **Personal keys**.
2. Choose **Make a key**.
3. Give it a name that says where it lives, like `Siri on my iPhone`.
4. Look at the list of what it may do. Uncheck anything you do not want this key to do.
5. Type your password and choose **Make the key**.
6. Press **Copy** next to the key and paste it into a note you can reach from your iPhone. **Life Is shows it once.** It keeps only a scrambled form, so it cannot show it again. If you lose it, make a new key and delete the old one.

Keys are off until you make one. Each key shows what it may do and the last day it was used. You can **turn it off** (it stops working at once and you can turn it back on) or **delete** it.

## What a key can and cannot do

A key can do only what you tick. Today that is up to five things:

- Read your grocery list.
- Add things to your grocery list.
- Read what is on today: events and chores due.
- Read the week's meals, and what is for dinner.
- Add a reminder to your calendar.

A key sees only what you can see. It **never** reaches guns or ammunition, measures, hidden gifts, money or mail, and it cannot open any other part of Life Is, make more keys, or sign in. Each key may be used 60 times a minute. Wrong keys are slowed down, the way wrong passwords are.

## How every shortcut is built

Each shortcut has the same middle step, **Get Contents of URL**. Tap **Show More** on it and set:

- **URL:** your address followed by the path for that shortcut. The Personal keys page shows your address; it ends with `/api/voice/`.
- **Method:** `GET` to read, `POST` to add.
- **Headers:** add one. Name: `Authorization`. Text: `Bearer ` (with a space) and then your key, like `Bearer lik_AbC…`.
- **Request Body** (only for `POST`): `JSON`. Add a Text field and give it the name shown below.

Life Is answers in one short sentence of plain text. The last step of each shortcut is **Speak Text** with the **Contents of URL** in it. Choose **Show Result** instead if you would rather read it.

Name each shortcut with the sentence you will say. That is what Siri listens for.

## Add groceries

Say: "Hey Siri, add groceries." Siri asks what to add, and you say it.

1. Add **Ask for Input**. Set the type to **Text** and the question to `What do you want to add?`
2. Add **Get Contents of URL**. URL: `…/api/voice/groceries`. Method: `POST`. Header: `Authorization`. Request Body: `JSON`, with one Text field named `text` whose value is **Provided Input** (choose it from the variables list).
3. Add **Speak Text** with **Contents of URL**.
4. Rename the shortcut to `Add groceries`.

Say "milk, eggs and pie crust". Life Is splits what you say at commas and at the word "and", so that is three things. It matches them to what you already have on the list, and does not add a thing twice. It answers "Added 3. That's 14 on the list."

A thing with "and" in its name, like "mac and cheese", becomes two. Say "macaroni cheese" instead, or add it by hand.

## What do I need from the store

1. Add **Get Contents of URL**. URL: `…/api/voice/groceries`. Method: `GET`. Header: `Authorization`.
2. Add **Speak Text** with **Contents of URL**.
3. Rename it to `What do I need from the store`.

It answers "14 things. Milk, eggs, pie crust, and 11 more." To ask about one store, end the address with `?store=Costco` (use a store name you have in Life Is). Make a second shortcut for each store you want to ask about, named for it.

## What's for dinner

1. Add **Get Contents of URL**. URL: `…/api/voice/dinner`. Method: `GET`. Header: `Authorization`.
2. Add **Speak Text** with **Contents of URL**.
3. Rename it to `What's for dinner`.

It answers "Turkey chili. You still need sour cream." (what the pantry does not cover), or "Nothing planned for dinner." The key needs to be allowed to read the week's meals.

## What's on today

1. Add **Get Contents of URL**. URL: `…/api/voice/today`. Method: `GET`. Header: `Authorization`.
2. Add **Speak Text** with **Contents of URL**.
3. Rename it to `What's on today`.

It answers with today's events and the chores due, and with dinner too if the key may read the week's meals. When there is nothing, it says "Nothing on today."

## Add a reminder

Say: "Hey Siri, add a reminder." Siri asks what, then when.

1. Add **Ask for Input** (type **Text**) with the question `What should I remind you of?`
2. Add a second **Ask for Input** (type **Text**) with the question `When? Say today if there is no time.`
3. Add **Get Contents of URL**. URL: `…/api/voice/reminders`. Method: `POST`. Header: `Authorization`. Request Body: `JSON`, with two Text fields: `text`, whose value is the first **Provided Input**, and `when`, whose value is the second one. (Tap the variable and rename the two inputs to tell them apart, like "What" and "When".)
4. Add **Speak Text** with **Contents of URL**.
5. Rename it to `Add a reminder`.

You can say things like "tomorrow at 3 PM", "Friday 9:30 AM", "in 3 days", "noon" or `2046-03-05 18:45`. It answers "Reminder added for tomorrow at 3 PM: call the dentist." The reminder is an item on your Life Is calendar. It shows on the calendar and in the morning reminders you have turned on. If Life Is cannot understand the time, it says so and adds nothing.

## Good to know

- **The thing you want cannot be said in the same breath as the shortcut's name.** You cannot say "Hey Siri, add groceries milk and eggs". Siri runs the shortcut, then asks the question, and you answer. Saying it in one breath would need an iPhone app of Life Is's own, and there is not one yet.
- **No one-tap install links.** Life Is does not offer downloadable shortcuts. A shortcut file has to be signed by Apple to be installed, and Life Is sends nothing to Apple. So you build each one by hand with the steps above.
- **"That key isn't working."** This is all Life Is says to a wrong, turned-off or deleted key. It does not say which, so a stranger learns nothing. Check the key is on in Settings, and that the header reads `Bearer`, a space, then the key.
- **"That key isn't allowed to do that."** The key is real but you did not tick that action. Delete it and make one that may, or make a second key.
- **Making a second key** for each device, like an iPad, lets you turn one off without the other.
- **The key is a password for those five things.** Anyone who has it can use it. Keep it in your notes app, not in a message you send.
