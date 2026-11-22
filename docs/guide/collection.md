---
title: Films, music and books
blurb: Everything you own on every format, in one list. Shelves, servers, Kindle and the rest.
---
# Films, music and books

The **entertaining** section is what you own and what you have watched, read or heard. A title is the work itself. What you own of it is its copies: the paperback on the shelf, the audiobook on your server, the one on your Kindle. One book on three formats is one title with three copies.

## Adding

- **Scan the barcode.** A book's ISBN fills in its title and author. This looks it up outside, so it is off until you turn it on.
- **Type it.** A title is enough. What it is on can be any word: VHS, Vinyl, Kindle.
- **Say where it is kept.** A room, and a shelf in it. You can add a place while you add the book.

## Books, eBooks and Audiobooks

Each has its own tab. A book you have on paper and as an audiobook is in both.

## A library on your own server

Under **Servers**, connect a server you run and its library is brought in and kept in step:

- **Jellyfin** and **Emby** for films, shows and music.
- **Audiobookshelf** for audiobooks and eBooks. It asks for an API token.
- **Calibre** itself, through its Content server (Connect/share, then Start Content server). A username and password only if you set it to ask.
- **Calibre-Web** for eBooks. It asks for your username and password, and reads the catalog at `/opds`.
- **Kavita** for eBooks and comics. It asks for your API key.
- **Any other OPDS catalog** (Komga, COPS). Give the address of a list of books, not of a menu.

Life Is only reads from a server. Nothing on it is ever changed. The sign-in is stored locked on your own computer and is never shown again. Each book keeps a link that opens it on its server.

If the server is on the same computer as Life Is, and Life Is runs in Docker, use `http://host.docker.internal` and the port, not `localhost`.

## Kindle, Apple Books and Google Play Books

These offer no way for another program to read your library, so Life Is cannot link to them as it does to a server. Two ways round it:

- **Bring in a list.** On Books, eBooks or Audiobooks, choose **Bring in a list**. It takes the file Goodreads gives you (My Books, then Import and export), one from StoryGraph, any spreadsheet saved as CSV with a Title column, or plain lines such as `Dune by Frank Herbert`. You see what was found before anything is added. Books on a to-read shelf can become books you want. A book you already have is not added twice, so you can bring the same list in again later.
- **Keep a link on a copy.** Open the book in Kindle, Apple Books or Google Play Books, copy its address or use Share, and paste it into the copy. Life Is shows an **Open in Kindle** button. The link is only followed when you press it.

Nothing in a list is looked up or sent anywhere.

Life Is does not read books itself. It keeps track of them and opens them where they live.

## Lending and the log

A copy can be lent to someone, with the day. Each time you watch, read or listen can go in the title's log, and a log line can belong to a project session: "listened while sewing".
