/**
 * Agents Claude lances par SiteDashboard : une session `claude -p` par passage,
 * pour les taches qui demandent du jugement (indexation, SEO, idees).
 *
 * Remplacent les taches planifiees de l'appli Claude. La consigne vient d'un
 * modele generique (controles/modeles/*.md), rempli avec la fiche du site ; les
 * precisions propres a un agent vivent HORS du depot (public) :
 * %USERPROFILE%\.sitedashboard\agents\<id>.md.
 * La session ecrit elle-meme son rapport, comme avant ; si elle n'en ecrit pas
 * (connexion perdue, Chrome absent, plantage), SiteDashboard ecrit un rapport
 * en echec avec la fin de sa sortie : un agent muet doit se voir.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fermerChrome, preparerChrome } from "./chrome.mjs";
import { trouverClaude } from "./claude.mjs";
import { RACINE_RAPPORTS, cheminRapport, ecrireRapport, isoLocal, jourLocal } from "./commun.mjs";
import { DOSSIER_MODELES, rendre } from "./registre.mjs";

export const DOSSIER_AGENTS = path.join(os.homedir(), ".sitedashboard", "agents");
const DOSSIER_JOURNAUX = path.join(os.homedir(), ".sitedashboard", "journaux");

/** Ce que l'agent doit ecrire pour SiteDashboard : chemin et forme du rapport JSON. */
export function consigneRapport(controle) {
  const chemin = path.join(RACINE_RAPPORTS, controle.site, "<AAAA-MM-JJ>", `${controle.id}.json`);
  const squelette = JSON.stringify({
    site: controle.site,
    agent: controle.id,
    titre: controle.titre,
    date: "AAAA-MM-JJ",
    debut: "<ISO 8601 avec fuseau, début du run>",
    fin: "<ISO 8601, fin du run>",
    statut: "ok|attention|echec",
    resume: "<une phrase>",
    points: [{ niveau: "ok|attention|echec", texte: "<ligne courte>" }],
    fichier: controle.fichierSuivi,
  });
  return `écris en UTF-8 le fichier \`${chemin}\` (date locale du jour ; crée les dossiers ; écrase le fichier s'il existe : un rapport par jour). Contenu : un objet JSON ${squelette}. Vérifie ensuite que le fichier est un JSON valide : node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "<chemin>".`;
}

/**
 * Consigne complete d'un agent : le modele (controles/modeles/<consigne>.md)
 * rempli avec la fiche du site, puis les precisions propres a l'agent
 * (%USERPROFILE%\.sitedashboard\agents\<id>.md, facultatives).
 */
export function construireConsigne(controle, { modeles = DOSSIER_MODELES, agents = DOSSIER_AGENTS } = {}) {
  const fichierModele = path.join(modeles, controle.consigne ?? "");
  if (!controle.consigne || !existsSync(fichierModele)) return null;
  const contexte = {
    site: controle.fiche,
    agent: {
      ...controle,
      fichierSuiviNom: controle.fichierSuivi ? path.basename(controle.fichierSuivi) : "",
      dossierRapports: path.join(RACINE_RAPPORTS, controle.site),
      consigneRapport: consigneRapport(controle),
    },
  };
  const texte = rendre(readFileSync(fichierModele, "utf8"), contexte).trim();
  const fichierPrecisions = path.join(agents, `${controle.id}.md`);
  if (!existsSync(fichierPrecisions)) return texte;
  const precisions = readFileSync(fichierPrecisions, "utf8").trim();
  return `${texte}\n\nPrécisions propres à ce site et à cet agent (elles priment sur la consigne générale) :\n${precisions}`;
}

/** Ce que SiteDashboard ajoute devant la consigne : le contexte d'un passage sans surveillance. */
export function preambule(controle, maintenant = new Date()) {
  return `Session lancée automatiquement par SiteDashboard (tâche « ${controle.titre} », site ${controle.site}), le ${maintenant.toLocaleDateString("fr-FR")} à ${maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.
Personne n'est là pour répondre : agis seul, fais des choix raisonnables et note-les. Produis TOUJOURS le rapport JSON demandé dans la consigne, même si tu t'arrêtes en cours ou échoues.
${controle.chrome ? "Navigateur : utilise Chrome (outils mcp__claude-in-chrome__*), où mes connexions sont ouvertes. Travaille dans tes propres onglets et ferme-les tous avant de terminer ; ne touche pas aux miens. S'il n'est pas disponible, écris un rapport en échec qui le dit." : ""}

`;
}

/** Fin d'un texte, sur ses dernieres lignes non vides. */
export function fin(texte, lignes = 8) {
  return texte.trim().split(/\r?\n/).filter(Boolean).slice(-lignes).join(" / ").slice(0, 400);
}

