---
title: Reading your bank
blurb: Bring spending in from your bank accounts through SimpleFIN, read only, on a Life Is you run.
---
# Reading your bank

Life Is can read what you spent from your bank accounts, so you do not have to type it or download a statement file. It does this through SimpleFIN. It only reads. It cannot move money.

This is offered only on a Life Is you run yourself, in a browser or in the phone app signed in to it. It is not offered in the phone app while it keeps everything on the phone, because the private address SimpleFIN gives you needs a computer of your own to be kept locked on. If you use the app on its own, you can still bring in the statement file your bank offers: see [Your data](your-data.html).

## What SimpleFIN is

[SimpleFIN](https://www.simplefin.org/) is a service that sits between your bank and the apps you choose. You sign up for it yourself at [the SimpleFIN Bridge](https://bridge.simplefin.org/). It is run by others, not by Life Is, and it may charge a fee. Read those two pages for what it costs and which banks it reaches before you decide.

## What is sent, and to whom

It is off until you turn it on, and the screen says this before you do.

- Your **setup token** is used once. Life Is sends an empty request to the SimpleFIN server the token names. It answers with a private **access address**.
- After that, only when you press **Read now**, Life Is asks that same server for your accounts and their transactions for the dates you choose, using the access address.
- **Nothing from Life Is is sent to it.** Not your entries, your categories or your notes.

The access address is kept locked on your own computer. Life Is never shows it again, not to you and not to the page. It is not in your downloads and not in the log. The screen shows only the name of the bank's server and when you connected.

## Get a setup token

1. Sign in at [the SimpleFIN Bridge](https://bridge.simplefin.org/) and connect your bank there.
2. Make a **setup token** for Life Is. It is one long run of letters and numbers.
3. Keep that page open. A token works once, so if anything goes wrong, make a new one.

## Connect

1. In **Settings**, open **Connections**, then **Bank accounts (SimpleFIN)**.
2. Read what it sends, then press **Turn on**.
3. Paste the setup token and press **Connect**.

If SimpleFIN does not accept the token, Life Is says so and keeps nothing. That means the token was used already, or it is wrong. Make a new one and try again.

Life Is refuses any token that is not an https address, or that points at your own computer or network.

## Choose accounts

After you connect, your accounts are listed with their balances. Tick the ones to bring in. For each one you can pick a category. Spending from that account goes in that category. If you pick none, it goes in no category and you can sort it later. Press **Save my choices**.

Life Is does not convert money. Amounts are brought in as the bank writes them, so choose accounts in the currency you use here.

## Read

Choose the day to read from. It starts at 30 days back, and it can go back 90 days at most. Press **Read now**.

- Money you **spent** that has settled becomes a spending entry, labeled with the payee or description, on the day it posted.
- Money **coming in**, and anything still **pending**, is left out.
- A transaction is never brought in twice, even if you read the same days again.
- If it looks like something you already wrote down by hand, or brought in from a statement file (the same day, the same amount and the same words), it is skipped as already there.

When it finishes, it says how many were added, how many were already there, and how many were left out. If SimpleFIN returned any messages, such as a bank that needs you to sign in again, they are shown as they came.

Nothing is read on a schedule. SimpleFIN limits how often an account may be read, so Life Is reads only when you ask.

## Disconnect

Press **Disconnect**. The locked access address and your choice of accounts are forgotten. The spending already brought in stays. You can connect again later with a new setup token.
