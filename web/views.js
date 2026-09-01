// Saved views. A view is the operator's whole vantage point — which half of the
// app, what the panel filter is set to, and where the map is pointing — under a
// name they choose. Kept in localStorage: it is per-operator preference, not
// shared state, so it does not belong on the server.

const KEY = 'blackwall.views';
const LAST = 'blackwall.lastView';

const read = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
  catch { return fallback; }
};

/** All saved views, newest first. */
export const listViews = () => read(KEY, []);

export function saveView(name, snapshot) {
  const clean = String(name).trim().slice(0, 48);
  if (!clean) return null;
  const views = listViews().filter((v) => v.name.toLowerCase() !== clean.toLowerCase());
  views.unshift({ name: clean, at: Date.now(), ...snapshot });
  localStorage.setItem(KEY, JSON.stringify(views.slice(0, 24)));
  return clean;
}

export function deleteView(name) {
  localStorage.setItem(KEY, JSON.stringify(
    listViews().filter((v) => v.name.toLowerCase() !== String(name).toLowerCase())));
}

/** The view to restore on load: whatever was last active. Distinct from the
 *  named views — this is the "leave it as I left it" behaviour. */
export const lastView = () => read(LAST, null);
export const rememberLast = (snapshot) =>
  localStorage.setItem(LAST, JSON.stringify(snapshot));
