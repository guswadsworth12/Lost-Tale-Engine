# Accounts and Sharing

The first person to set up a fresh install creates the **owner account** from the host computer. Every later visitor signs in. The owner can add other users under **Settings → Account**, issue one-time setup codes, and manage accounts. A new user chooses their own password after using a setup code. Keep those codes private; they are shown only when issued.

## Share content deliberately

Worlds, character cards, and standalone lorebooks have a **Who can see this** setting. New personal content is private unless its owner shares it. A private world also keeps its bound cast and stories private. Only an item's owner can change its visibility; an imported world pack starts private to the importing account.

Stories, messages, objectives, memories, and personal settings belong to their account. A shared world or character is reusable by other signed-in users, but sharing the template does not share someone's story history. See [World Packs](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/World-Packs) for a separate way to transfer reusable setup.

## Hosting implications

The server requires a session for app data and media routes. Keep remote access behind HTTPS and limit the allowed browser origins to addresses you actually use. Local first-run owner creation is restricted to the host. An owner backup and direct access to the data directory still contain the whole installation, including other users' data; treat them as sensitive. See [Backup, Restore and Privacy](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Backup-Restore-and-Privacy).
