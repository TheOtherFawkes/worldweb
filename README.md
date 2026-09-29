# WorldWeb

A system-agnostic worldbuilding graph for Foundry VTT (v13+, verified on v14).
Journal entries become **nodes**, joined by tagged **connections**. Each node, tag, and connection can link to one document (Scene, Actor, Item, Journal, …).

## Use

- Open it from the **WorldWeb** button in the Journal sidebar, or with the macro `game.modules.get("worldweb").api.open()`.
- **New node** creates a journal entry. **Add journal** or dragging a journal onto the canvas turns an existing entry into a node.
- Select a node, press **Connect**, then click the target node.
- Click a tag's colour dot to use that tag's colour. Double-click a node to open its journal.
- Link a document with **Associate**, or drag one from the sidebar onto the detail panel.
- GMs set the background, default colours, and tag colours/links under the palette button.

## Install

Manifest URL:
`https://raw.githubusercontent.com/TheOtherFawkes/worldweb/main/module.json`

## Release checklist

1. Bump `version` in `module.json` and the tag in `download` (e.g. `v0.1.1`).
2. Commit and push to `main`.
3. Zip the repo contents **flat** (no wrapper folder) as `module.zip`.
4. Create a GitHub release with the matching tag and attach `module.zip` and `module.json`.

## Data schema (v1)

Shared with the companion app. Nothing here is edited through Foundry's UI.

**Node** = a JournalEntry with `flags.worldweb`:

| Key | Type | Notes |
|---|---|---|
| `node` | `true` | Marks the journal as a node. Unset = removed from graph (data kept). |
| `schema` | number | Currently `1`. |
| `tags` | string[] | Order matters: the first tag is the default colour source. |
| `colourTag` | string \| null | Tag chosen as colour source. |
| `colour` | `#rrggbb` \| null | Manual colour; wins over tags. |
| `linkedDoc` | UUID \| null | e.g. `Scene.abc123`. |
| `connectors` | Connector[] | Outgoing connections. |
| `pos` | `{x, y}` \| null | Canvas position. Does **not** bump `rev`. |
| `rev` | number | +1 on every content change. Used for sync. |

**Connector** (stored on its source node): `{ id, target, directed, tags[], linkedDoc, colour, colourTag }`.
Incoming connections are indexed at runtime. A connector whose target is missing or no longer a node is shown as broken.

**World setting** `worldweb.graph` (hidden):
`{ background, defaultColour, defaultLinkColour, tags: { name: { colour, linkedDoc } }, tombstones: [{ id, time }] }`

- Colour precedence: manual colour → colour-source tag → default. Tags not in the registry get a colour hashed from their name (`hashColour` in `scripts/data.js`).
- Tombstones are written by the active GM when a node journal is deleted or removed from the graph, and cleared when it is re-added.

## Permissions

Editing a node or its outgoing connections needs owner permission on that journal. Graph settings and tag colours are GM-only.

## Credits

Graph rendering by [Cytoscape.js](https://js.cytoscape.org/) 3.34.3 (MIT, see `lib/cytoscape-LICENSE.txt`).
