/**
 * Analyse d'une anomalie par Claude, en ligne de commande (`claude -p`).
 *
 * Appele SEULEMENT quand un controle releve une anomalie nouvelle : tant que
 * tout est vert, Claude n'est jamais sollicite. Il tourne en lecture seule
 * (outils limites a la lecture de fichiers et du web), dans le dossier du
 * projet concerne pour pouvoir lire son code, avec l'abonnement de la session
 * Claude Code de l'utilisateur.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUTILS_LECTURE = "Read,Grep,Glob,WebFetch";
const DELAI_MS = 10 * 60 * 1000;

/** Chemin de la commande claude, ou null si Claude Code n'est pas installe. */
export function trouverClaude() {
  const candidats = [
    path.join(os.homedir(), ".local", "bin", "claude.exe"),
    path.join(process.env.APPDATA ?? "", "npm", "claude.cmd"),
  ];
  try {
    const trouves = execFileSync("where", ["claude"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .filter(Boolean);
    candidats.unshift(...trouves);
  } catch {
    // pas dans le PATH
  }
  return candidats.find((c) => c && existsSync(c)) ?? null;
}

/** La consigne envoyee a Claude : le rapport du script, le detail, et le format attendu. */
export function consigne({ controle, rapport, detail }) {
  return `Réponds en français.

Tu es appelé automatiquement par SiteDashboard : le contrôle « ${controle.titre} » du site ${controle.site} (exécuté par un script, sans IA) a relevé au moins une anomalie. Ton rôle est de l'ANALYSER, pas de la corriger : cause probable, gravité réelle, et ce que je dois faire.

Contraintes : lecture seule. N'écris, ne modifie et ne supprime aucun fichier, ne lance aucune commande qui change quoi que ce soit, ne pousse rien. Tu es dans le dossier du projet (${controle.projet}) : lis le code ou les journaux si ça aide à trouver la cause. Tu peux vérifier une URL publique du site avec WebFetch.

Rapport du script :
${JSON.stringify({ statut: rapport.statut, resume: rapport.resume, points: rapport.points }, null, 2)}

Détail des mesures :
${detail}

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, de la forme :
{"statut":"ok|attention|echec","resume":"<une phrase>","points":[{"niveau":"ok|attention|echec","texte":"<ligne courte>"}],"analyse":"<3 à 8 lignes : cause probable, gravité, action à faire de ma part>"}
- statut : ta propre évaluation. "ok" si l'anomalie est un faux positif ou sans conséquence ; "echec" seulement si le site ou une fonction clé est réellement en panne.
- points : 2 à 6 lignes, les anomalies d'abord, avec ton diagnostic en quelques mots.`;
}

/** Premier objet JSON complet trouve dans un texte, ou null. */
export function extraireJson(texte) {
  const debut = texte.indexOf("{");
  if (debut === -1) return null;
  let profondeur = 0;
  let dansChaine = false;
  for (let i = debut; i < texte.length; i += 1) {
    const c = texte[i];
    if (dansChaine) {
      if (c === "\\") i += 1;
      else if (c === '"') dansChaine = false;
    } else if (c === '"') dansChaine = true;
    else if (c === "{") profondeur += 1;
    else if (c === "}" && --profondeur === 0) {
      try {
        return JSON.parse(texte.slice(debut, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const NIVEAUX = new Set(["ok", "attention", "echec"]);

/** Valide la reponse de Claude ; null si elle ne respecte pas le format. */
export function validerAnalyse(objet) {
  if (!objet || !NIVEAUX.has(objet.statut) || typeof objet.resume !== "string") return null;
  const points = (Array.isArray(objet.points) ? objet.points : [])
    .filter((p) => p && NIVEAUX.has(p.niveau) && typeof p.texte === "string" && p.texte.trim())
    .slice(0, 6);
  return {
    statut: objet.statut,
    resume: objet.resume.trim(),
    points,
    analyse: typeof objet.analyse === "string" ? objet.analyse.trim() : "",
  };
}

/**
 * Lance l'analyse. Renvoie { analyse } ou { erreur }. La consigne passe par
 * l'entree standard : en argument, elle depasserait la limite de longueur d'une
 * ligne de commande Windows.
 */
export function analyser({ controle, rapport, detail }) {
  const claude = trouverClaude();
  if (!claude) return Promise.resolve({ erreur: "commande claude introuvable (Claude Code non installé)" });

  return new Promise((resolve) => {
    const processus = spawn(
      claude,
      ["-p", "--output-format", "text", "--allowedTools", OUTILS_LECTURE, "--max-turns", "20"],
      { cwd: controle.projet, shell: claude.endsWith(".cmd"), windowsHide: true },
    );
    let sortie = "";
    let erreurs = "";
    const minuterie = setTimeout(() => {
      processus.kill();
      resolve({ erreur: "analyse trop longue (plus de 10 min), interrompue" });
    }, DELAI_MS);
    processus.stdout.on("data", (d) => (sortie += d));
    processus.stderr.on("data", (d) => (erreurs += d));
    processus.on("error", (e) => {
      clearTimeout(minuterie);
      resolve({ erreur: `lancement impossible : ${e.message}` });
    });
    processus.on("close", (code) => {
      clearTimeout(minuterie);
      const analyse = validerAnalyse(extraireJson(sortie));
      if (analyse) resolve({ analyse });
      else resolve({ erreur: `reponse inexploitable (code ${code}) : ${(erreurs || sortie).trim().slice(0, 300)}` });
    });
    processus.stdin.end(consigne({ controle, rapport, detail }));
  });
}
