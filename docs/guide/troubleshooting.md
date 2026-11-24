---
title: Troubleshooting
blurb: When something does not open, scan or arrive.
---
# Troubleshooting

## Life Is does not open

- **On a computer you run:** is Docker running? Open a terminal in the folder with your `docker-compose.yml` and run `docker compose ps`. Start it with `docker compose up -d`.
- **After a restart of the computer:** Docker Desktop may need opening before Life Is comes back.
- **From another device:** a Life Is set to answer "this computer only" will not answer your phone. See [Install](install.html).

## I cannot make the first account

The first account can only be made on the computer Life Is runs on, at `http://localhost:8020` (or the port you chose). That is deliberate: otherwise whoever found the address first could make themselves the admin.

## I forgot my password

Nobody can reset it for you. That is deliberate: there is no back door, for you or for anyone else. Keep your password somewhere safe, such as a password manager. If someone else in your Life Is forgets theirs, the admin can add them again as a new person.

## The camera will not scan

- In a browser the camera works only over **https**, or on the computer itself.
- Allow the camera for the site in your browser's settings.
- Typing the number under the barcode always works.

## A barcode was not found

Look-ups are off until you turn them on. When they are on and still find nothing, the catalog does not know that barcode: type the name, and Life Is keeps the barcode for next time. Numbers that stores print themselves, on things they weigh or label, mean nothing anywhere else and are not looked up.

## A reminder did not arrive

- Reminders go only on days there is something to say.
- Use **Send one now** under Settings › Reminders to test each way.
- Browser reminders need Life Is opened over https, and the browser allowed to show notifications.

See [Upkeep](upkeep.html#how-you-are-told).

## It was signed out

Life Is signs out after a while unused. Change how long under **Settings › Account & sign-in**.

## Something else

Write to hello@lifeis.living.
