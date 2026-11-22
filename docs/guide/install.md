---
title: Install with Docker
blurb: Pick your options and get a ready setup file to copy.
---
# Install on your own computer

Pick your options, copy one file, start it. This page writes the setup file for you.

Life Is on your own computer is free, with every part included. It runs in Docker, a free program that keeps Life Is and everything it needs in one tidy box.

{{released}}

## Before you start

1. Install **Docker Desktop** (Windows, Mac) or **Docker Engine** (Linux) from docker.com, and open it once.
2. Make a folder for Life Is, such as `Documents/lifeis`.

## Make your setup file

Life Is's whole setup is one file, `docker-compose.yml`: where your records live, and who can open it. Fill in what you want; the file below changes as you type. Nothing you type here is sent anywhere.

{{builder}}

## Start it

{{steps}}

## What the choices mean

### Where your records are kept

**Kept by Docker** is the simplest: Docker looks after two named stores. Never run `docker compose down -v`: the `-v` deletes them.

**In folders you choose** puts your records where you can see them and copy them. Pick one folder for the records and another for the keys. Keep both: one is no use without the other.

### Who can open it

**This computer only** is the safest, and the default.

**Other devices on my home network** lets a phone or tablet at home open it, at this computer's address.

**A web address of its own** adds a small web server (Caddy) that gets a certificate by itself, so Life Is opens at `https://` your address from anywhere. The address must already point at this computer, and ports 80 and 443 must reach it. Life Is is then on the public internet, behind your password. The first account is still made on this computer itself.

## Updating

Run these two in the folder with your setup file. Your records stay.

`docker compose pull`

`docker compose up -d`

Life Is saves a copy of its database by itself before each upgrade.

## What's next

[Get started](getting-started.html): make your account and do the three things worth doing on day one.
