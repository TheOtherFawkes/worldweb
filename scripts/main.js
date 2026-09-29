import { MODULE_ID, SCHEMA, registerSettings, isNode, addTombstone, removeTombstone, getGraph } from "./data.js";
import { WorldWebApp } from "./graph-app.js";
import { GraphSettingsApp } from "./settings-app.js";

const refresh = foundry.utils.debounce(() => {
  WorldWebApp.refresh();
  if (GraphSettingsApp.instance?.rendered) GraphSettingsApp.instance.render();
}, 50);

const isActiveGM = () => game.users.activeGM?.isSelf ?? game.user.isGM;

Hooks.once("init", () => {
  registerSettings(refresh);
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = {
    schema: SCHEMA,
    open: () => WorldWebApp.open(),
    openSettings: () => GraphSettingsApp.open()
  };
});

// Keep the open graph in step with journal changes from anyone
Hooks.on("createJournalEntry", refresh);
Hooks.on("updateJournalEntry", refresh);
Hooks.on("deleteJournalEntry", refresh);

// Tombstones: removed nodes are recorded so a stale device can't bring them back
Hooks.on("deleteJournalEntry", doc => {
  if (isNode(doc) && isActiveGM()) addTombstone(doc.id);
});

Hooks.on("updateJournalEntry", (doc, changes) => {
  if (!isActiveGM() || changes.flags?.[MODULE_ID] === undefined) return;
  const tombstoned = getGraph().tombstones.some(t => t.id === doc.id);
  if (!isNode(doc) && !tombstoned) addTombstone(doc.id);
  if (isNode(doc) && tombstoned) removeTombstone(doc.id);
});

// "WorldWeb" button in the Journal sidebar
Hooks.on("renderJournalDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".worldweb-open")) return;
  const actions = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
  if (!actions) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "worldweb-open";
  button.innerHTML = `<i class="fa-solid fa-diagram-project"></i> ${game.i18n.localize("WORLDWEB.Title")}`;
  button.addEventListener("click", () => WorldWebApp.open());
  actions.append(button);
});
