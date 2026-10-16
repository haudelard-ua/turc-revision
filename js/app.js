import { compare } from "./normalize.js";
import * as srs from "./srs.js";
import { loadItems, saveItems, loadJSON, saveJSON, mergeItems, sync, syncNow, pushOnExit } from "./store.js";

const $main = document.getElementById("main");
const $sync = document.getElementById("sync-status");

let EXERCISES = [];
let BY_ID = new Map();
let items = loadItems();
let dirty = false;            // réponses pas encore poussées sur le Gist
let syncTimer = null;

// Session courante, persistée pour pouvoir reprendre après fermeture d'onglet.
let session = loadJSON("session");

// ---------- Utilitaires ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Mini Markdown : **gras**, *italique*, `code`. Échappe le HTML d'abord.
function md(s) {
  if (!s) return "";
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
}

const plural = (n, s = "s") => (n > 1 ? s : "");
const pct = (v) => (v === null ? "—" : `${v}%`);

function setSyncStatus(text, cls = "") {
  $sync.textContent = text;
  $sync.className = "sync-status " + cls;
}

// ---------- Synchro ----------

async function doSync() {
  if (!sync.enabled()) { setSyncStatus("local", "muted"); return; }
  setSyncStatus("⟳ synchro…", "muted");
  try {
    items = await syncNow(items);
    dirty = false;
    setSyncStatus("☁ synchronisé", "ok");
  } catch (e) {
    setSyncStatus("⚠ synchro : " + e.message, "err");
  }
}

function scheduleSync() {
  dirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(doSync, 4000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (dirty) { clearTimeout(syncTimer); pushOnExit(items); dirty = false; }
  } else if (!session || session.index >= session.queue.length) {
    // Retour sur la page : récupérer ce qu'a fait l'autre appareil.
    doSync().then(() => { if (location.hash === "" || location.hash === "#/") render(); });
  }
});

// ---------- Pages ----------

