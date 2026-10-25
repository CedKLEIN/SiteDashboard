/**
 * Prepare les donnees du mode apercu (`npm.cmd run apercu`) dans .apercu/,
 * dossier ignore par git :
 *  - base.db      : la sauvegarde la plus recente de Documents\SiteDashboard\sauvegardes
 *  - sql-wasm.wasm: SQLite compile pour le navigateur (sql.js)
 *  - agents.json  : rapports d'agents des 30 derniers jours et taches planifiees
 *
 * L'apercu fait tourner l'interface dans un navigateur, sans Tauri, sur une
 * COPIE des donnees : rien de ce qui s'y fait ne touche la vraie base.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RACINE = path.resolve(import.meta.dirname, "..");
// Hors de public/ : Vite copierait ces donnees personnelles dans l'appli compilee.
// vite.config.js les sert sous /apercu/ en developpement seulement.
const SORTIE = path.join(RACINE, ".apercu");
const MAISON = os.homedir();
mkdirSync(SORTIE, { recursive: true });

function sousDossiers(dossier) {
  try {
    return readdirSync(dossier, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dossier, e.name))
      .sort();
  } catch {
    return [];
  }
}

// 1. Base : la sauvegarde la plus recente
const dossierSauvegardes = path.join(MAISON, "Documents", "SiteDashboard", "sauvegardes");
const sauvegardes = existsSync(dossierSauvegardes)
  ? readdirSync(dossierSauvegardes).filter((n) => /^sitedashboard-.*\.db$/.test(n)).sort()
  : [];
if (sauvegardes.length === 0) {
  console.error(`Aucune sauvegarde dans ${dossierSauvegardes} : fais-en une depuis l'appli (Preferences).`);
  process.exit(1);
}
const derniere = sauvegardes.at(-1);
copyFileSync(path.join(dossierSauvegardes, derniere), path.join(SORTIE, "base.db"));
copyFileSync(path.join(RACINE, "node_modules", "sql.js", "dist", "sql-wasm.wasm"), path.join(SORTIE, "sql-wasm.wasm"));

// 2. Rapports d'agents (meme forme que la commande Rust lire_rapports_agents)
const racineRapports = path.join(MAISON, ".claude", "rapports-agents");
const depuis = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const fichiers = [];
for (const site of sousDossiers(racineRapports)) {
  for (const jour of sousDossiers(site)) {
    if (path.basename(jour) < depuis) continue;
    for (const nom of readdirSync(jour).filter((n) => n.endsWith(".json"))) {
      const chemin = path.join(jour, nom);
      fichiers.push({ chemin, contenu: readFileSync(chemin, "utf8"), erreur: null });
    }
  }
}

// 3. Taches planifiees et config de Claude (meme forme que lire_taches_planifiees)
const dossierTaches = path.join(MAISON, ".claude", "scheduled-tasks");
const taches = sousDossiers(dossierTaches).map((d) => {
  const skill = path.join(d, "SKILL.md");
  return { id: path.basename(d), skill: existsSync(skill) ? readFileSync(skill, "utf8") : null };
});
let config = null;
const claudeData = path.join(process.env.LOCALAPPDATA ?? "", "Claude-Data");
let plusRecent = 0;
for (const profil of [claudeData, ...sousDossiers(claudeData)]) {
  for (const compte of sousDossiers(path.join(profil, "claude-code-sessions"))) {
    for (const org of sousDossiers(compte)) {
      const f = path.join(org, "scheduled-tasks.json");
      if (existsSync(f) && statSync(f).mtimeMs > plusRecent) {
        plusRecent = statSync(f).mtimeMs;
        config = readFileSync(f, "utf8");
      }
    }
  }
}

writeFileSync(
  path.join(SORTIE, "agents.json"),
  JSON.stringify({
    rapports: { dossier: racineRapports, existe: existsSync(racineRapports), fichiers },
    taches: { taches, config, config_chemin: config ? "(apercu)" : null },
  }),
);
console.log(`Apercu pret : base ${derniere}, ${fichiers.length} rapport(s), ${taches.length} tache(s).`);
