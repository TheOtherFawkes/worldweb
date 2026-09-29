import { MODULE_ID } from "./data.js";
import { L, F, esc, promptText } from "./util.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const CATEGORIES = ["Actor", "Item", "JournalEntry", "Scene", "RollTable", "Cards", "Playlist", "Macro"];

const canSee = doc => game.user.isGM || doc.testUserPermission(game.user, "LIMITED");

function folderDepth(folderId) {
  let depth = 0;
  let f = folderId ? game.folders.get(folderId) : null;
  while (f) { depth++; f = f.folder; }
  return depth;
}

/**
 * Associate -> Category -> Subfolder / Selection / New Subfolder / New Selection -> repeat.
 * Calls onPick(uuid) when a document is chosen or created.
 */
export class AssociateApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ onPick, subject } = {}) {
    super();
    this.onPick = onPick;
    this.subject = subject ?? "";
    this.type = null;
    this.folderId = null;
  }

  static DEFAULT_OPTIONS = {
    classes: ["worldweb", "worldweb-associate"],
    window: { title: "WORLDWEB.Associate.Title", icon: "fa-solid fa-link", resizable: true },
    position: { width: 360, height: 480 },
    actions: {
      category: AssociateApp.#onCategory,
      folder: AssociateApp.#onFolder,
      back: AssociateApp.#onBack,
      pick: AssociateApp.#onPick,
      newFolder: AssociateApp.#onNewFolder,
      newDoc: AssociateApp.#onNewDoc
    }
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/associate.hbs` } };

  async _prepareContext() {
    const ctx = { subject: this.subject, atCategories: !this.type };
    if (!this.type) {
      ctx.categories = CATEGORIES.filter(t => game.collections.get(t)).map(t => ({
        type: t,
        label: L(CONFIG[t].documentClass.metadata.labelPlural),
        icon: CONFIG[t].sidebarIcon
      }));
      return ctx;
    }

    const byName = (a, b) => a.name.localeCompare(b.name);
    const here = d => (d.folder?.id ?? null) === this.folderId;

    ctx.categoryLabel = L(CONFIG[this.type].documentClass.metadata.labelPlural);
    ctx.path = [];
    for (let f = this.folderId ? game.folders.get(this.folderId) : null; f; f = f.folder) ctx.path.unshift(f.name);
    ctx.folders = game.folders.filter(f => f.type === this.type && here(f) && f.visible !== false).sort(byName)
      .map(f => ({ id: f.id, name: f.name }));
    ctx.docs = game.collections.get(this.type).filter(d => here(d) && canSee(d)).sort(byName)
      .map(d => ({ uuid: d.uuid, name: d.name }));
    const max = CONST.FOLDER_MAX_DEPTH ?? 4;
    ctx.canNewFolder = game.user.isGM && folderDepth(this.folderId) < max;
    ctx.empty = !ctx.folders.length && !ctx.docs.length;
    return ctx;
  }

  static #onCategory(event, target) {
    this.type = target.dataset.type;
    this.folderId = null;
    this.render();
  }

  static #onFolder(event, target) {
    this.folderId = target.dataset.id;
    this.render();
  }

  static #onBack() {
    if (this.folderId) this.folderId = game.folders.get(this.folderId)?.folder?.id ?? null;
    else this.type = null;
    this.render();
  }

  static async #onPick(event, target) {
    await this.onPick?.(target.dataset.uuid);
    this.close();
  }

  static async #onNewFolder() {
    const name = await promptText(L("WORLDWEB.Associate.NewFolder"), L("WORLDWEB.Name"));
    if (!name) return;
    try {
      const f = await Folder.create({ name, type: this.type, folder: this.folderId });
      this.folderId = f.id;
      this.render();
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  static async #onNewDoc() {
    const types = (game.documentTypes?.[this.type] ?? []).filter(t => t !== "base");
    let name, subtype;

    if (types.length > 1) {
      const labels = CONFIG[this.type].typeLabels ?? {};
      const options = types.map(t => `<option value="${esc(t)}">${esc(labels[t] ? L(labels[t]) : t)}</option>`).join("");
      const result = await DialogV2.prompt({
        window: { title: L("WORLDWEB.Associate.NewDoc") },
        content: `<div class="form-group"><label>${L("WORLDWEB.Name")}</label><input type="text" name="name" autofocus></div>
                  <div class="form-group"><label>${L("WORLDWEB.Type")}</label><select name="type">${options}</select></div>`,
        ok: { label: L("WORLDWEB.OK"), callback: (e, b) => ({ name: b.form.elements.name.value.trim(), type: b.form.elements.type.value }) },
        rejectClose: false
      });
      if (!result?.name) return;
      ({ name, type: subtype } = result);
    } else {
      name = await promptText(L("WORLDWEB.Associate.NewDoc"), L("WORLDWEB.Name"));
      if (!name) return;
    }

    try {
      const data = { name, folder: this.folderId };
      if (subtype) data.type = subtype;
      const doc = await CONFIG[this.type].documentClass.create(data);
      ui.notifications.info(F("WORLDWEB.Associate.Created", { name: doc.name }));
      await this.onPick?.(doc.uuid);
      this.close();
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }
}
