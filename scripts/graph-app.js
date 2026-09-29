import cytoscape from "../lib/cytoscape.esm.min.js";
import {
  MODULE_ID, getGraph, buildModel, allTags, readNode, isNode, newNodeFlags,
  writeNode, writePos, updateConnector, deleteConnector, addConnector,
  resolveColour, tagColour, colourSourceTag, textColour
} from "./data.js";
import { L, F, esc, docInfo, openDoc, promptText, confirm, parseTags, dropData, uuidAsync } from "./util.js";
import { AssociateApp } from "./associate.js";
import { GraphSettingsApp } from "./settings-app.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const GLOW = "#ff6400";
const FONT = '"Signika", "Palatino Linotype", sans-serif';

function nodeSize(label) {
  const w = Math.min(170, Math.max(70, 20 + label.length * 7.2));
  const lines = Math.ceil((label.length * 7.2) / (w - 16)) || 1;
  return { w, h: 18 + lines * 15 };
}

export class WorldWebApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static open() {
    this.instance ??= new WorldWebApp();
    return this.instance.render(true);
  }

  static refresh() {
    if (this.instance?.rendered) this.instance.render({ parts: ["panel"] });
  }

  /** { kind: "node", id } or { kind: "edge", id, source } */
  selection = null;
  /** Source node id while in connect mode. */
  linkSource = null;
  cy = null;
  model = null;

  static DEFAULT_OPTIONS = {
    id: "worldweb-graph",
    classes: ["worldweb", "worldweb-graph"],
    window: { title: "WORLDWEB.Title", icon: "fa-solid fa-diagram-project", resizable: true },
    position: { width: 1000, height: 680 },
    actions: {
      addNode: WorldWebApp.#onAddNode,
      addExisting: WorldWebApp.#onAddExisting,
      connect: WorldWebApp.#onConnect,
      fit: WorldWebApp.#onFit,
      layout: WorldWebApp.#onLayout,
      settings: () => GraphSettingsApp.open(),
      openNode: (event, target) => game.journal.get(target.dataset.id)?.sheet.render(true),
      openDoc: (event, target) => openDoc(target.dataset.uuid),
      openTag: WorldWebApp.#onOpenTag,
      selectNode: WorldWebApp.#onSelectNode,
      selectEdge: WorldWebApp.#onSelectEdge,
      removeTag: WorldWebApp.#onRemoveTag,
      setSourceTag: WorldWebApp.#onSetSourceTag,
      associate: WorldWebApp.#onAssociate,
      unlink: WorldWebApp.#onUnlink,
      clearColour: WorldWebApp.#onClearColour,
      toggleDirected: WorldWebApp.#onToggleDirected,
      deleteEdge: WorldWebApp.#onDeleteEdge,
      removeNode: WorldWebApp.#onRemoveNode,
      deselect: WorldWebApp.#onDeselect
    }
  };

  static PARTS = {
    graph: { template: `modules/${MODULE_ID}/templates/graph.hbs` },
    panel: { template: `modules/${MODULE_ID}/templates/panel.hbs` }
  };

  /* ---------- Context ---------- */

  async _prepareContext() {
    const g = getGraph();
    const model = this.model = buildModel();
    const ctx = {
      isGM: game.user.isGM,
      linking: !!this.linkSource,
      linkSourceName: model.nodes.get(this.linkSource)?.name ?? "",
      empty: model.nodes.size === 0,
      allTags: allTags(model, g),
      panel: null
    };

    // Drop a selection that no longer exists
    if (this.selection?.kind === "node" && !model.nodes.has(this.selection.id)) this.selection = null;
    if (this.selection?.kind === "edge" && !this.#findConnector(this.selection)) this.selection = null;

    if (this.selection?.kind === "node") ctx.panel = this.#nodePanel(this.selection.id, g);
    else if (this.selection?.kind === "edge") ctx.panel = this.#edgePanel(this.selection, g);
    return ctx;
  }

  #findConnector({ source, id }) {
    return this.model.nodes.get(source)?.connectors.find(c => c.id === id) ?? null;
  }

  #tagChips(item, g, canEdit) {
    const src = colourSourceTag(item);
    return item.tags.map(t => ({
      name: t,
      colour: tagColour(t, g),
      isSource: t === src && !item.colour,
      linked: !!g.tags[t]?.linkedDoc,
      canEdit
    }));
  }

  #nodePanel(id, g) {
    const n = this.model.nodes.get(id);
    const journal = game.journal.get(id);
    const canEdit = journal.isOwner;
    const name = nid => this.model.nodes.get(nid)?.name ?? "?";
    const label = c => c.tags.join(", ");

    const outgoing = n.connectors.map(c => {
      const broken = this.model.broken.some(b => b.source === id && b.id === c.id);
      const hidden = !broken && !this.model.nodes.has(c.target);
      return { id: c.id, source: id, other: broken ? L("WORLDWEB.Panel.Broken") : name(c.target),
        directed: c.directed, label: label(c), broken, hidden };
    }).filter(c => !c.hidden);
    const incoming = (this.model.incoming.get(id) ?? []).map(c => ({
      id: c.id, source: c.source, other: name(c.source), directed: c.directed, label: label(c)
    }));

    return {
      isNode: true, id, name: n.name, canEdit,
      colour: resolveColour(n, g), hasManualColour: !!n.colour,
      tags: this.#tagChips(n, g, canEdit),
      linked: docInfo(n.linkedDoc),
      outgoing, incoming,
      hasConnections: outgoing.length + incoming.length > 0
    };
  }

  #edgePanel(sel, g) {
    const c = this.#findConnector(sel);
    const canEdit = game.journal.get(sel.source).isOwner;
    return {
      isEdge: true, id: c.id, source: sel.source, target: c.target, canEdit,
      sourceName: this.model.nodes.get(sel.source)?.name,
      targetName: this.model.nodes.get(c.target)?.name,
      directed: c.directed,
      colour: resolveColour(c, g, g.defaultLinkColour), hasManualColour: !!c.colour,
      tags: this.#tagChips(c, g, canEdit),
      linked: docInfo(c.linkedDoc)
    };
  }

  /* ---------- Rendering ---------- */

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", ev => this.#onChange(ev));
    this.element.addEventListener("keydown", ev => this.#onKeydown(ev));
    this.element.addEventListener("dragover", ev => ev.preventDefault());
    this.element.addEventListener("drop", ev => this.#onDrop(ev));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (options.parts.includes("graph")) this.#initCy();
    this.#syncGraph();
  }

  #initCy() {
    this.cy?.destroy();
    const container = this.element.querySelector(".worldweb-canvas");
    const cy = this.cy = cytoscape({
      container,
      boxSelectionEnabled: false,
      minZoom: 0.1,
      maxZoom: 4,
      wheelSensitivity: 0.3,
      style: [
        { selector: "node", style: {
          "shape": "round-rectangle",
          "background-color": "data(colour)",
          "border-width": 1,
          "border-color": "#000000",
          "border-opacity": 0.5,
          "label": "data(label)",
          "color": "data(textColour)",
          "font-family": FONT,
          "font-size": 13,
          "text-valign": "center",
          "text-halign": "center",
          "text-wrap": "wrap",
          "text-max-width": ele => `${ele.data("w") - 14}px`,
          "width": "data(w)",
          "height": "data(h)"
        } },
        { selector: "node:selected", style: {
          "underlay-color": GLOW, "underlay-opacity": 0.55, "underlay-padding": 7,
          "underlay-shape": "round-rectangle", "border-color": GLOW, "border-width": 2, "border-opacity": 1
        } },
        { selector: "node.link-source", style: { "border-color": GLOW, "border-width": 3, "border-style": "dashed", "border-opacity": 1 } },
        { selector: "edge", style: {
          "width": 2,
          "line-color": "data(colour)",
          "target-arrow-color": "data(colour)",
          "target-arrow-shape": "none",
          "curve-style": "bezier",
          "label": "data(label)",
          "font-family": FONT,
          "font-size": 11,
          "color": "#e8e6dc",
          "text-rotation": "autorotate",
          "text-background-color": "data(bg)",
          "text-background-opacity": 0.85,
          "text-background-padding": 2
        } },
        { selector: "edge[?directed]", style: { "target-arrow-shape": "triangle", "arrow-scale": 1.2 } },
        { selector: "edge:selected", style: { "line-color": GLOW, "target-arrow-color": GLOW, "width": 3 } }
      ]
    });

    cy.on("tap", "node", ev => this.#onTapNode(ev.target.id()));
    cy.on("tap", "edge", ev => this.#select({ kind: "edge", id: ev.target.id(), source: ev.target.data("source") }));
    cy.on("tap", ev => { if (ev.target === cy) this.#select(null); });
    cy.on("dbltap", "node", ev => game.journal.get(ev.target.id())?.sheet.render(true));
    cy.on("dragfree", "node", ev => {
      const j = game.journal.get(ev.target.id());
      if (j) writePos(j, ev.target.position());
    });
    this.resizer?.disconnect();
    this.resizer = new ResizeObserver(() => cy.resize());
    this.resizer.observe(container);
    this._fitOnSync = true;
  }

  #syncGraph() {
    const cy = this.cy;
    if (!cy) return;
    const g = getGraph();
    this.element.querySelector(".worldweb-canvas").style.backgroundColor = g.background;

    const els = [];
    let i = 0;
    const centre = { x: 0, y: 0 };
    for (const n of this.model.nodes.values()) {
      const colour = resolveColour(n, g);
      const { w, h } = nodeSize(n.name);
      // Nodes without a saved position are placed on a spiral until moved
      const pos = n.pos ?? { x: centre.x + Math.cos(i * 2.4) * 60 * Math.sqrt(i + 1), y: centre.y + Math.sin(i * 2.4) * 60 * Math.sqrt(i + 1) };
      i++;
      els.push({
        group: "nodes",
        data: { id: n.id, label: n.name, colour, textColour: textColour(colour), w, h },
        position: { ...pos },
        grabbable: game.journal.get(n.id).isOwner
      });
    }
    for (const e of this.model.edges) {
      els.push({
        group: "edges",
        data: { id: e.id, source: e.source, target: e.target, directed: e.directed,
          label: e.tags.join(", "), colour: resolveColour(e, g, g.defaultLinkColour), bg: g.background }
      });
    }

    cy.batch(() => {
      cy.elements().remove();
      cy.add(els);
      if (this.selection) cy.getElementById(this.selection.id).select();
      if (this.linkSource) cy.getElementById(this.linkSource).addClass("link-source");
    });

    if (this._fitOnSync && this.model.nodes.size) {
      cy.fit(undefined, 60);
      if (cy.zoom() > 1.5) cy.zoom(1.5);
      this._fitOnSync = false;
    }
  }

  #select(selection) {
    this.selection = selection;
    this.render({ parts: ["panel"] });
  }

  #viewCentre() {
    const cy = this.cy;
    const ext = cy.extent();
    return { x: (ext.x1 + ext.x2) / 2, y: (ext.y1 + ext.y2) / 2 };
  }

  /* ---------- Connect mode ---------- */

  async #onTapNode(id) {
    if (!this.linkSource) return this.#select({ kind: "node", id });
    const source = this.linkSource;
    this.linkSource = null;
    if (source === id) return this.render({ parts: ["panel"] });

    const result = await DialogV2.prompt({
      window: { title: L("WORLDWEB.Connect.Title") },
      content: `<p>${esc(this.model.nodes.get(source)?.name)} &rarr; ${esc(this.model.nodes.get(id)?.name)}</p>
        <div class="form-group"><label>${L("WORLDWEB.Connect.Tags")}</label><input type="text" name="tags" placeholder="${L("WORLDWEB.Connect.TagsHint")}" autofocus></div>
        <div class="form-group"><label>${L("WORLDWEB.Connect.Directed")}</label><input type="checkbox" name="directed" checked></div>`,
      ok: { label: L("WORLDWEB.Connect.Create"), callback: (e, b) => ({ tags: parseTags(b.form.elements.tags.value), directed: b.form.elements.directed.checked }) },
      rejectClose: false
    });
    if (result) await addConnector(source, id, result);
    this.render({ parts: ["panel"] });
  }

  #onKeydown(ev) {
    if (ev.key === "Escape" && this.linkSource) {
      ev.stopPropagation();
      this.linkSource = null;
      this.render({ parts: ["panel"] });
    }
    if (ev.key === "Enter" && ev.target.name === "newTag") {
      ev.preventDefault();
      this.#addTag(ev.target.value);
    }
  }

  /* ---------- Inputs ---------- */

  async #onChange(ev) {
    const t = ev.target;
    if (t.name === "colour") await this.#setField({ colour: t.value });
    if (t.name === "newTag" && t.value.trim()) await this.#addTag(t.value);
  }

  async #setField(changes) {
    const sel = this.selection;
    if (!sel) return;
    if (sel.kind === "node") return writeNode(game.journal.get(sel.id), changes);
    return updateConnector(sel.source, sel.id, c => Object.assign(c, changes));
  }

  #selectedItem() {
    const sel = this.selection;
    if (!sel) return null;
    return sel.kind === "node" ? readNode(game.journal.get(sel.id)) : this.#findConnector(sel);
  }

  async #addTag(text) {
    const item = this.#selectedItem();
    if (!item) return;
    const tags = [...item.tags];
    for (const t of parseTags(text)) if (!tags.includes(t)) tags.push(t);
    await this.#setField({ tags });
  }

  /* ---------- Drag & drop ---------- */

  async #onDrop(ev) {
    const data = dropData(ev);
    if (!data?.uuid) return;
    ev.preventDefault();

    // Onto the detail panel: associate the document
    if (ev.target.closest(".worldweb-panel") && this.selection) return this.#setField({ linkedDoc: data.uuid });

    // Onto the canvas: a journal becomes a node where it was dropped
    if (!ev.target.closest(".worldweb-canvas") || data.type !== "JournalEntry") return;
    const journal = await uuidAsync(data.uuid);
    if (!journal || journal.pack) return ui.notifications.warn(L("WORLDWEB.Error.WorldJournalOnly"));
    if (isNode(journal)) return this.#select({ kind: "node", id: journal.id });

    const rect = this.cy.container().getBoundingClientRect();
    const pan = this.cy.pan(), zoom = this.cy.zoom();
    const pos = { x: (ev.clientX - rect.left - pan.x) / zoom, y: (ev.clientY - rect.top - pan.y) / zoom };
    await this.#makeNode(journal, pos);
  }

  async #makeNode(journal, pos) {
    if (!journal.isOwner) return ui.notifications.warn(L("WORLDWEB.Error.NotOwner"));
    const existing = journal.flags[MODULE_ID] ?? {};
    // Re-adding a previously removed node keeps its old tags and connectors
    const flags = { ...newNodeFlags(pos), ...existing, node: true, pos, rev: (existing.rev ?? 0) + 1 };
    await journal.update({ [`flags.${MODULE_ID}`]: flags });
    this.selection = { kind: "node", id: journal.id };
  }

  /* ---------- Actions ---------- */

  static async #onAddNode() {
    const name = await promptText(L("WORLDWEB.AddNode"), L("WORLDWEB.Name"));
    if (!name) return;
    try {
      const j = await JournalEntry.create({ name, flags: { [MODULE_ID]: newNodeFlags(this.#viewCentre()) } });
      this.#select({ kind: "node", id: j.id });
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  static async #onAddExisting() {
    const options = game.journal.filter(j => !isNode(j) && j.isOwner)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(j => `<option value="${j.id}">${esc(j.name)}</option>`).join("");
    if (!options) return ui.notifications.info(L("WORLDWEB.AddExistingNone"));
    const id = await DialogV2.prompt({
      window: { title: L("WORLDWEB.AddExisting") },
      content: `<div class="form-group"><label>${L("WORLDWEB.Journal")}</label><select name="id">${options}</select></div>`,
      ok: { label: L("WORLDWEB.OK"), callback: (e, b) => b.form.elements.id.value },
      rejectClose: false
    });
    const journal = game.journal.get(id);
    if (journal) await this.#makeNode(journal, this.#viewCentre());
  }

  static #onConnect(event, target) {
    if (this.linkSource) this.linkSource = null;
    else if (this.selection?.kind === "node") {
      if (!game.journal.get(this.selection.id).isOwner) return ui.notifications.warn(L("WORLDWEB.Error.NotOwner"));
      this.linkSource = this.selection.id;
    } else return ui.notifications.info(L("WORLDWEB.Connect.SelectFirst"));
    this.render({ parts: ["panel"] });
  }

  static #onFit() {
    this.cy?.fit(undefined, 60);
  }

  static async #onLayout() {
    const ok = await confirm(L("WORLDWEB.Layout"), L("WORLDWEB.LayoutConfirm"));
    if (!ok) return;
    const layout = this.cy.layout({ name: "cose", animate: false, nodeDimensionsIncludeLabels: true, padding: 40 });
    layout.one("layoutstop", async () => {
      const updates = this.cy.nodes()
        .filter(n => game.journal.get(n.id())?.isOwner)
        .map(n => ({ _id: n.id(), [`flags.${MODULE_ID}.pos`]: { x: Math.round(n.position("x")), y: Math.round(n.position("y")) } }));
      if (updates.length) await JournalEntry.updateDocuments(updates);
      this.cy.fit(undefined, 60);
    });
    layout.run();
  }

  static #onOpenTag(event, target) {
    const uuid = getGraph().tags[target.dataset.tag]?.linkedDoc;
    if (uuid) openDoc(uuid);
  }

  static #onSelectNode(event, target) {
    this.#select({ kind: "node", id: target.dataset.id });
    this.cy?.animate({ center: { eles: this.cy.getElementById(target.dataset.id) } }, { duration: 250 });
  }

  static #onSelectEdge(event, target) {
    this.#select({ kind: "edge", id: target.dataset.id, source: target.dataset.source });
  }

  static #onDeselect() {
    this.#select(null);
  }

  static async #onRemoveTag(event, target) {
    const item = this.#selectedItem();
    if (item) await this.#setField({ tags: item.tags.filter(t => t !== target.dataset.tag) });
  }

  static async #onSetSourceTag(event, target) {
    // Tapping a dot makes that tag the colour source and clears any manual colour
    await this.#setField({ colourTag: target.dataset.tag, colour: null });
  }

  static #onAssociate() {
    const sel = this.selection;
    if (!sel) return;
    const subject = sel.kind === "node" ? this.model.nodes.get(sel.id)?.name : L("WORLDWEB.Panel.Connection");
    new AssociateApp({ subject: F("WORLDWEB.Associate.For", { name: subject }), onPick: uuid => this.#setField({ linkedDoc: uuid }) }).render(true);
  }

  static async #onUnlink() {
    await this.#setField({ linkedDoc: null });
  }

  static async #onClearColour() {
    await this.#setField({ colour: null });
  }

  static async #onToggleDirected() {
    const sel = this.selection;
    if (sel?.kind === "edge") await updateConnector(sel.source, sel.id, c => { c.directed = !c.directed; });
  }

  static async #onDeleteEdge(event, target) {
    const source = target.dataset.source ?? this.selection?.source;
    const id = target.dataset.id ?? this.selection?.id;
    if (!source || !id) return;
    const ok = await confirm(L("WORLDWEB.Panel.DeleteConnection"), L("WORLDWEB.Panel.DeleteConnectionConfirm"));
    if (ok) await deleteConnector(source, id);
  }

  static async #onRemoveNode() {
    const sel = this.selection;
    if (sel?.kind !== "node") return;
    const journal = game.journal.get(sel.id);
    const choice = await DialogV2.wait({
      window: { title: L("WORLDWEB.Panel.RemoveNode") },
      content: `<p>${F("WORLDWEB.Panel.RemoveNodeConfirm", { name: esc(journal.name) })}</p>`,
      buttons: [
        { action: "graph", label: L("WORLDWEB.Panel.RemoveGraphOnly"), icon: "fa-solid fa-eye-slash", default: true },
        { action: "delete", label: L("WORLDWEB.Panel.DeleteJournal"), icon: "fa-solid fa-trash" },
        { action: "cancel", label: L("WORLDWEB.Cancel") }
      ],
      rejectClose: false
    });
    if (choice !== "graph" && choice !== "delete") return;
    this.selection = null;
    try {
      if (choice === "delete") await journal.delete();
      else await journal.unsetFlag(MODULE_ID, "node");
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  /* ---------- Cleanup ---------- */

  async _onClose(options) {
    await super._onClose?.(options);
    this.resizer?.disconnect();
    this.cy?.destroy();
    this.cy = null;
    this.linkSource = null;
    WorldWebApp.instance = null;
  }
}
