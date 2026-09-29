import { MODULE_ID, getGraph, saveGraph, buildModel, allTags, tagColour } from "./data.js";
import { L, F, docInfo, openDoc } from "./util.js";
import { AssociateApp } from "./associate.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class GraphSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static open() {
    if (!game.user.isGM) return ui.notifications.warn(L("WORLDWEB.Error.GMOnly"));
    this.instance ??= new GraphSettingsApp();
    return this.instance.render(true);
  }

  static DEFAULT_OPTIONS = {
    id: "worldweb-settings",
    classes: ["worldweb", "worldweb-settings"],
    window: { title: "WORLDWEB.Settings.Title", icon: "fa-solid fa-palette", resizable: true },
    position: { width: 440, height: 560 },
    actions: {
      associateTag: GraphSettingsApp.#onAssociateTag,
      unlinkTag: GraphSettingsApp.#onUnlinkTag,
      openDoc: (event, target) => openDoc(target.dataset.uuid),
      resetTag: GraphSettingsApp.#onResetTag
    }
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/settings.hbs` } };

  async _prepareContext() {
    const g = getGraph();
    return {
      background: g.background,
      defaultColour: g.defaultColour,
      defaultLinkColour: g.defaultLinkColour,
      tags: allTags(buildModel(), g).map(name => ({
        name,
        colour: tagColour(name, g),
        registered: !!g.tags[name],
        linked: docInfo(g.tags[name]?.linkedDoc)
      }))
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("input[type=color]").forEach(input =>
      input.addEventListener("change", ev => this.#onColour(ev.currentTarget)));
  }

  async #onColour(input) {
    const g = getGraph();
    const { field, tag } = input.dataset;
    if (tag) g.tags[tag] = { ...(g.tags[tag] ?? {}), colour: input.value };
    else g[field] = input.value;
    await saveGraph(g);
  }

  static #onAssociateTag(event, target) {
    const tag = target.dataset.tag;
    new AssociateApp({
      subject: F("WORLDWEB.Associate.ForTag", { tag }),
      onPick: async uuid => {
        const g = getGraph();
        g.tags[tag] = { colour: tagColour(tag, g), ...(g.tags[tag] ?? {}), linkedDoc: uuid };
        await saveGraph(g);
      }
    }).render(true);
  }

  static async #onUnlinkTag(event, target) {
    const g = getGraph();
    const t = g.tags[target.dataset.tag];
    if (!t) return;
    t.linkedDoc = null;
    await saveGraph(g);
  }

  static async #onResetTag(event, target) {
    const g = getGraph();
    delete g.tags[target.dataset.tag];
    await saveGraph(g);
  }

  async _onClose(options) {
    await super._onClose?.(options);
    GraphSettingsApp.instance = null;
  }
}
