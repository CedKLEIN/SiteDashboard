/**
 * Correctifs de dependances : `npm audit fix` sur une branche a part, puis les
 * verifications du projet (tests, lint, build). Sans IA quand tout passe.
 *
 * Si ca ne marche pas (`npm audit fix` en echec ou sans effet, ou une
 * verification qui echoue apres), une session Claude recoit l'erreur : elle
 * applique les mises a jour ou adapte le code. SiteDashboard relance ensuite
 * LUI-MEME les verifications et `npm audit` avant de commiter (on ne croit pas
 * la session sur parole). Sinon, tout est annule : branche supprimee, depot
 * revenu a son etat de depart.
 *
 * Garde-fous : rien n'est fait sur un depot qui a du travail en cours ; pas de
 * --force (une version majeure se fait a la main) ; commit LOCAL seulement, sur
 * la branche `correctifs/<jour>` : rien n'est pousse ni deploye. Avec le
 * parametre `fusionner`, cette branche est fusionnee en local dans la branche
 * de depart une fois les verifications passees ; `relancerApres` fait alors
 * repasser l'audit une fois (voir lancer.mjs, relanceApres).
 *
 * Sans horaire : lancee a la main, ou a la demande de l'audit hebdomadaire
 * (voir lancer.mjs, `suites`). La fiche du site donne `correctifs.dossier` et
 * `correctifs.verifications` (les commandes, dans l'ordre).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fin, ouvrirJournal, sessionClaude } from "./lib/agent.mjs";
import { trouverClaude } from "./lib/claude.mjs";
import { jourLocal, tableau } from "./lib/commun.mjs";
import { grave, signatureCorrectifs, vulnerabilites } from "./lib/dependances.mjs";

const MESSAGE_COMMIT = "Correctifs de sécurité des dépendances (npm audit fix)";
const DUREE_CLAUDE_MIN = 60;

/** Fin d'une sortie de commande, pour un rapport ou une consigne. */
function extrait(texte, caracteres = 4000) {
  const t = String(texte ?? "").trim();
  return t.length > caracteres ? `…${t.slice(-caracteres)}` : t;
}

/** Nom de branche libre : correctifs/2026-10-26, puis -2, -3... */
export function nomBranche(jour, existe) {
  const base = `correctifs/${jour}`;
  let nom = base;
  for (let i = 2; existe(nom); i += 1) nom = `${base}-${i}`;
  return nom;
}

/**
 * Consigne de la session Claude appelee quand ca ne marche pas : `npm audit fix`
 * lui-meme en echec (etape « mise a jour » : Claude applique les mises a jour),
 * ou une verification qui echoue apres (etape « verification » : Claude adapte
 * le code).
 */
export function consigneReparation({ dossier, branche, etape = "verification", paquets, vulnerables = [], commande, sortie, verifications }) {
  const listeVerifs = verifications.map((v) => `\`${v}\``).join(", ");
  const situation =
    etape === "mise-a-jour"
      ? `Dans le dépôt ${dossier}, sur la branche \`${branche}\` (créée pour ça), \`${commande}\` devait corriger des vulnérabilités, mais il a échoué ou n'a rien changé :

\`\`\`
${extrait(sortie)}
\`\`\`

Vulnérabilités à corriger (paquet, gravité, versions touchées) :
${vulnerables.map((v) => `- ${v.nom} (${v.gravite}) : ${v.plage}`).join("\n") || paquets.join(", ")}

Ton travail : appliquer toi-même ces mises à jour de sécurité, sans passer une dépendance directe à une nouvelle version majeure (\`npm install <paquet>@<version corrigée>\`, \`npm update <paquet>\`, ou une entrée \`overrides\` dans package.json pour une dépendance transitive), vérifier avec \`npm audit\` qu'elles sont corrigées, puis faire passer TOUTES les vérifications, dans cet ordre : ${listeVerifs}. Lance-les toi-même pour t'en assurer.`
      : `Dans le dépôt ${dossier}, sur la branche \`${branche}\` (créée pour ça), \`npm audit fix\` vient de mettre à jour des dépendances pour corriger des vulnérabilités : ${paquets.join(", ") || "voir le diff de package-lock.json"}.
Depuis, la vérification \`${commande}\` échoue :

\`\`\`
${extrait(sortie)}
\`\`\`

Ton travail : adapter le code ou la configuration pour que TOUTES les vérifications passent, dans cet ordre : ${listeVerifs}. Lance-les toi-même pour t'en assurer.`;
  return `Réponds et écris en français.

Session lancée automatiquement par SiteDashboard, sans personne pour répondre : agis seul.

${situation}

Contraintes :
- reste sur cette branche ; ne commite pas, ne pousse pas, ne change pas de branche : SiteDashboard relance les vérifications et commite lui-même ;
- ne reviens pas aux versions vulnérables, ne désactive aucun test ni aucune règle de lint, ne supprime aucun test pour faire passer ;
- changements minimaux et ciblés ; respecte les conventions du projet (AGENTS.md ou README s'il y en a) ;
- si tu n'y arrives pas, laisse les fichiers en l'état et explique pourquoi : SiteDashboard annulera tout.

Termine par 2 à 5 lignes : ce que tu as changé et pourquoi, ou pourquoi tu n'as pas pu.`;
}

