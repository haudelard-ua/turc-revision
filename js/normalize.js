// Comparaison tolérante des réponses (casse + i pointé turc), avec détection
// des erreurs uniquement diacritiques. Port fidèle de review/normalize.py.

const DIACRITICS = {
  "ç": "c", "Ç": "C",
  "ş": "s", "Ş": "S",
  "ğ": "g", "Ğ": "G",
  "ı": "i", "İ": "I",
  "ö": "o", "Ö": "O",
  "ü": "u", "Ü": "U",
  "â": "a", "Â": "A",
  "î": "i", "Î": "I",
  "û": "u", "Û": "U",
};

// Remplacer İ/I AVANT toLowerCase : JS transforme « İ » en « i̇ » (i + point combinant).
export function turkishLower(s) {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

export function normalize(s) {
  return turkishLower(s).replace(/\s+/g, " ").trim();
}

export function normalizeTranslation(s) {
  return normalize(s).replace(/[.!?…,;:]+$/u, "");
}

export function stripDiacritics(s) {
  return Array.from(s, (c) => DIACRITICS[c] ?? c).join("");
}

export function diffDiacritics(user, expected) {
  const u = Array.from(user);
  const e = Array.from(expected);
  const pairs = [];
  if (u.length !== e.length) return pairs;
  for (let i = 0; i < u.length; i++) {
    if (u[i] !== e[i] && stripDiacritics(u[i]).toLowerCase() === stripDiacritics(e[i]).toLowerCase()) {
      pairs.push(`${u[i]} → ${e[i]}`);
    }
  }
  return pairs;
}

// Retourne [status, message] avec status ∈ {"correct", "close", "wrong"}.
export function compare(user, expected, alternatives = [], mode = "default") {
  if (!user.trim()) return ["wrong", "Réponse vide."];

  const norm = mode === "translation" ? normalizeTranslation : normalize;
  const candidates = [expected, ...(alternatives || [])];

  const userN = norm(user);
  for (const c of candidates) {
    if (userN === norm(c)) return ["correct", ""];
  }

  const userNodi = stripDiacritics(userN);
  for (const c of candidates) {
    const cN = norm(c);
    if (userNodi === stripDiacritics(cN)) {
      const diffs = diffDiacritics(userN, cN);
      const msg = diffs.length
        ? "Presque ! Diacritiques à corriger : " + diffs.join(", ")
        : "Presque ! Vérifie les diacritiques.";
      return ["close", msg];
    }
  }
  return ["wrong", ""];
}