function renderHome() {
  const o = srs.overallStats(EXERCISES, items);
  const themes = srs.themesSummary(EXERCISES);
  const active = session && session.index < session.queue.length;
  $main.innerHTML = `
  <section class="hero">
    <h1>Merhaba 👋</h1>
    <p class="lede">
      ${o.due > 0
        ? `<strong>${o.due}</strong> exercice${plural(o.due)} à réviser aujourd'hui.`
        : "Rien à réviser aujourd'hui, bravo !"}
      ${o.new > 0 ? `(${o.new} ${o.new > 1 ? "nouveaux exercices disponibles" : "nouvel exercice disponible"})` : ""}
    </p>
    <div class="overall-stats">
      <div><span class="big">${o.total}</span><span class="label">exos total</span></div>
      <div><span class="big">${o.seen}</span><span class="label">déjà vus</span></div>
      <div><span class="big">${pct(o.successRate)}</span><span class="label">réussite</span></div>
    </div>
    <form class="start-form" id="start-form">
      <label for="theme">Thème</label>
      <select name="theme" id="theme">
        <option value="">Tous les thèmes</option>
        ${themes.map((t) => `<option value="${esc(t.slug)}">${esc(t.name)} (${t.n})</option>`).join("")}
      </select>
      <label for="size">Questions</label>
      <select name="size" id="size">
        ${[5, 10, 15, 20, 30, 50, 100].map((n) => `<option ${n === 20 ? "selected" : ""}>${n}</option>`).join("")}
      </select>
      <button class="btn-primary" type="submit">Démarrer une session</button>
    </form>
    ${active ? `<p class="resume"><a href="#/session">↪ Reprendre la session en cours (${session.index + 1}/${session.queue.length})</a></p>` : ""}
    ${!sync.enabled() ? `<p class="muted small">Progression enregistrée sur cet appareil uniquement. <a href="#/reglages">Activer la synchro</a></p>` : ""}
  </section>
  <section class="theme-list">
    <h2>Thèmes</h2>
    <ul>
      ${themes.map((t) => `
        <li>
          <strong>${esc(t.name)}</strong> <span class="muted">· ${t.n} exo${plural(t.n)}</span>
          <button class="btn-link" data-theme="${esc(t.slug)}">réviser ce thème →</button>
        </li>`).join("")}
    </ul>
  </section>`;

  document.getElementById("start-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    startSession(ev.target.theme.value || null, parseInt(ev.target.size.value, 10));
  });
  $main.querySelectorAll("[data-theme]").forEach((b) =>
    b.addEventListener("click", () => startSession(b.dataset.theme, 20)));
}

function startSession(themeFilter, size) {
  const queue = srs.buildSession(EXERCISES, items, { themeFilter, size });
  session = { queue: queue.map((e) => e.id), index: 0, stats: { correct: 0, close: 0, wrong: 0 }, feedback: null };
  saveJSON("session", session);
  if (location.hash === "#/session") render(); else location.hash = "#/session";
}

function saveSession() { saveJSON("session", session); }

function renderSession() {
  if (!session) { location.hash = "#/"; return; }
  // Sauter les exos qui n'existent plus (YAML modifié entre-temps).
  while (session.index < session.queue.length && !BY_ID.has(session.queue[session.index])) session.index++;
  $main.innerHTML = `<div class="card" id="card"></div>`;
  const card = document.getElementById("card");
  if (session.index >= session.queue.length) return renderEnd(card);
  if (session.feedback) return renderFeedback(card);
  renderQuestion(card);
}

const KEYBOARD = ["ç", "ş", "ğ", "ı", "İ", "ö", "ü", "â", "'"];

function renderQuestion(card) {
  const exo = BY_ID.get(session.queue[session.index]);
  card.innerHTML = `
    <div class="progress">
      <span>${session.index + 1} / ${session.queue.length}</span>
      <span class="theme-tag">${esc(exo.theme)}</span>
      <span class="type-tag type-${exo.type}">${exo.type}</span>
    </div>
    <div class="prompt">${md(exo.display_prompt)}</div>
    <form class="answer-form" id="answer-form">
      ${exo.type === "mcq"
        ? `<div class="choices">${exo.choices.map((c) => `
            <label class="choice"><input type="radio" name="answer" value="${esc(c)}" required><span>${esc(c)}</span></label>`).join("")}
           </div>`
        : `<input type="text" name="answer" id="answer" autocomplete="off" autocapitalize="off"
                  autocorrect="off" spellcheck="false" placeholder="Ta réponse…" required>
           <div class="tr-keyboard">${KEYBOARD.map((k) => `<button type="button" data-char="${esc(k)}">${esc(k)}</button>`).join("")}</div>`}
      <div class="actions">
        <button type="submit" class="btn-primary">Valider</button>
        ${exo.hint ? `<button type="button" class="btn-link" id="hint-btn">💡 Indice</button>` : ""}
        <button type="button" class="btn-link" id="skip-btn">Passer →</button>
      </div>
      ${exo.hint ? `<p id="hint" class="hint hidden">${esc(exo.hint)}</p>` : ""}
    </form>`;

  const input = card.querySelector("#answer");
  if (input && window.matchMedia("(pointer: fine)").matches) input.focus();

  card.querySelectorAll(".tr-keyboard button").forEach((btn) =>
    btn.addEventListener("click", () => {
      const ch = btn.dataset.char;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + ch + input.value.slice(end);
      input.focus();
      try { input.setSelectionRange(start + ch.length, start + ch.length); } catch {}
    }));
  card.querySelector("#hint-btn")?.addEventListener("click", () =>
    card.querySelector("#hint").classList.toggle("hidden"));
  card.querySelector("#skip-btn").addEventListener("click", () => {
    // Passer = compté comme erreur, sans écran de correction.
    srs.recordAnswer(items, exo, false);
    saveItems(items);
    session.stats.wrong++;
    session.index++;
    saveSession();
    scheduleSync();
    renderSession();
  });
  card.querySelector("#answer-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const answer = new FormData(ev.target).get("answer") || "";
    const mode = exo.type === "translation" ? "translation" : "default";
    const [status, message] = compare(answer, exo.answer, exo.alternatives, mode);
    const info = srs.recordAnswer(items, exo, status === "correct");
    saveItems(items);
    session.stats[status]++;
    session.feedback = { answer, status, message, ...info };
    saveSession();
    scheduleSync();
    renderSession();
  });
}

function renderFeedback(card) {
  const exo = BY_ID.get(session.queue[session.index]);
  const f = session.feedback;
  const title = { correct: "✅ Correct !", close: "🟡 Presque !", wrong: "❌ Pas tout à fait." }[f.status];
  card.innerHTML = `
    <div class="feedback feedback-${f.status}">
      <h2>${title}</h2>
      ${f.status === "close" ? `<p class="msg">${esc(f.message)}</p>` : ""}
      <div class="answers">
        <p><strong>Ta réponse :</strong> <span class="user-ans">${esc(f.answer || "(vide)")}</span></p>
        <p><strong>Réponse attendue :</strong> <span class="expected">${esc(exo.answer)}</span></p>
        ${exo.alternatives.length ? `<p class="muted small">Aussi accepté : ${esc(exo.alternatives.join(" / "))}</p>` : ""}
      </div>
      ${exo.explanation ? `<p class="explanation">${md(exo.explanation)}</p>` : ""}
      ${exo.reference ? `<p class="reference muted small">Réf : <code>${esc(exo.reference)}</code></p>` : ""}
      <p class="srs-info muted small">Boîte Leitner :
        ${f.oldBox !== f.newBox ? `${f.oldBox} → <strong>${f.newBox}</strong>` : `<strong>${f.newBox}</strong>`}
        · prochaine échéance : ${f.dueDate}</p>
      <div class="actions"><button type="button" class="btn-primary" id="next-btn">Suivant →</button></div>
    </div>`;
  const next = card.querySelector("#next-btn");
  next.focus();
  next.addEventListener("click", () => {
    session.feedback = null;
    session.index++;
    saveSession();
    renderSession();
  });
}

function renderEnd(card) {
  const s = session.stats;
  const total = s.correct + s.close + s.wrong;
  card.innerHTML = `
    <div class="end-session">
      <h2>🎉 Session terminée</h2>
      <p class="lede">${total > 0
        ? `${s.correct} / ${total} corrects ${s.close ? `(${s.close} presque)` : ""} ${s.wrong ? `· ${s.wrong} à retravailler` : ""}`
        : "Aucun exercice à réviser."}</p>
      <div class="overall-stats">
        <div class="status-correct"><span class="big">${s.correct}</span><span class="label">corrects</span></div>
        <div class="status-close"><span class="big">${s.close}</span><span class="label">presque</span></div>
        <div class="status-wrong"><span class="big">${s.wrong}</span><span class="label">faux</span></div>
      </div>
      <div class="actions center">
        <a href="#/" class="btn-primary">Accueil</a>
        <a href="#/stats" class="btn-link">Voir les stats</a>
      </div>
    </div>`;
  if (dirty) { clearTimeout(syncTimer); doSync(); }
}

function renderStats() {
  const o = srs.overallStats(EXERCISES, items);
  const themes = srs.statsByTheme(EXERCISES, items);
  $main.innerHTML = `
  <section>
    <h1>Statistiques</h1>
    <div class="overall-stats">
      <div><span class="big">${o.total}</span><span class="label">exos total</span></div>
      <div><span class="big">${o.seen}</span><span class="label">vus</span></div>
      <div><span class="big">${o.due}</span><span class="label">à revoir</span></div>
      <div><span class="big">${pct(o.successRate)}</span><span class="label">réussite</span></div>
      <div><span class="big">${o.totalAttempts}</span><span class="label">tentatives</span></div>
    </div>
    <h2>Par thème</h2>
    <div class="table-wrap">
      <table class="stats-table">
        <thead><tr><th>Thème</th><th>Total</th><th>Vus</th><th>Réussite</th><th>Boîtes Leitner</th></tr></thead>
        <tbody>${themes.map((t) => `
          <tr>
            <td>${esc(t.name)}</td><td>${t.total}</td><td>${t.seen}</td><td>${pct(t.successRate)}</td>
            <td><span class="boxes">${t.boxes.map((n, i) => `<span class="box box-${i + 1}" title="Boîte ${i + 1}">${n}</span>`).join("")}</span></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderSettings() {
  const last = sync.lastSync ? new Date(sync.lastSync).toLocaleString("fr-FR") : "jamais";
  $main.innerHTML = `
  <section class="hero">
    <h1>Réglages</h1>
    <h2>Synchro entre appareils</h2>
    <p class="muted">La progression est stockée dans un Gist GitHub privé. Colle un token GitHub
      (classic, <strong>uniquement le scope <code>gist</code></strong>) sur chaque appareil, une seule fois.</p>
    <form id="token-form" class="stack">
      <input type="password" id="token" placeholder="ghp_…" autocomplete="off" value="${esc(sync.token || "")}">
      <div class="actions">
        <button class="btn-primary" type="submit">Enregistrer et synchroniser</button>
        ${sync.enabled() ? `<button class="btn-link" type="button" id="token-clear">Désactiver</button>` : ""}
      </div>
    </form>
    <p class="muted small">Dernière synchro : ${esc(last)}${sync.gistId ? ` · gist <code>${esc(sync.gistId.slice(0, 8))}…</code>` : ""}</p>

    <h2>Sauvegarde</h2>
    <p class="muted">Importer fusionne le fichier avec la progression actuelle (l'exo vu le plus récemment gagne).</p>
    <div class="actions">
      <button class="btn-link" type="button" id="export-btn">⬇ Exporter la progression</button>
      <label class="btn-link file-label">⬆ Importer un fichier
        <input type="file" id="import-file" accept=".json,application/json" hidden>
      </label>
    </div>
    <p id="settings-msg" class="muted small"></p>
  </section>`;

  const msg = document.getElementById("settings-msg");
  document.getElementById("token-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    sync.token = document.getElementById("token").value.trim();
    await doSync();
    renderSettings();
  });
  document.getElementById("token-clear")?.addEventListener("click", () => {
    sync.token = null;
    setSyncStatus("local", "muted");
    renderSettings();
  });
  document.getElementById("export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: 1, items }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `turc-progression-${srs.isoDate()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("import-file").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = data.items || {};
      items = mergeItems(items, incoming);
      saveItems(items);
      msg.textContent = `✅ ${Object.keys(incoming).length} exercices importés.`;
      dirty = true;
      await doSync();
    } catch (e) {
      msg.textContent = "⚠ Fichier illisible : " + e.message;
    }
  });
}

// ---------- Routeur ----------

function render() {
  const route = location.hash.replace(/^#\/?/, "");
  document.querySelectorAll(".topbar nav a").forEach((a) =>
    a.classList.toggle("active", a.getAttribute("href") === "#/" + route));
  if (route === "session") return renderSession();
  if (route === "stats") return renderStats();
  if (route === "reglages") return renderSettings();
  renderHome();
}

window.addEventListener("hashchange", render);

// Entrée : Valider / Suivant au clavier (le submit natif gère déjà les inputs).
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" || location.hash !== "#/session") return;
  const next = document.getElementById("next-btn");
  if (next && document.activeElement !== next) { ev.preventDefault(); next.click(); }
});

async function init() {
  try {
    const res = await fetch("exercises.json", { cache: "no-cache" });
    EXERCISES = await res.json();
  } catch {
    $main.innerHTML = `<p class="err">Impossible de charger les exercices (hors ligne ?).</p>`;
    return;
  }
  BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));
  render();
  await doSync();
  if (!location.hash.startsWith("#/session")) render();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
