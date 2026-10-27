/**
 * Lance un controle : `node controles/lancer.mjs <id> [--sans-claude] [--essai]`
 * (--essai affiche le rapport et le journal sans rien ecrire).
 *
 * 1. execute le script du controle (controles/<script>, voir lib/registre.mjs :
 *    un modele applique a la fiche d'un site) ;
 * 2. tout est vert : rapport « ok », Claude n'est pas contacte ;
 * 3. une anomalie NOUVELLE : Claude l'analyse (lecture seule) et son diagnostic
 *    remplace le resume du rapport ; une anomalie deja analysee reprend
 *    l'analyse precedente sans rappeler Claude ;
 * 4. ecrit le rapport (meme format que les agents) et une section de journal ;
 * 5. liste les taches que le controle demande de lancer ensuite (`suites` : la
 *    tache « Correctifs de dependances » apres un audit, par exemple).
 *
 * Derniere ligne de la sortie : un resume JSON, lu par SiteDashboard.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { lancerAgent } from "./lib/agent.mjs";
import { chargerRegistre } from "./lib/registre.mjs";
import { analyser } from "./lib/claude.mjs";
import {
  archiverRapport,
  cheminRapport,
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

/**
 * Taches qu'un controle demande de lancer ensuite (`resultat.suites` : modele et
 * signature de ce qui justifie la demande) : celles du meme site, sauf si elles
 * ont deja traite cette signature. SiteDashboard ne lance que les actives.
 */
export function suitesDemandees(controle, suites, registre, lireEtatDe = lireEtat) {
  return (suites ?? []).flatMap(({ modele, signature }) =>
    registre
      .filter((c) => c.modele === modele && c.siteCle === controle.siteCle && !c.erreur)
      .filter((c) => lireEtatDe(c.id).signatureTraitee !== signature)
      .map((c) => c.id),
  );
}

/**
 * Option `relancerApres` d'un modele : quand son passage a corrige quelque chose
 * (`resultat.corrige`), la tache qui l'avait demande (`declenchePar`, meme site)
 * repasse une fois pour le constater. Une seule fois : cette relance ne demande
 * pas de nouvelle relance, et le correctif ne repart pas pour une signature deja
 * traitee. Au-dela, c'est a la main.
 */
export function relanceApres(controle, resultat, registre) {
  if (!controle.parametres?.relancerApres || !resultat?.corrige || !controle.declenchePar) return [];
  return registre
    .filter((c) => c.modele === controle.declenchePar && c.siteCle === controle.siteCle && !c.erreur)
    .map((c) => c.id);
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
  const registre = chargerRegistre();
  const controle = registre.find((c) => c.id === id);
  if (!controle) throw new Error(`controle inconnu : ${id}`);
  // Relance le meme jour : le passage precedent reste dans l'historique
  if (ecrire) archiverRapport(cheminRapport(controle.site, id));
  // Modele ou fiche manquant : un rapport en echec le dit, plutot qu'un silence
  if (controle.erreur) {
    const debut = new Date();
    const message = `Tâche mal configurée : ${controle.erreur}`;
    if (!ecrire) return { id, statut: "echec", erreur: message };
    const rapport = ecrireRapport({
      site: controle.site,
      agent: id,
      titre: controle.titre,
      date: jourLocal(debut),
      debut: isoLocal(debut),
      fin: isoLocal(debut),
      statut: "echec",
      resume: message,
      points: [{ niveau: "echec", texte: controle.erreur }],
      fichier: null,
      source: "script",
      claude: "non",
    });
    return { id, statut: "echec", rapport, erreur: message };
  }
  // Agent Claude : une session complete, qui ecrit elle-meme son rapport
  if (controle.type === "claude") return lancerAgent(controle, { essai: !ecrire });

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
  // Ce que le passage a coute en Claude : non, appele, reprise (analyse reprise sans le rappeler), erreur
  rapport.claude = claudeEtat;
  const suites = [...new Set([...suitesDemandees(controle, resultat.suites, registre), ...relanceApres(controle, resultat, registre)])];
  if (!ecrire) {
    // --essai : on montre tout, on n'ecrit rien (ni rapport, ni journal, ni etat)
    console.log(JSON.stringify(rapport, null, 2));
    console.log(resultat.sectionJournal);
    return { id, statut: rapport.statut, rapport: null, claude: claudeEtat, suites };
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

  return { id, statut: rapport.statut, rapport: chemin, claude: claudeEtat, suites };
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
