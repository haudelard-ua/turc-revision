# Turc — Révision (version web)

Version statique de la webapp de révision du turc (SRS Leitner, 5 boîtes), servie par GitHub Pages.

- `exercises.json` est **généré** depuis le corpus privé (`exercices/*.yaml`) par `scripts/publish_site.sh` : ne pas l'éditer à la main.
- La progression est enregistrée dans le navigateur et synchronisée entre appareils via un Gist GitHub privé (réglages ⚙, token classic avec le seul scope `gist`).
- La logique (`js/normalize.js`, `js/srs.js`) reprend fidèlement celle de la webapp Python.
