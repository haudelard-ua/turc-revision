// Logique SRS façon Leitner (5 boîtes). Port de review/srs.py.
// Boîte 1 → revoir tous les jours. Boîte 5 → tous les 16 jours.
// Réponse correcte → boîte +1. Réponse fausse → retour boîte 1.

export const BOX_INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
export const MAX_BOX = 5;
export const NEW_PER_SESSION = 5;

const pad = (n) => String(n).padStart(2, "0");

// Date locale (pas toISOString, qui passe en UTC et décale le jour le soir).
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoDateTime(d = new Date()) {
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dueIds(items, today) {
  return new Set(Object.entries(items).filter(([, s]) => s.due_date <= today).map(([id]) => id));
}

// Compose une session : exos en retard + nouveaux, mélangés.
export function buildSession(exercises, items, { themeFilter = null, size = 20 } = {}) {
  const pool = exercises.filter((e) => !themeFilter || e.theme_slug === themeFilter);
  if (!pool.length) return [];

  const due = dueIds(items, isoDate());
  const dueExos = shuffle(pool.filter((e) => due.has(e.id)));
  const newExos = shuffle(pool.filter((e) => !(e.id in items)));

  // Jusqu'à NEW_PER_SESSION slots pour des nouveaux, le reste pour les exos en
  // retard ; si l'un manque, on comble avec l'autre.
  const nNew = Math.min(NEW_PER_SESSION, newExos.length, size);
  const nDue = size - nNew;

  const session = dueExos.slice(0, nDue);
  const shortDue = nDue - session.length;
  session.push(...newExos.slice(0, nNew + shortDue));

  if (session.length < size) {
    const extras = dueExos.filter((e) => !session.includes(e));
    session.push(...extras.slice(0, size - session.length));
  }
  return shuffle(session);
}

// Met à jour l'état Leitner de l'exo (mutation de items) et retourne l'info SRS.
export function recordAnswer(items, exo, correct) {
  const cur = items[exo.id];
  const oldBox = cur ? cur.box : 1;
  const newBox = correct ? Math.min(oldBox + 1, MAX_BOX) : 1;
  const dueDate = addDays(BOX_INTERVALS[newBox]);
  items[exo.id] = {
    theme: exo.theme_slug,
    box: newBox,
    due_date: dueDate,
    last_seen_at: isoDateTime(),
    correct_count: (cur?.correct_count || 0) + (correct ? 1 : 0),
    wrong_count: (cur?.wrong_count || 0) + (correct ? 0 : 1),
  };
  return { oldBox, newBox, dueDate };
}

const rate = (c, w) => (c + w ? Math.round((100 * c) / (c + w)) : null);

export function statsByTheme(exercises, items) {
  const bySlug = new Map();
  for (const e of exercises) {
    if (!bySlug.has(e.theme_slug)) {
      bySlug.set(e.theme_slug, {
        slug: e.theme_slug, name: e.theme, total: 0, seen: 0,
        correct: 0, wrong: 0, boxes: [0, 0, 0, 0, 0],
      });
    }
    const d = bySlug.get(e.theme_slug);
    d.total++;
    const s = items[e.id];
    if (!s) continue;
    d.seen++;
    d.correct += s.correct_count;
    d.wrong += s.wrong_count;
    if (s.box >= 1 && s.box <= MAX_BOX) d.boxes[s.box - 1]++;
  }
  return [...bySlug.values()]
    .map((d) => ({ ...d, successRate: rate(d.correct, d.wrong) }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export function overallStats(exercises, items) {
  const known = exercises.filter((e) => e.id in items);
  const due = dueIds(items, isoDate());
  let correct = 0, wrong = 0;
  for (const e of known) {
    correct += items[e.id].correct_count;
    wrong += items[e.id].wrong_count;
  }
  return {
    total: exercises.length,
    seen: known.length,
    new: exercises.length - known.length,
    due: exercises.filter((e) => due.has(e.id)).length,
    successRate: rate(correct, wrong),
    totalAttempts: correct + wrong,
  };
}

export function themesSummary(exercises) {
  const m = new Map();
  for (const e of exercises) {
    const t = m.get(e.theme_slug) || { slug: e.theme_slug, name: e.theme, n: 0 };
    t.n++;
    m.set(e.theme_slug, t);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
