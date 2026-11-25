---
title: Use Life Is from your AI app
blurb: Let an AI app you already use, like Claude, read parts of your Life Is and add a few safe things, with your say on each one.
---
# Use Life Is from your AI app

This lets an AI app you already use, such as Claude, look at parts of your Life Is and add a few safe things when you ask it to. It is off until the person in charge turns it on, and you choose what each connection may see.

This is not the built-in assistant in Settings. That one sits inside Life Is. This one lets your own AI app come in from outside. Life Is needs no key from you for it. The AI app uses your own plan with its company.

## What you need

- **A Life Is someone hosts, at an https web address the internet can reach.** It does not work in the phone app while it keeps everything on the phone, because there is no server for the AI app to reach. It does not work on an address that only works on a home network. Life Is never opens anything up to the internet by itself. If your Life Is is not reachable yet, [On your phone](phone.html#reaching-a-life-is-at-home) shows ways to do that.
- **An AI app that can add a custom connector.** Only Claude has been tested. Other apps that use the same open connector standard should work, but they have not been tested.

## Turn it on

1. The person in charge opens **Settings**, then **Connections**, then **More**, and finds **Use Life Is from your AI app**.
2. They turn it on for the household. Nothing is shared yet. It only lets each person make their own connection.

Settings shows a reason if your address cannot work, such as an address that is not https.

## Connect Claude

Each person connects their own.

1. In **Settings**, then **Connections**, then **More**, copy the address shown under **Use Life Is from your AI app**. It ends in `/mcp`.
2. In Claude, add a custom connector and paste that address.
3. Claude sends you to Life Is. Sign in to Life Is if it asks.
4. Give the connection a name, like `Claude on my iPad`.
5. Tick what it may see. Everything starts unticked.
6. Tick **It may add things** only if you want that.
7. Choose **Allow**. Choose **Don't allow** to say no.

The page tells you what will be sent, and to whom, before you choose.

## What it can read

Only the sections you tick for that connection, and only what you can see yourself:

- **Kitchen:** the grocery list, the week's meals, the pantry, and recipes.
- **Calendar:** events and plans coming up. Meals, chores and project dates show there only when their own section is ticked too.
- **Things:** what you own and where it is.
- **Projects:** your projects.
- **Lists:** your lists of films, shows, books and music.
- **Money:** this month's spending. This one carries its own warning on the page.

## What it can add

Only when you tick **It may add things** and also tick the section it belongs to:

- A line on the grocery list (Kitchen).
- A calendar event (Calendar).
- A reminder (Calendar).
- A title on a list (Lists).

Each thing it adds is marked "Added by" and the connection's name. It **never** changes or deletes anything.

## What it never reaches

Whatever you tick, it never reaches guns and ammunition, measures, gifts, passwords and keys, the house manual, or mail. Other calendars you follow show only as "busy".

## The log, and undo

Under **Use Life Is from your AI app** in Settings, the log lists what each connection read and added, with the date. It shows the newest 100 lines and keeps them for 90 days. Next to something it added, **Undo** takes it out again, if it is still there.

## Change it or cut it off

- **Change a connection:** rename it, or tick and untick sections and the add tick. It takes effect at once.
- **Cut it off:** it stops working at once. The log keeps its name, so you can still see what it did.
- **The household switch:** when the person in charge turns it off, every connection ends at once. Nobody's AI app can reach Life Is until it is turned on and people connect again.
- **Not used for 90 days:** a connection ends by itself. Each connection shows the day it will end if it is not used again.
- **Who sees what:** you see only your own connections and log. The person in charge cannot see anyone else's.

Each person may have up to 10 live connections.

## What is sent, and to whom

Only when your AI app asks, what Life Is holds in the sections ticked for that connection goes to the company that makes the app (Anthropic, for Claude), through that company's servers. That company's own privacy policy covers what it does with it. Nothing is sent at any other time. See the [privacy policy](../privacy#use-life-is-from-your-ai-app-only-on-a-life-is-you-host).

## For people who run their own Life Is

Requests come from the AI company's servers, not from the person's device. So the address must be reachable from the internet. These paths must be reachable: `/mcp`, `/connect`, `/oauth/` and `/.well-known/`. Everything else can stay closed. Anthropic publishes the address range its requests come from, and a reverse proxy can allow just that range for those paths.
