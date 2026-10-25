/**
 * Lance un controle : `node controles/lancer.mjs <id> [--sans-claude] [--essai]`
 * (--essai affiche le rapport et le journal sans rien ecrire).
 *
 * 1. execute le script du controle (controles/<script>, voir registre.json) ;
 * 2. tout est vert : rapport « ok », Claude n'est pas contacte ;
 * 3. une anomalie NOUVELLE : Claude l'analyse (lecture seule) et son diagnostic
 *    remplace le resume du rapport ; une anomalie deja analysee reprend
 *    l'analyse precedente sans rappeler Claude ;
 * 4. ecrit le rapport (meme format que les agents) et une section de journal.
 *
 * Derniere ligne de la sortie : un resume JSON, lu par SiteDashboard.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { analyser } from "./lib/claude.mjs";
import {
  ecrireEtat,
  ecrireRapport,
  empreinte,
  isoLocal,
  jourFr,
  jourLocal,
  journaliser,
  lireEtat,
  pointsDuRapport,
  statutGlobal,
} from "./lib/commun.mjs";

const DOSSIER = import.meta.dirname;
const LIBELLES = { ok: "OK", attention: "à regarder", echec: "en échec" };

export function chargerRegistre() {
  return JSON.parse(readFileSync(path.join(DOSSIER, "registre.json"), "utf8"));
}

/** Fusionne l'analyse de Claude dans le rapport du script. */
export function avecAnalyse(rapport, analyse, { reprise = null } = {}) {
  return {
    ...rapport,
    statut: analyse.statut,
    resume: reprise ? `${analyse.resume} (analyse du ${reprise})` : analyse.resume,
    points: analyse.points.length ? analyse.points : rapport.points,
    source: "script+claude",
  };
}

export async function lancer(id, { claude = true, ecrire = true } = {}) {
  const controle = chargerRegistre().find((c) => c.id === id);
  if (!controle) throw new Error(`controle inconnu : ${id}`);

  const debut = new Date();
  const etat = lireEtat(id);
  let resultat;
  try {
    const module = await import(pathToFileURL(path.join(DOSSIER, controle.script)).href);
    // essai : le controle ne doit rien changer (pas de soumission Bing, par exemple)
    resultat = await module.executer(controle, { etat, essai: !ecrire });
  } catch (e) {
    resultat = {
      points: [{ niveau: "echec", texte: `Contrôle impossible : ${e.message}` }],
      resume: `Le contrôle n'a pas pu se dérouler : ${e.message}`,
      sectionJournal: `Erreur : \`${e.stack ?? e.message}\``,
      detail: String(e.stack ?? e.message),
      nouvelEtat: etat,
    };
  }

  const statut = statutGlobal(resultat.points);
  let rapport = {
    site: controle.site,
    agent: controle.id,
    titre: controle.titre,
    date: jourLocal(debut),
    debut: isoLocal(debut),
    fin: null,
    statut,
    resume: resultat.resume,
    points: pointsDuRapport(resultat.points),
    fichier: controle.fichierSuivi,
    source: "script",
  };

  const nouvelEtat = { ...resultat.nouvelEtat, derniereAnalyse: etat.derniereAnalyse ?? null };
  let claudeEtat = "non";
  let analyseTexte = "";
  // Un point marque sansAnalyse porte deja son action (« crée la clé... ») : inutile d'appeler Claude
  const aAnalyser = resultat.points.filter((p) => p.niveau !== "ok" && !p.sansAnalyse);
  if (aAnalyser.length && claude) {
    const signature = empreinte(resultat.points);
    const precedente = etat.derniereAnalyse;
    if (precedente?.empreinte === signature) {
      rapport = avecAnalyse(rapport, precedente.analyse, { reprise: precedente.jour });
      analyseTexte = precedente.analyse.analyse;
      claudeEtat = "reprise";
    } else {
      const { analyse, erreur } = await analyser({ controle, rapport, detail: resultat.detail ?? "" });
      if (analyse) {
        rapport = avecAnalyse(rapport, analyse);
        analyseTexte = analyse.analyse;
        nouvelEtat.derniereAnalyse = { empreinte: signature, jour: jourFr(debut), analyse };
        claudeEtat = "appele";
      } else {
        rapport.points = pointsDuRapport([...rapport.points, { niveau: "attention", texte: `Analyse Claude non faite : ${erreur}` }]);
        claudeEtat = "erreur";
      }
    }
  } else if (statut === "ok") {
    // Retour au vert : une prochaine anomalie, meme identique, sera reanalysee
    nouvelEtat.derniereAnalyse = null;
  }

  rapport.fin = isoLocal(new Date());
  if (!ecrire) {
    // --essai : on montre tout, on n'ecrit rien (ni rapport, ni journal, ni etat)
    console.log(JSON.stringify(rapport, null, 2));
    console.log(resultat.sectionJournal);
    return { id, statut: rapport.statut, rapport: null, claude: claudeEtat };
  }
  const chemin = ecrireRapport(rapport);
  ecrireEtat(id, nouvelEtat);

  if (controle.fichierSuivi?.endsWith(".md")) {
    const section = [
      `## ${jourFr(debut)} — ${LIBELLES[rapport.statut]} (contrôle automatique)`,
      "",
      rapport.resume,
      "",
      resultat.sectionJournal ?? "",
      analyseTexte ? `\n**Analyse Claude** :\n\n${analyseTexte}` : "",
    ].join("\n");
    journaliser(controle.fichierSuivi, `${controle.titre} — ${controle.site}`, section);
  }

  return { id, statut: rapport.statut, rapport: chemin, claude: claudeEtat };
}

// Lance en ligne de commande, sauf importe (tests)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [id] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  lancer(id, {
    claude: !process.argv.includes("--sans-claude"),
    ecrire: !process.argv.includes("--essai"),
  })
    .then((resume) => console.log(JSON.stringify(resume)))
    .catch((e) => {
      console.log(JSON.stringify({ id, statut: "echec", erreur: e.message }));
      process.exit(1);
    });
}
