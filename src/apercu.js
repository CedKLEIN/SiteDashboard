/**
 * Mode apercu : l'interface tourne dans un navigateur ordinaire, sans Tauri.
 *
 * Sert a voir et a capturer les ecrans (`npm.cmd run apercu`, puis
 * `npm.cmd run captures`). Chaque appel a Rust est intercepte : le SQL tourne
 * sur une COPIE de la base chargee dans sql.js, les autres commandes renvoient
 * des donnees preparees par scripts/preparer-apercu.mjs ou des reponses de
 * demonstration. Rien ne touche la vraie base. Jamais charge par l'appli
 * installee : main.jsx ne l'importe qu'en dev, hors de Tauri.
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import initSqlJs from "sql.js";

/** `$1, $2...` (syntaxe du plugin) -> parametres nommes de sql.js. */
function parametres(valeurs = []) {
  const nommes = {};
  valeurs.forEach((v, i) => {
    nommes[`$${i + 1}`] = v === undefined ? null : typeof v === "boolean" ? Number(v) : v;
  });
  return nommes;
}

function selectionner(base, requete, valeurs) {
  const instruction = base.prepare(requete);
  instruction.bind(parametres(valeurs));
  const lignes = [];
  while (instruction.step()) lignes.push(instruction.getAsObject());
  instruction.free();
  return lignes;
}

function executer(base, requete, valeurs) {
  base.run(requete, parametres(valeurs));
  const [{ values }] = base.exec("SELECT last_insert_rowid()");
  return [base.getRowsModified(), values[0][0]];
}

/**
 * Pannes simulees, pour voir les ecrans d'alerte : un tableau JSON de bouts
 * d'URL dans localStorage['apercu:pannes'] (checks en 503) ou
 * ['apercu:certificats'] (certificats a 9 jours), par ex. ["site.fr/healthz"].
 */
function enPanne(url, cle = "apercu:pannes") {
  try {
    return JSON.parse(localStorage.getItem(cle) ?? "[]").some((bout) => String(url).includes(bout));
  } catch {
    return false;
  }
}

/** Reponses de demonstration des commandes reseau : tout va bien, sans rien appeler. */
const RESEAU = {
  executer_check: ({ url }) =>
    enPanne(url)
      ? { statut: 503, latence_ms: 90, entetes: [], taille: 0, occurrences: 0 }
      : { statut: 200, latence_ms: 120 + Math.round(Math.random() * 80), entetes: [], taille: 50_000, occurrences: 50_000 },
  executer_redirection: () => ({ statut: 301, cible: "https://denivio.fr/", latence_ms: 90 }),
  lire_valeur: () => ({ valeur: "2026-10-17T16:07:23Z", statut: 200, latence_ms: 80 }),
  verifier_certificat: ({ domaine, url }) =>
    enPanne(domaine ?? url, "apercu:certificats")
      ? { jours_restants: 9, expire_le: "2026-11-05", emetteur: "Let's Encrypt" }
      : { jours_restants: 64, expire_le: "2026-12-30", emetteur: "Let's Encrypt" },
  verifier_domaine: () => ({ adresses: ["82.165.10.4"], jours_restants: 300, latence_ms: 60 }),
  inspecter_url: ({ url }) => ({ url_demandee: url, methode: "GET", statut: 200, statut_texte: "OK", duree_ms: 140 }),
  taux_change: () => 1,
  recuperer_favicon: () => null,
};

export async function installerApercu() {
  const [SQL, base, agents] = await Promise.all([
    initSqlJs({ locateFile: () => "/apercu/sql-wasm.wasm" }),
    fetch("/apercu/base.db").then((r) => {
      if (!r.ok) throw new Error(".apercu/base.db absent : lance npm.cmd run apercu");
      return r.arrayBuffer();
    }),
    fetch("/apercu/agents.json").then((r) => (r.ok ? r.json() : null)),
  ]);
  const db = new SQL.Database(new Uint8Array(base));
  // Une sauvegarde peut porter un index abime (voir verifierEtReparer) : la copie
  // en memoire est reconstruite, la sauvegarde elle-meme n'est pas touchee.
  db.run("REINDEX");

  // Cles des connecteurs : en memoire seulement, le temps de la session d'apercu
  const secrets = new Map();
  mockIPC((commande, args = {}) => {
    switch (commande) {
      case "plugin:sql|load":
        return args.db;
      case "plugin:sql|select":
        return selectionner(db, args.query, args.values);
      case "plugin:sql|execute":
        return executer(db, args.query, args.values);
      case "plugin:sql|close":
        return true;
      case "chemin_base":
        return "C:\\Users\\...\\com.cedklein.sitedashboard\\sitedashboard.db (copie, apercu)";
      case "tracer":
        console.info(`[${args.niveau}] ${args.message}`);
        return null;
      case "lire_rapports_agents":
        return agents?.rapports ?? { dossier: "", existe: false, fichiers: [] };
      case "lire_taches_planifiees":
        return agents?.taches ?? { taches: [], config: null, config_chemin: null };
      case "etat_mise_a_jour":
        return { depot: "(apercu)", commit_installe: "apercu", commit_depot: "apercu", branche: "main", nouveaux: [], modifications_locales: 0 };
      case "dossier_sauvegardes":
        return "C:\\Users\\...\\Documents\\SiteDashboard\\sauvegardes";
      case "plugin:autostart|is_enabled":
        return false;
      case "registre_agents":
        if (args.action !== "liste") throw new Error("apercu : le registre n'est pas modifiable");
        return agents?.registre ?? { controles: [], modeles: [] };
      case "lancer_controle":
        return { code: 0, resume: { id: args.id, statut: "ok", claude: "non" }, erreurs: "" };
      case "notifications_windows":
        return true;
      case "diagnostic_mise_a_jour":
        return "=== Diagnostic SiteDashboard (apercu) ===";
      case "etat_barre":
        return null;
      case "secrets_connecteurs":
        return Object.fromEntries(secrets);
      case "enregistrer_secret_connecteur":
        if (args.secret == null) secrets.delete(args.id);
        else secrets.set(args.id, args.secret);
        return null;
      case "ant_etat":
        return { installe: false, version: null, connecte: false };
      case "ant_installer":
      case "ant_connexion":
      case "ant_jeton":
        throw new Error("apercu : pas de connexion Anthropic");
      case "appel_api":
        throw new Error("apercu : pas d'appel aux API des connecteurs");
      case "plugin:event|listen":
        return 1;
      case "plugin:event|unlisten":
        return null;
      case "plugin:notification|is_permission_granted":
        return false;
      case "plugin:notification|request_permission":
        return "denied";
      default:
        if (commande in RESEAU) return RESEAU[commande](args);
        if (commande.startsWith("plugin:opener|") || commande.startsWith("plugin:clipboard-manager|")) return null;
        throw new Error(`apercu : commande non simulee ${commande}`);
    }
  });
  document.title = "SiteDashboard (apercu)";
}
