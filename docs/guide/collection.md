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

## Finding things by format

The entertaining section has two tabs: **Collection** and **Connections**. In the Collection, choose Books, Films, Shows or Music, and a second row of chips shows what you own it on, each with a count:

- **Books:** Print, eBooks, Audiobooks. A book on CD or tape counts as an audiobook.
- **Films and shows:** DVD, Blu-ray, 4K, Digital.
- **Music:** Vinyl, CD, Cassette, Digital.
- **Other** holds any format that fits none of those.

A chip only shows once you own something in it, and the row is left out when there would be only **All**. A title on two formats is under both chips.

## A library on your own server

Under **Connections**, connect a server you run and its library is brought in and kept in step:

- **Jellyfin** and **Emby** for films, shows and music.
- **Audiobookshelf** for audiobooks and eBooks. It asks for an API token.
- **Calibre** itself, through its Content server (Connect/share, then Start Content server). A username and password only if you set it to ask.
- **Calibre-Web** for eBooks. It asks for your username and password, and reads the catalog at `/opds`.
- **Kavita** for eBooks and comics. It asks for your API key.
- **Any other OPDS catalog** (Komga, COPS). Give the address of a list of books, not of a menu.

Life Is only reads from a server. The server itself is never changed. The sign-in is stored locked on your own computer and is never shown again. Each book keeps a link that opens it on its server.

If the server is on the same computer as Life Is, and Life Is runs in Docker, use `http://host.docker.internal` and the port, not `localhost`.

## Kindle, Apple Books and Google Play Books

These offer no way for another program to read your library, so Life Is cannot link to them as it does to a server. Two ways round it:

- **Import a list.** In the Collection, choose **Import a list**. It takes the file Goodreads gives you (My Books, then Import and export), one from StoryGraph, any spreadsheet saved as CSV with a Title column, or plain lines such as `Dune by Frank Herbert`. You see what was found before anything is added. Books on a to-read shelf can become books you want. A book you already have is not added twice, so you can import the same list again later.
- **Keep a link on a copy.** Open the book in Kindle, Apple Books or Google Play Books, copy its address or use Share, and paste it into the copy. Life Is shows an **Open in Kindle** button. The link is only followed when you press it.

Nothing in a list is looked up or sent anywhere.

Life Is does not read books itself. It keeps track of them and opens them where they live.

## Lists

The **Lists** tab holds lists of titles. A list can mix films, shows, music, books and games, in the order you choose (choose **Change order**, use the up and down buttons, then **Done**). Everyone has two lists that stay: **To watch, read or hear** and **Wanted**. Wanted is every title you marked as wanted. You can make more lists, such as "Rainy day" or "Gift ideas".

You can choose **Pick one I own** to add a title from your Collection. You can also type a title onto a list even if you do not own it: a name, what kind it is, and a year or note if you like. It is kept, and search finds it, but it is not counted in your Collection, its formats, the printable list or any totals until you add a copy. Each title has one main button, **Watched today** (or **Read today**, **Heard today**), and **More**. Under More are **I have it now**, which adds the copy, and **Take off**. On Wanted the main button is **I have it now**. Marking a title watched, read or heard takes it off To watch.

A list is only yours unless you choose **Share with the household**. Then it belongs to the household: everyone who signs in can see it, add titles, take any off, change the order and mark a title watched. That goes in their own log, and the title comes off the list for everyone. Only you can rename it, stop sharing it or delete it. Deleting a list never removes a title: ones you do not own stay in search and can go on another list. A list you do not share is not seen by anyone else, in search or in their downloads.

Lists and ratings are in the download of everything, and come back when you bring it in. Bringing the same file in twice adds nothing. Nothing on a list is sent anywhere.

## Ratings

Any title can have your own rating, from half a star to five stars, in half steps. Open the title and choose from **Your rating**. It is yours alone: nobody else sees it, not even on a list you share. The Collection can be sorted by **My rating, highest first**, and so can any list of yours (choose **Sort by my rating**). Titles you have not rated come last.

## Letterboxd

**Bringing in a Letterboxd download.** On Letterboxd, open Settings, then Data, and choose Export your data. On the **Lists** tab choose **From Letterboxd** and pick the zip you got (or its files one by one). The files are opened here, on your device or your own Life Is, and nothing is sent to Letterboxd or anywhere else. You see counts first, and nothing is kept until you choose **Bring it in**.

- Every film you watched becomes a title. You do not own them, so they are not counted in your Collection (see Lists above). Each entry in your diary becomes a day in that title's log.
- A film that Letterboxd says you watched, but that has no diary entry, gets one day: the day you logged it on Letterboxd.
- Your watchlist goes on **To watch, read or hear**. Each Letterboxd list becomes a list of the same name, in the same order.
- Star ratings are kept, half stars included. A review is kept word for word as the note of the day it was written for. A rating you already set here is not replaced.
- Bringing the same download in again adds nothing. A film is matched by its Letterboxd link, or else by its name and year.
- Posters and directors are not fetched. A film keeps its name, year and a link to it on Letterboxd.

**Making a file for Letterboxd.** Open any list and choose **Make a Letterboxd file**. Life Is saves a CSV with the title, year, director if known and, on your own lists, your rating, the days you watched it and your reviews. On Letterboxd, use its Import your data page (it has a help page called Importing your data) and choose the file. Only films go in it. If the list also holds shows, music, books or games, they are left out, and Life Is says how many. On a list someone else shared with you, only titles and years go in the file, never their ratings or days.

## Lending and the log

A copy can be lent to someone, with the day. Each time you watch, read or listen can go in the title's log, and a log line can belong to a project session: "listened while sewing".
