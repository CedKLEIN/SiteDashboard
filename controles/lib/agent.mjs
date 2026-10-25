/**
 * Agents Claude lances par SiteDashboard : une session `claude -p` par passage,
 * pour les taches qui demandent du jugement (indexation, SEO, idees).
 *
 * Remplacent les taches planifiees de l'appli Claude. La consigne de chaque
 * agent vit HORS du depot (public) : %USERPROFILE%\.sitedashboard\agents\<id>.md.
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
import { cheminRapport, ecrireRapport, isoLocal, jourLocal } from "./commun.mjs";

export const DOSSIER_AGENTS = path.join(os.homedir(), ".sitedashboard", "agents");
const DOSSIER_JOURNAUX = path.join(os.homedir(), ".sitedashboard", "journaux");

/** Consigne d'un agent, sans l'en-tete YAML d'une ancienne tache planifiee. */
export function lireConsigne(id) {
  const fichier = path.join(DOSSIER_AGENTS, `${id}.md`);
  if (!existsSync(fichier)) return null;
  return readFileSync(fichier, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

/** Ce que SiteDashboard ajoute devant la consigne : le contexte d'un passage sans surveillance. */
export function preambule(controle, maintenant = new Date()) {
  return `Session lancée automatiquement par SiteDashboard (tâche « ${controle.titre} », site ${controle.site}), le ${maintenant.toLocaleDateString("fr-FR")} à ${maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.
Personne n'est là pour répondre : agis seul, fais des choix raisonnables et note-les. Produis TOUJOURS le rapport JSON demandé dans la consigne, même si tu t'arrêtes en cours ou échoues.
${controle.chrome ? "Navigateur : utilise Chrome (outils mcp__claude-in-chrome__*), où mes connexions sont ouvertes. Travaille dans tes propres onglets et ferme-les tous avant de terminer ; ne touche pas aux miens. S'il n'est pas disponible, écris un rapport en échec qui le dit." : ""}

`;
}

/** Fin d'un texte, sur ses dernieres lignes non vides. */
function fin(texte, lignes = 8) {
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

/** Lance la session et attend sa fin. Renvoie le resume pour SiteDashboard. */
export async function lancerAgent(controle, { essai = false } = {}) {
  const debut = new Date();
  const consigne = lireConsigne(controle.id);
  if (!consigne) {
    const message = `Consigne introuvable : ${path.join(DOSSIER_AGENTS, `${controle.id}.md`)}`;
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

  mkdirSync(DOSSIER_JOURNAUX, { recursive: true });
  const journal = path.join(DOSSIER_JOURNAUX, `${controle.id}-${jourLocal(debut)}.log`);
  writeFileSync(journal, `=== ${isoLocal(debut)} ${controle.id}\n`, "utf8");

  // Chrome ferme : SiteDashboard l'ouvre pour l'agent, et le referme apres
  const chrome = controle.chrome ? await preparerChrome() : { ouvertParNous: false };
  if (chrome.message) appendFileSync(journal, `[SiteDashboard] ${chrome.message}\n`);

  const args = ["-p", "--output-format", "text", "--permission-mode", "auto"];
  if (controle.chrome) args.push("--chrome");
  const { code, sortie } = await new Promise((resolve) => {
    const processus = spawn(claude, args, { cwd: controle.projet, shell: claude.endsWith(".cmd"), windowsHide: true });
    let tout = "";
    const garder = (d) => {
      tout += d;
      appendFileSync(journal, d);
    };
    const minuterie = setTimeout(() => {
      processus.kill();
      garder(`\n[SiteDashboard] session interrompue apres ${controle.dureeMaxMin} min\n`);
    }, (controle.dureeMaxMin ?? 120) * 60_000);
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
