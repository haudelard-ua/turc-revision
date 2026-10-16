// Progression locale (localStorage) + synchronisation via un Gist GitHub privé.
// Toutes les clés sont préfixées : l'origine <user>.github.io est partagée
// avec les autres sites GitHub Pages du compte.

const PREFIX = "turc-review:";
const GIST_FILE = "turc-review-state.json";
const GIST_DESC = "Turc — Révision : progression SRS (ne pas supprimer)";
const API = "https://api.github.com";

function lsGet(key) {
  try { return localStorage.getItem(PREFIX + key); } catch { return null; }
}
function lsSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {}
}

// ---------- État local ----------

export function loadItems() {
  try {
    const raw = JSON.parse(lsGet("state") || "null");
    return raw?.items || {};
  } catch { return {}; }
}

export function saveItems(items) {
  lsSet("state", JSON.stringify({ version: 1, items }));
}

export function loadJSON(key, fallback = null) {
  try { return JSON.parse(lsGet(key) || "null") ?? fallback; } catch { return fallback; }
}
export function saveJSON(key, value) {
  lsSet(key, value === null ? null : JSON.stringify(value));
}

// Fusion par exo : le plus récemment vu gagne (mono-utilisateur, suffisant).
export function mergeItems(a, b) {
  const out = { ...a };
  for (const [id, s] of Object.entries(b || {})) {
    const cur = out[id];
    if (!cur || (s.last_seen_at || "") > (cur.last_seen_at || "")) out[id] = s;
  }
  return out;
}

// ---------- Gist ----------

export const sync = {
  get token() { return lsGet("token"); },
  set token(v) { lsSet("token", v || null); lsSet("gistId", null); },
  get gistId() { return lsGet("gistId"); },
  set gistId(v) { lsSet("gistId", v); },
  get lastSync() { return lsGet("lastSync"); },
  enabled() { return !!this.token; },
};

async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    cache: "no-store",
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${sync.token}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    const msg = res.status === 401 ? "token invalide ou expiré" : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

async function findOrCreateGist(items) {
  if (sync.gistId) return sync.gistId;
  for (let page = 1; page <= 10; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.files && GIST_FILE in g.files);
    if (hit) { sync.gistId = hit.id; return hit.id; }
    if (list.length < 100) break;
  }
  const created = await gh("/gists", {
    method: "POST",
    body: JSON.stringify({
      description: GIST_DESC,
      public: false,
      files: { [GIST_FILE]: { content: JSON.stringify({ version: 1, items }) } },
    }),
  });
  sync.gistId = created.id;
  return created.id;
}

async function pullRemote(id) {
  const g = await gh(`/gists/${id}`);
  const f = g.files?.[GIST_FILE];
  if (!f) return {};
  let content = f.content;
  if (f.truncated) content = await (await fetch(f.raw_url, { cache: "no-store" })).text();
  try { return JSON.parse(content).items || {}; } catch { return {}; }
}

function pushBody(items) {
  return JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify({ version: 1, items }) } } });
}

// Pull + fusion + push. Retourne les items fusionnés (déjà sauvegardés localement).
export async function syncNow(items) {
  if (!sync.enabled()) return items;
  const id = await findOrCreateGist(items);
  const merged = mergeItems(items, await pullRemote(id));
  saveItems(merged);
  await gh(`/gists/${id}`, { method: "PATCH", body: pushBody(merged) });
  lsSet("lastSync", new Date().toISOString());
  return merged;
}

// Push seul, sans attendre la réponse : fermeture d'onglet, mise en arrière-plan.
export function pushOnExit(items) {
  if (!sync.enabled() || !sync.gistId) return;
  try {
    fetch(`${API}/gists/${sync.gistId}`, {
      method: "PATCH",
      keepalive: true,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${sync.token}`,
        "Content-Type": "application/json",
      },
      body: pushBody(items),
    });
  } catch {}
}