/**
 * Le deroulement, avec ses dependances passees en parametre (tests) :
 * `sh(commande)` -> { code, sortie }, execute dans le depot ; `reparer(contexte)`
 * -> Promise<{ code, sortie } | null> (null : Claude indisponible).
 * `fusionner` : une fois les verifications passees, la branche du correctif est
 * fusionnee dans la branche de depart (en local, rien n'est pousse).
 * Renvoie { points, resume, etapes, signature, fusionnee }.
 */
export async function corriger({ verifications, jour, essai = false, fusionner = false, sh, reparer }) {
  const points = [];
  // Points annexes (versions majeures a faire a la main), apres le resultat principal
  const annexes = [];
  const etapes = [];
  const ajouter = (niveau, texte) => points.push({ niveau, texte, sansAnalyse: true });
  const noter = (texte) => etapes.push(texte);
  const fini = (resume, signature = null) => ({ points: [...points, ...annexes], resume, etapes, signature });
  const ok = (commande) => {
    const r = sh(commande);
    noter(`\`${commande}\` : code ${r.code}`);
    return r;
  };

  // 1. Un depot git, sans travail en cours : on doit pouvoir tout annuler
  if (ok("git rev-parse --is-inside-work-tree").code !== 0) {
    ajouter("echec", "Le dossier n'est pas un dépôt git : rien n'est fait (impossible d'annuler proprement)");
    return fini("Correctif impossible : le dossier n'est pas un dépôt git.");
  }
  const enCours = sh("git status --porcelain").sortie.trim();
  if (enCours) {
    ajouter("attention", `Travail en cours non commité (${enCours.split(/\r?\n/).length} fichier(s)) : rien n'est fait, relance quand le dépôt est propre`);
    return fini("Rien n'est fait : le dépôt a du travail en cours non commité.");
  }
  const depart = sh("git branch --show-current").sortie.trim();
  if (!depart) {
    ajouter("attention", "Le dépôt n'est sur aucune branche (HEAD détaché) : rien n'est fait");
    return fini("Rien n'est fait : le dépôt n'est sur aucune branche.");
  }

  // 2. Ce qu'il y a a corriger
  const lire = () => {
    try {
      return vulnerabilites(JSON.parse(sh("npm.cmd audit --json").sortie || "{}"));
    } catch {
      return null;
    }
  };
  const avant = lire();
  if (!avant) {
    ajouter("echec", "`npm audit` illisible : rien n'est fait");
    return fini("Correctif impossible : npm audit n'a pas répondu.");
  }
  const signature = signatureCorrectifs(avant);
  const corrigeables = avant.filter((v) => v.correctif === "compatible");
  const majeures = avant.filter((v) => v.correctif === "majeur");
  noter(`Avant : ${avant.length} vulnérabilité(s), ${corrigeables.length} corrigeable(s) sans version majeure`);
  if (majeures.length) {
    annexes.push({
      niveau: "attention",
      texte: `À faire à la main (version majeure) : ${majeures.map((v) => `${v.nom} (${v.gravite})`).join(", ")}`,
      sansAnalyse: true,
    });
  }
  if (corrigeables.length === 0) {
    if (!majeures.length) ajouter("ok", avant.length ? "Aucune vulnérabilité corrigeable automatiquement" : "Aucune vulnérabilité");
    return fini(majeures.length ? "Rien de corrigeable automatiquement : les correctifs demandent une version majeure." : "Rien à corriger.", signature);
  }
  const noms = corrigeables.map((v) => v.nom);
  if (essai) {
    ajouter("ok", `Essai : ${corrigeables.length} vulnérabilité(s) à corriger (${noms.join(", ")}), rien n'est modifié`);
    return fini(`Essai : ${corrigeables.length} vulnérabilité(s) seraient corrigées.`, signature);
  }

  // 3. Branche a part, puis npm audit fix (sans --force)
  const branche = nomBranche(jour, (nom) => sh(`git rev-parse --verify --quiet refs/heads/${nom}`).code === 0);
  if (ok(`git switch -c ${branche}`).code !== 0) {
    ajouter("echec", `Création de la branche ${branche} impossible`);
    return fini("Correctif impossible : branche non créée.", signature);
  }
  // Revient a la branche de depart, node_modules resynchronise avec son package-lock.
  // `fusionner` : la branche du correctif y est fusionnee (avance rapide seulement,
  // en local) ; renvoie true si c'est fait.
  const revenir = ({ supprimer, fusionner: fusion = false }) => {
    if (supprimer) {
      ok("git reset --hard");
      ok("git clean -fd");
    }
    ok(`git switch ${depart}`);
    if (supprimer) ok(`git branch -D ${branche}`);
    let fusionnee = false;
    if (fusion && ok(`git merge --ff-only ${branche}`).code === 0) {
      ok(`git branch -d ${branche}`);
      fusionnee = true;
    }
    // ci et pas install : install pourrait reecrire package-lock et salir le depot
    ok("npm.cmd ci --no-audit --no-fund");
    return fusionnee;
  };

  const verifier = () => {
    for (const commande of verifications) {
      const r = ok(commande);
      if (r.code !== 0) return { commande, sortie: r.sortie };
    }
    return null;
  };
  let claude = null;
  // Ca ne marche pas : Claude recoit l'erreur, puis SiteDashboard reverifie lui-meme
  const appelerClaude = async (contexte) => {
    claude = await reparer({ branche, paquets: noms, vulnerables: corrigeables, verifications, ...contexte });
    if (!claude) return;
    noter(`Session Claude terminée (code ${claude.code}) : ${fin(claude.sortie)}`);
    // La session a pu changer de branche malgre la consigne : on y revient
    ok(`git switch ${branche}`);
  };
  const annuler = (texte, resume) => {
    revenir({ supprimer: true });
    const pourquoi = claude ? `Claude n'a pas réussi : ${fin(claude.sortie, 4)}` : "Claude indisponible pour prendre le relais";
    ajouter("attention", `${texte} ${pourquoi}`);
    return fini(`${resume} Le dépôt est revenu à son état de départ.`, signature);
  };

  // 4. npm audit fix ; s'il plante ou ne change rien, Claude applique les mises a jour
  const fix = ok("npm.cmd audit fix --no-fund");
  const change = Boolean(sh("git status --porcelain").sortie.trim());
  if (fix.code !== 0 || !change) {
    noter(fix.code !== 0 ? `npm audit fix en échec : ${fin(fix.sortie, 3)}` : "npm audit fix n'a rien changé");
    await appelerClaude({ etape: "mise-a-jour", commande: "npm audit fix", sortie: fix.sortie || "aucun fichier modifié" });
    if (!sh("git status --porcelain").sortie.trim() && sh(`git rev-list --count ${depart}..${branche}`).sortie.trim() === "0") {
      return annuler(`npm audit fix ${fix.code !== 0 ? "a échoué" : "n'a rien changé"} (${noms.join(", ")}).`, "Aucune mise à jour appliquée.");
    }
  }

  // 5. Verifications ; en cas d'echec, Claude adapte le code (une seule session par passage)
  let echec = verifier();
  if (echec && !claude) {
    noter(`Échec de \`${echec.commande}\` après la mise à jour`);
    await appelerClaude({ etape: "verification", commande: echec.commande, sortie: echec.sortie });
    if (claude) echec = verifier();
  }
  if (echec) {
    return annuler(
      `Correctif annulé : \`${echec.commande}\` échoue après la mise à jour (${noms.join(", ")}).`,
      `Correctif annulé : \`${echec.commande}\` échoue après la mise à jour.`,
    );
  }

  // 6. Les vulnerabilites ont-elles vraiment disparu ?
  const apres = lire() ?? [];
  const corriges = noms.filter((nom) => !apres.some((v) => v.nom === nom));
  if (corriges.length === 0) {
    return annuler(`Vérifications OK, mais aucune vulnérabilité n'a disparu (${noms.join(", ")}).`, "Aucune vulnérabilité corrigée.");
  }

  // 7. Commit local sur la branche, puis retour a la branche de depart
  // Rien a commiter : la session Claude a commite elle-meme malgre la consigne
  const aCommiter = Boolean(sh("git status --porcelain").sortie.trim());
  if (aCommiter) ok("git add -A");
  if (aCommiter && ok(`git commit -m "${MESSAGE_COMMIT}${claude ? " + relais de Claude" : ""}"`).code !== 0) {
    revenir({ supprimer: true });
    ajouter("echec", "Le commit a échoué : correctif annulé");
    return fini("Correctif annulé : commit impossible.", signature);
  }
  const fusionnee = revenir({ supprimer: false, fusionner });
  const restantes = apres.filter(grave);
  if (fusionnee) {
    ajouter("ok", `${corriges.length} paquet(s) corrigé(s) (${corriges.join(", ")}), vérifications OK : fusionné dans \`${depart}\` (commit local, rien n'est poussé)`);
  } else {
    ajouter(
      "attention",
      `${corriges.length} paquet(s) corrigé(s) (${corriges.join(", ")}), vérifications OK : branche \`${branche}\` à fusionner (rien n'est poussé)${fusionner ? " ; la fusion automatique a échoué" : ""}`,
    );
  }
  if (claude) ajouter("attention", `Claude a pris le relais : relis le diff. ${fin(claude.sortie, 4)}`);
  if (restantes.length) ajouter("attention", `Encore ${restantes.length} vulnérabilité(s) haute(s) ou critique(s) : ${restantes.map((v) => v.nom).join(", ")}`);
  return {
    ...fini(
      fusionnee
        ? `${corriges.length} paquet(s) corrigé(s)${claude ? " avec l'aide de Claude" : ""}, vérifications OK : fusionné dans ${depart}, à pousser quand tu veux.`
        : `${corriges.length} paquet(s) corrigé(s)${claude ? " avec l'aide de Claude" : ""}, vérifications OK : la branche ${branche} est prête à fusionner.`,
      signature,
    ),
    fusionnee,
  };
}

