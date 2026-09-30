# World packs

A world pack carries a world and its reusable setup to another install, or to another account on
the same one, without anyone's play history. Export one from a world's editor (**Export pack…**) and
import it from the Worlds list (**Import pack…**).

## What goes in

| On by default | Off by default | Never |
| :--- | :--- | :--- |
| World settings: description, rules, template, modules, campaign rules, tracked state, rank ladder | GM notes (may hold spoilers) | Stories, scenes, chats, messages |
| The world's lorebook, and world-info books bound to the world or its cast | Canon facts confirmed in play | Character memories, journals, recaps |
| Prompt items, scenarios, triggers, gifts and items, scene flags, custom intimacy options, Visual Novel stage layouts | Stat sheets of the cast | Objectives, relationship events, chat facts |
| Non-player cast cards, as templates | Private memory of the cast | Accounts, sessions, API keys, preferences |
| Portraits, sprites and outfits, backgrounds (day and night), music, gallery art | Player cards; VRM models | The world clock, story set events |

The export dialog shows each choice with its count and size, lets you leave out cast members one by
one, and lists everything that stays behind. You can name an author, a licence, and credits for any
file, for example a music track's composer and licence.

Which fields travel is decided once, in `src/lib/packs/fields.ts`, for every field a world,
character, or world-info book has. A new field fails the typecheck until it is classified there. The
single-character pack uses the same lists.

## The format

A pack is one folder, zipped for transport:

```
Salt Coast.ltpack/
  manifest.json          kind, format version, app version, title, author, licence, credits,
                         what was included and left out, and every media file with its size
  content/world.json
  content/characters.json
  content/lorebooks.json
  media/<sha256>.<ext>   each file once, however often it is used
```

Records carry pack-local keys (`world`, `character-1`, `lorebook-1`) instead of ids, and media fields
hold `ltpack-media:<file>` instead of a server path. On import every record gets a new id and every
reference is rewired: a character's world, its sheet, a book's world and cast bindings, and the cast a stage layout places. A
reference to something outside the pack is dropped, and the preview says so. A pack from a newer
format is refused with a message to update; older formats will be migrated.

Export streams the zip from disk, so neither the server nor the browser holds a world's media in
memory. Import accepts the zip or the unzipped folder.

## Importing safely

Nothing is added to the library until you have seen the preview. Before it, the server:

- unpacks the zip under limits on total size (3 GB), file count, per-file size, and compression
  ratio, checked while the bytes arrive, so a zip bomb stops at the limit;
- refuses paths that try to leave the pack, and ignores any file that isn't part of one;
- checks each media file's size, its hash against its name, and that its first bytes are the art or
  audio its name claims (no SVG, HTML, or scripts); a file that fails is left out with a warning.

The preview lists what will be created, the media size, credits and licence, what the exporter
left out, dropped references, and any world or character with the same name already in your
library. For each of those choose **Import as a copy** (the default, renamed "… (imported)"),
**Skip, keep mine** (references then point at yours), or **Replace mine**, which overwrites it with
the pack's version and needs its own confirmation. Nothing is overwritten silently.

The import is written in one database transaction. Media is moved into place only after it
commits, so a failed import leaves nothing behind. Imported media lives once per file in
`data/avatars/pack-media/`, shared by every import that uses it.

## Who can see it

Worlds, characters, and world-info books have an owner and a **Who can see this** setting:
everyone signed in, or only me. An import is private to the account that imported it until they
share it. A private world's cast is private with it, and a story that uses anything private is
private to the same person, with its messages, memories, and goals. Everything made before this
setting existed has no owner and stays shared.

Only an item's owner can change who sees it; an item with no owner can be taken private only by the
site owner. The site owner does not see other people's private items in the app, but server
backups (and the `data/` folder itself) still contain everything. Media files are served to any
signed-in user who has their address; the addresses aren't listed anywhere a private item's
non-owner can see.