function rapportEchec(controle, debut, message) {
  return ecrireRapport({
    site: controle.site,
    agent: controle.id,
    titre: controle.titre,
    date: jourLocal(debut),
    debut: isoLocal(debut),
    fin: isoLocal(new Date()),
    statut: "echec",
    resume: message,
    points: [{ niveau: "echec", texte: message }],
    fichier: controle.fichierSuivi,
    source: "agent-claude",
  });
}

/**
 * Une session `claude -p` : la consigne passe par l'entree standard (trop longue
 * pour une ligne de commande Windows), la sortie va au journal au fil de l'eau.
 * Interrompue apres `dureeMaxMin`. Renvoie { code, sortie }.
 */
export function sessionClaude({ claude, args, cwd, texte, journal, dureeMaxMin = 120 }) {
  return new Promise((resolve) => {
    const processus = spawn(claude, args, { cwd, shell: claude.endsWith(".cmd"), windowsHide: true });
    let tout = "";
    const garder = (d) => {
      tout += d;
      appendFileSync(journal, d);
    };
    const minuterie = setTimeout(() => {
      processus.kill();
      garder(`\n[SiteDashboard] session interrompue apres ${dureeMaxMin} min\n`);
    }, dureeMaxMin * 60_000);
    processus.stdout.on("data", garder);
    processus.stderr.on("data", garder);
    processus.on("error", (e) => {
      clearTimeout(minuterie);
      resolve({ code: -1, sortie: `${tout}\n${e.message}` });
    });
    processus.on("close", (c) => {
      clearTimeout(minuterie);
      resolve({ code: c, sortie: tout });
    });
    processus.stdin.end(texte);
  });
}

/** Journal du passage d'une tache : %USERPROFILE%\.sitedashboard\journaux\<id>-<jour>.log */
export function ouvrirJournal(id, debut) {
  mkdirSync(DOSSIER_JOURNAUX, { recursive: true });
  const journal = path.join(DOSSIER_JOURNAUX, `${id}-${jourLocal(debut)}.log`);
  writeFileSync(journal, `=== ${isoLocal(debut)} ${id}\n`, "utf8");
  return journal;
}

/** Lance la session et attend sa fin. Renvoie le resume pour SiteDashboard. */
export async function lancerAgent(controle, { essai = false } = {}) {
  const debut = new Date();
  const consigne = construireConsigne(controle);
  if (!consigne) {
    const message = `Consigne du modèle introuvable : ${path.join(DOSSIER_MODELES, controle.consigne ?? "(aucune)")}`;
    if (!essai) rapportEchec(controle, debut, message);
    return { id: controle.id, statut: "echec", claude: "session", erreur: message };
  }
  const claude = trouverClaude();
  if (!claude) {
    const message = "Agent non lancé : commande claude introuvable (Claude Code non installé)";
    if (!essai) rapportEchec(controle, debut, message);
    return { id: controle.id, statut: "echec", claude: "session", erreur: message };
  }
  const texte = preambule(controle, debut) + consigne;
  if (essai) {
    console.log(texte);
    return { id: controle.id, statut: "ok", claude: "session", essai: true };
  }

  const journal = ouvrirJournal(controle.id, debut);

  // Chrome ferme : SiteDashboard l'ouvre pour l'agent, et le referme apres
  const chrome = controle.chrome ? await preparerChrome() : { ouvertParNous: false };
  if (chrome.message) appendFileSync(journal, `[SiteDashboard] ${chrome.message}\n`);

  const args = ["-p", "--output-format", "text", "--permission-mode", "auto"];
  if (controle.chrome) args.push("--chrome");
  const { code, sortie } = await sessionClaude({
    claude,
    args,
    cwd: controle.projet,
    texte,
    journal,
    dureeMaxMin: controle.dureeMaxMin ?? 120,
  });
  if (chrome.ouvertParNous) {
    await fermerChrome();
    appendFileSync(journal, "\n[SiteDashboard] Chrome refermé\n");
  }

  // La session a-t-elle ecrit son rapport pendant ce passage ?
  const rapport = cheminRapport(controle.site, controle.id, debut);
  if (existsSync(rapport) && statSync(rapport).mtime >= debut) {
    try {
      const { statut } = JSON.parse(readFileSync(rapport, "utf8"));
      return { id: controle.id, statut, rapport, claude: "session", code };
    } catch {
      // rapport illisible : traite comme absent
    }
  }
  const message = `L'agent s'est arrêté sans écrire son rapport (code ${code}) : ${fin(sortie) || "aucune sortie"}`;
  return { id: controle.id, statut: "echec", rapport: rapportEchec(controle, debut, message), claude: "session", code };
}
