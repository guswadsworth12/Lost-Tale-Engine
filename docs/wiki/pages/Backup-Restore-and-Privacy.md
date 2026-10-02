# Backup, restore, and privacy

Worlds, cast, stories, messages, and media are stored under `data/` by default, or the absolute path set by `LOST_TALES_DATA_DIR`. That folder is git-ignored and must be backed up separately from source code. In Docker, back up the mounted data volume.

## Make and restore a backup

Open **Settings → Data → Download backup** to save a full app backup. Store it privately: it includes the installation's content, including other users' stories and media on a multiuser installation. Account credentials themselves are excluded. **Restore from backup…** replaces current content, so download a fresh backup first and verify you selected the intended installation and file. Only the site owner can use the full backup endpoints.

For a reusable world without stories or accounts, export a [World Pack](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/World-Packs) instead. A pack has explicit inclusion choices for GM notes, canon, sheets, player cards, and media.

## Sharing and providers

Worlds, characters, and lore can be private to their owner or visible to signed-in users. An imported pack begins private. Older unowned items remain shared until handled by an owner. Stories using private content stay private with their messages, goals, and memories. Site owners can still access the data folder and full backups, so account privacy is an app access boundary, not encryption from the server operator.

Local model inference can stay on your machine; a hosted text, image, or voice provider receives the content sent for that feature. Keep provider keys in the app's account settings, never in a world pack, screenshot, issue, or repository file. See [Accounts and Sharing](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Accounts-and-Sharing).
