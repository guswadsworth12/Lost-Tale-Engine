# Backup, restore, and privacy

Worlds, cast, stories, messages, and media are stored under `data/` by default, or the absolute path set by `LOST_TALES_DATA_DIR`. That folder is git-ignored and must be backed up separately from source code. In Docker, back up the mounted data volume.

## Make and restore a backup

Open **Settings → Data → Download backup** to save a full app backup. Store it privately: it includes the installation's content, including other users' stories and media on a multi-user install. Accounts, sessions, API keys, and preferences are left out. **Restore from backup…** replaces everything currently in the app, so download a fresh backup first and check you selected the intended installation and file. Only owner accounts can download or restore a full backup.

![Settings → Data with Download backup, Restore from backup, and the Help & tutorial controls](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-data-backup.jpg)

The server also keeps its own safety copies in `data/backups/`: one before each one-time data migration, and one before **Admin** deletes what a removed account left behind.

For a reusable world without stories or accounts, export a [World Pack](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/World-Packs) instead. A pack has explicit inclusion choices for GM notes, canon, sheets, player cards, and media.

## Sharing and providers

Worlds, characters, and lore are private to their owner unless shared with everyone signed in. An imported pack begins private. Records made before accounts existed belong to the site owner (the first owner account) and are private too. Stories and their messages, goals, and memories are never shared. Owners can still reach the data folder and full backups, so account privacy is an access boundary in the app, not encryption from the server operator.

Local model inference can stay on your machine; a hosted text, image, or voice service receives the content sent for that feature. Keep service keys in **Models and services**, never in a world pack, screenshot, issue, or repository file. See [Accounts and Sharing](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Accounts-and-Sharing).
