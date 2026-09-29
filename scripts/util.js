const { DialogV2 } = foundry.applications.api;

export const L = key => game.i18n.localize(key);
export const F = (key, data) => game.i18n.format(key, data);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const uuidSync = uuid => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)(uuid);
export const uuidAsync = uuid => (foundry.utils.fromUuid ?? globalThis.fromUuid)(uuid);

/** Display info for a linked document UUID. */
export function docInfo(uuid) {
  if (!uuid) return null;
  let doc = null;
  try { doc = uuidSync(uuid); } catch { doc = null; }
  if (!doc) return { uuid, name: L("WORLDWEB.Doc.Missing"), icon: "fa-solid fa-triangle-exclamation", missing: true };
  const icon = CONFIG[doc.documentName]?.sidebarIcon ?? "fa-solid fa-file";
  return { uuid, name: doc.name, icon, missing: false };
}

export async function openDoc(uuid) {
  const doc = await uuidAsync(uuid);
  if (!doc) return ui.notifications.warn(L("WORLDWEB.Doc.Missing"));
  if (doc.documentName === "Scene") return doc.view();
  if (doc.documentName === "Macro") return doc.execute();
  if (doc.documentName === "JournalEntryPage") return doc.parent.sheet.render(true, { pageId: doc.id });
  return doc.sheet?.render(true);
}

/** Ask for one line of text. Returns null if cancelled or empty. */
export async function promptText(title, label, value = "") {
  const result = await DialogV2.prompt({
    window: { title },
    content: `<div class="form-group"><label>${esc(label)}</label><input type="text" name="value" value="${esc(value)}" autofocus></div>`,
    ok: { label: L("WORLDWEB.OK"), callback: (event, button) => button.form.elements.value.value.trim() },
    rejectClose: false
  });
  return result || null;
}

export async function confirm(title, content) {
  return DialogV2.confirm({ window: { title }, content: `<p>${content}</p>`, rejectClose: false });
}

/** Split "a, b ,c" into unique non-empty tags. */
export function parseTags(text) {
  return [...new Set(String(text ?? "").split(",").map(t => t.trim()).filter(Boolean))];
}

/** Parse Foundry drag data from a drop event. */
export function dropData(event) {
  try { return JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return null; }
}
