// Data layer. No UI code here, so the Android app can reuse the logic.
// Schema is documented in README.md.

export const MODULE_ID = "worldweb";
export const SETTING = "graph";
export const SCHEMA = 1;

export const DEFAULT_GRAPH = {
  background: "#2b2a29",
  defaultColour: "#6b6a64",
  defaultLinkColour: "#a8a69c",
  tags: {},        // { tagName: { colour, linkedDoc } }
  tombstones: []   // [{ id, time }]
};

/* ---------- Settings ---------- */

export function registerSettings(onChange) {
  game.settings.register(MODULE_ID, SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(DEFAULT_GRAPH),
    onChange
  });
}

export function getGraph() {
  const stored = game.settings.get(MODULE_ID, SETTING) ?? {};
  return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_GRAPH), stored, { inplace: false });
}

/** Replace the whole graph setting. GM only. */
export async function saveGraph(graph) {
  if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("WORLDWEB.Error.GMOnly"));
  return game.settings.set(MODULE_ID, SETTING, graph);
}

/* ---------- Nodes ---------- */

export function isNode(journal) {
  return !!journal?.flags?.[MODULE_ID]?.node;
}

export function readConnector(c) {
  return {
    id: c.id,
    target: c.target,
    directed: !!c.directed,
    tags: [...(c.tags ?? [])],
    linkedDoc: c.linkedDoc ?? null,
    colour: c.colour ?? null,
    colourTag: c.colourTag ?? null
  };
}

export function readNode(journal) {
  const f = journal.flags?.[MODULE_ID] ?? {};
  return {
    id: journal.id,
    name: journal.name,
    tags: [...(f.tags ?? [])],
    linkedDoc: f.linkedDoc ?? null,
    colour: f.colour ?? null,
    colourTag: f.colourTag ?? null,
    connectors: (f.connectors ?? []).map(readConnector),
    pos: f.pos ?? null,
    rev: f.rev ?? 0
  };
}

/** Fresh flag data for a new node. */
export function newNodeFlags(pos = null) {
  return { node: true, schema: SCHEMA, tags: [], connectors: [], linkedDoc: null, colour: null, colourTag: null, pos, rev: 1 };
}

/**
 * Write node fields (tags, connectors, linkedDoc, colour, colourTag).
 * Every content change bumps rev, which the app uses for sync.
 */
export async function writeNode(journal, changes) {
  if (!journal.isOwner) return ui.notifications.warn(game.i18n.localize("WORLDWEB.Error.NotOwner"));
  const update = { [`flags.${MODULE_ID}.rev`]: (journal.flags[MODULE_ID]?.rev ?? 0) + 1 };
  for (const [k, v] of Object.entries(changes)) update[`flags.${MODULE_ID}.${k}`] = v;
  return journal.update(update);
}

/** Position is layout, not content, so it does not bump rev. */
export async function writePos(journal, pos) {
  if (!journal.isOwner) return;
  return journal.update({ [`flags.${MODULE_ID}.pos`]: { x: Math.round(pos.x), y: Math.round(pos.y) } });
}

export async function updateConnector(sourceId, connectorId, fn) {
  const journal = game.journal.get(sourceId);
  if (!journal) return;
  const connectors = readNode(journal).connectors;
  const c = connectors.find(x => x.id === connectorId);
  if (!c) return;
  fn(c);
  return writeNode(journal, { connectors });
}

export async function deleteConnector(sourceId, connectorId) {
  const journal = game.journal.get(sourceId);
  if (!journal) return;
  const connectors = readNode(journal).connectors.filter(x => x.id !== connectorId);
  return writeNode(journal, { connectors });
}

export async function addConnector(sourceId, targetId, { directed = true, tags = [] } = {}) {
  const journal = game.journal.get(sourceId);
  if (!journal) return;
  const connectors = readNode(journal).connectors;
  connectors.push({ id: foundry.utils.randomID(), target: targetId, directed, tags, linkedDoc: null, colour: null, colourTag: null });
  return writeNode(journal, { connectors });
}

/* ---------- Tombstones (run by the active GM only) ---------- */

export async function addTombstone(id) {
  const g = getGraph();
  if (g.tombstones.some(t => t.id === id)) return;
  g.tombstones.push({ id, time: Date.now() });
  return saveGraph(g);
}

export async function removeTombstone(id) {
  const g = getGraph();
  if (!g.tombstones.some(t => t.id === id)) return;
  g.tombstones = g.tombstones.filter(t => t.id !== id);
  return saveGraph(g);
}

/* ---------- Colours ---------- */

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return "#" + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

/** Stable colour for tags not in the registry. */
export function hashColour(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return hslToHex(h % 360, 40, 42);
}

export function tagColour(name, graph) {
  return graph.tags[name]?.colour ?? hashColour(name);
}

/** The tag that decides colour: chosen tag if still present, else the first tag. */
export function colourSourceTag(item) {
  if (item.colourTag && item.tags.includes(item.colourTag)) return item.colourTag;
  return item.tags[0] ?? null;
}

/** Precedence: manual colour -> colour-source tag -> global default. */
export function resolveColour(item, graph, fallback = graph.defaultColour) {
  if (item.colour) return item.colour;
  const t = colourSourceTag(item);
  return t ? tagColour(t, graph) : fallback;
}

export function textColour(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#111111" : "#f4f2ea";
}

/* ---------- Graph model ---------- */

/**
 * Everything the UI needs, built from the journals this user can see.
 * Incoming connectors are indexed here at runtime.
 */
export function buildModel() {
  const nodes = new Map();
  for (const j of game.journal) if (isNode(j) && j.visible) nodes.set(j.id, readNode(j));

  const edges = [];
  const broken = [];
  const incoming = new Map();
  for (const n of nodes.values()) {
    for (const c of n.connectors) {
      const target = game.journal.get(c.target);
      if (!target || !isNode(target)) broken.push({ source: n.id, ...c });
      else if (nodes.has(c.target)) {
        const e = { source: n.id, ...c };
        edges.push(e);
        if (!incoming.has(c.target)) incoming.set(c.target, []);
        incoming.get(c.target).push(e);
      }
      // else: target exists but is hidden from this user, so skip it
    }
  }
  return { nodes, edges, broken, incoming };
}

/** All tag names in use or registered, sorted. */
export function allTags(model, graph) {
  const set = new Set(Object.keys(graph.tags));
  for (const n of model.nodes.values()) {
    n.tags.forEach(t => set.add(t));
    n.connectors.forEach(c => c.tags.forEach(t => set.add(t)));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
