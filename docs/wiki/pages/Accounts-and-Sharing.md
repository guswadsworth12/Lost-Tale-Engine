# Accounts and Sharing

The first person to set up a fresh install creates the **owner account** from the host computer. Every later visitor signs in.

## Your account

The round button with your initial in the top-right corner is the **account menu** (on a phone it sits at the top of **Settings**). It shows who is signed in and their role, and holds **Change password**, **Account settings**, **Admin** (owners only), and **Sign out**. Signing out returns to the sign-in screen, which is also how to sign in as someone else.

![The account menu open: signed in as demo, Owner, with Change password, Account settings, Admin, and Sign out](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-account-menu.jpg)

## Adding people (owners)

Open **Admin** from the account menu, or **Settings → Admin**. **Add user** takes a username and an optional email (they can sign in with either). Choose **They choose it (setup code)** to get a one-time setup code to hand them, or **Set a temporary password**. Codes are shown once; keep them private. The **Users** list can issue a new setup code, set a password, or remove someone.

![Settings → Admin with the Users list and the Add user form](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-admin.jpg)

When you remove someone, their sign-in, settings, and keys are deleted. **When you remove someone** decides what happens to what they made: **Give their things to me** (the default) moves it to you as it is; **Delete what only they had** deletes it for good, except anything they shared or that someone else still uses (a character in another person's story, a world another person's character lives in), which passes to you instead. **Left behind** lists anything still owned by a removed account, with **Give to me** and **Delete**. The database is backed up to `data/backups/` before anything is deleted.

## Share content deliberately

Worlds, character cards, and standalone lorebooks have a **Who can see this** setting: **Only me** or **Everyone signed in**. New content is private unless its owner shares it. A private world also keeps its bound cast and stories private. Only an item's owner can change its visibility; an imported world pack starts private to the importing account. The bundled demo worlds and characters (including Hollowmere Station) are shared with everyone.

Stories, messages, objectives, memories, and personal settings always belong to the account that made them, and are never shared, not even with the owner in the app. A shared world or character is reusable by other signed-in users, but sharing the template does not share anyone's story history. See [World Packs](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/World-Packs) for a separate way to transfer reusable setup.

## Hosting implications

The server requires a session for app data and media routes, and checks ownership on every record and media file. Keep remote access behind HTTPS and limit the allowed browser origins to addresses you actually use. First-run owner creation is restricted to the host. A full backup and direct access to the data directory still contain the whole installation, including other users' data; treat them as sensitive. See [Backup, Restore and Privacy](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Backup-Restore-and-Privacy).