export async function executer(controle, { etat, essai = false }) {
  const { dossier, verifications } = controle.fiche.correctifs;
  const debut = new Date();
  let journal = null;
  const sh = (commande) => {
    const r = spawnSync(commande, { cwd: dossier, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000, windowsHide: true });
    return { code: r.status ?? -1, sortie: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
  };
  const reparer = async (contexte) => {
    if (controle.parametres?.claude === false) return null;
    const claude = trouverClaude();
    if (!claude) return null;
    journal ??= ouvrirJournal(controle.id, debut);
    appendFileSync(journal, `[SiteDashboard] échec de ${contexte.commande}, session Claude de réparation\n`);
    return sessionClaude({
      claude,
      args: ["-p", "--output-format", "text", "--permission-mode", "auto"],
      cwd: dossier,
      texte: consigneReparation({ dossier, ...contexte }),
      journal,
      dureeMaxMin: DUREE_CLAUDE_MIN,
    });
  };

  const r = await corriger({ verifications, jour: jourLocal(debut), essai, fusionner: controle.parametres?.fusionner === true, sh, reparer });
  return {
    // Lu par lancer.mjs : le code de la branche de travail a change, la tache qui a demande le correctif peut revérifier
    corrige: Boolean(r.fusionnee),
    points: r.points,
    resume: r.resume,
    sectionJournal: `Dossier : \`${dossier}\`\n\n${tableau(["Étape"], r.etapes.map((e) => [e]))}`,
    detail: r.etapes.join("\n"),
    // Lu par lancer.mjs : l'audit ne redemande pas ce qui a deja ete tente
    nouvelEtat: { ...etat, signatureTraitee: r.signature ?? etat.signatureTraitee ?? null },
  };
}
