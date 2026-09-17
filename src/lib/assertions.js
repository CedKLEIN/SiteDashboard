/**
 * Les verdicts de supervision, tous au meme endroit.
 *
 * Rust constate, JS juge: `executer_check` renvoie les FAITS d'une reponse
 * (statut, en-tetes, taille, occurrences) et ne decide plus rien. C'est deja le
 * partage de `verifier_certificat` + `evaluerCertificat`, et c'est lui qui rend
 * toutes les regles testables sans reseau. Les avoir des deux cotes ferait deux
 * endroits qui decident, donc deux endroits a corriger.
 */

/** Seuil par defaut avant expiration d'un nom de domaine. */
export const SEUIL_DOMAINE_JOURS = 30;

/**
 * Intervalle minimal entre deux executions, en secondes, par type de check.
 *
 * Le cycle tourne a la minute. Interroger RDAP 1440 fois par jour pour une date
 * qui bouge une fois par an est abusif et se fait rate-limiter; une poignee de
 * main TLS complete chaque minute pour une date qui change tous les 90 jours
 * n'est pas plus defendable.
 */
export const INTERVALLE_PAR_TYPE = {
  http: null,
  redirection: null,
  valeur: 15 * 60,
  tls: 6 * 3600,
  domaine: 12 * 3600,
};

export function intervalleParDefaut(type) {
  return INTERVALLE_PAR_TYPE[type] ?? null;
}

/* -------------------------------------------------- assertions d'en-tetes */

/**
 * Mini-syntaxe des regles d'en-tetes, une par ligne. Le `!` nie la regle.
 *
 *   strict-transport-security       -> doit etre present
 *   !x-powered-by                   -> doit etre absent
 *   content-type: application/json  -> doit contenir cette valeur
 *   !server: /                      -> ne doit pas contenir cette valeur
 *
 * La derniere forme est le cas qui a motive tout ca: on veut interdire
 * "nginx/1.18.0 (Ubuntu)" sans figer pour autant la valeur attendue.
 */
export function parserRegles(texte) {
  return String(texte ?? "")
    .split("\n")
    .map((ligne) => ligne.trim())
    .filter(Boolean)
    .map((ligne) => {
      const nie = ligne.startsWith("!");
      const reste = (nie ? ligne.slice(1) : ligne).trim();
      const separateur = reste.indexOf(":");

      if (separateur === -1) {
        return { nom: reste.toLowerCase(), operateur: nie ? "absent" : "present", valeur: null };
      }

      const valeur = reste.slice(separateur + 1).trim();
      const nom = reste.slice(0, separateur).trim().toLowerCase();

      // "server:" sans valeur serait une regle toujours vraie: on la ramene a
      // la presence, qui est ce que la saisie veut visiblement dire.
      if (valeur === "") {
        return { nom, operateur: nie ? "absent" : "present", valeur: null };
      }
      return { nom, operateur: nie ? "ne_contient_pas" : "contient", valeur };
    })
    .filter((regle) => regle.nom !== "");
}

/** Reecrit des regles stockees dans la syntaxe de saisie, pour reafficher un check. */
export function formaterRegles(regles = []) {
  return regles
    .map(({ nom, operateur, valeur }) => {
      switch (operateur) {
        case "absent":
          return `!${nom}`;
        case "contient":
          return `${nom}: ${valeur}`;
        case "ne_contient_pas":
          return `!${nom}: ${valeur}`;
        default:
          return nom;
      }
    })
    .join("\n");
}

function defautDeRegle(regle, valeur) {
  const presente = valeur !== undefined;
  // Casse ignoree des deux cotes: reqwest normalise deja les noms en minuscules,
  // et "nginx" ou "Nginx" en valeur ne veut rien dire de different.
  const contient = presente && valeur.toLowerCase().includes(String(regle.valeur ?? "").toLowerCase());

  switch (regle.operateur) {
    case "present":
      return presente ? null : `en-tete absent: ${regle.nom}`;
    case "absent":
      return presente ? `en-tete present: ${regle.nom}` : null;
    case "contient":
      if (!presente) return `en-tete absent: ${regle.nom}`;
      return contient ? null : `${regle.nom} ne contient pas "${regle.valeur}" (${valeur})`;
    case "ne_contient_pas":
      if (!presente) return null;
      return contient ? `${regle.nom} contient "${regle.valeur}" (${valeur})` : null;
    default:
      return `operateur inconnu: ${regle.operateur}`;
  }
}

/**
 * Confronte les regles d'un check aux en-tetes recus.
 *
 * Une seule regle est annoncee, la premiere en defaut: lister trois en-tetes
 * dans une carte de site la rendrait illisible. Le compte des autres suffit a
 * dire qu'il faut ouvrir le diagnostic.
 */
export function verdictEntetes(regles = [], entetes = []) {
  const recus = new Map(entetes.map(([nom, valeur]) => [String(nom).toLowerCase(), String(valeur)]));
  const defauts = regles
    .map((regle) => defautDeRegle(regle, recus.get(String(regle.nom).toLowerCase())))
    .filter(Boolean);

  if (defauts.length === 0) return null;
  return defauts.length === 1 ? defauts[0] : `${defauts[0]} (+${defauts.length - 1} autre(s))`;
}

/* ------------------------------------------------------- assertions de corps */

function verdictContenu(check, reponse) {
  const fragment = check.doit_contenir;

  if (fragment) {
    const minimum = check.occurrences_min ?? 1;
    const vues = reponse.occurrences ?? 0;
    if (vues < minimum) {
      // A une seule occurrence attendue, "fragment absent" reste le message le
      // plus clair - c'est celui qu'on lit depuis le debut.
      return minimum === 1
        ? `fragment absent: ${fragment}`
        : `${vues} occurrence(s) de "${fragment}", ${minimum} attendue(s)`;
    }
  }

  if (check.taille_min_octets != null) {
    const taille = reponse.taille ?? 0;
    if (taille < check.taille_min_octets) {
      return `corps de ${taille} octet(s), minimum ${check.taille_min_octets}`;
    }
  }

  return null;
}

/* --------------------------------------------------------------- verdicts */

/**
 * Verdict d'un check HTTP.
 *
 * L'ordre des messages compte, et prolonge la regle en place depuis le debut:
 *   1. statut  - sur un 404, tout le reste est mecaniquement faux;
 *   2. contenu - une mauvaise page explique des en-tetes manquants,
 *                l'inverse n'est pas vrai;
 *   3. en-tetes.
 */
export function evaluerReponse(check, reponse = {}) {
  if (reponse.erreur) return { ok: false, message: reponse.erreur };

  const statut = reponse.statut;
  const attendu = check.statut_attendu ?? null;
  const statutOk = attendu == null ? statut >= 200 && statut < 300 : statut === attendu;
  if (!statutOk) return { ok: false, message: `statut HTTP ${statut}` };

  const contenu = verdictContenu(check, reponse);
  if (contenu) return { ok: false, message: contenu };

  const entetes = verdictEntetes(check.entetes ?? [], reponse.entetes ?? []);
  if (entetes) return { ok: false, message: entetes };

  return { ok: true, message: null };
}

/**
 * Deux URL designent-elles la meme ressource ?
 *
 * Le slash final ne distingue rien quand le chemin est vide. Ailleurs, /a et
 * /a/ ne sont pas la meme ressource, et faire semblant du contraire laisserait
 * passer une vraie regression.
 */
export function memeUrl(a, b) {
  const normaliser = (brut) => {
    try {
      const u = new URL(brut);
      return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
    } catch {
      return String(brut ?? "").trim();
    }
  };
  return normaliser(a) === normaliser(b);
}

/**
 * Verdict d'un check de redirection.
 *
 * Le cas qui a motive ce type: www.denivio.fr servait le site en 200 au lieu de
 * rediriger. Un check HTTP serait passe au vert, puisque le bug ETAIT le 200.
 *
 * La cible passe AVANT le code exact: rediriger au mauvais endroit en 302 est
 * un probleme plus grave que rediriger au bon endroit en 302 plutot qu'en 301,
 * et annoncer le code masquerait le premier.
 */
export function evaluerRedirection(check, reponse = {}) {
  if (reponse.erreur) return { ok: false, message: reponse.erreur };

  const statut = reponse.statut;
  if (!(statut >= 300 && statut < 400)) {
    return { ok: false, message: `statut HTTP ${statut} au lieu d'une redirection` };
  }
  if (!reponse.cible) {
    return { ok: false, message: `redirection ${statut} sans en-tete Location` };
  }
  // Une cible egale a l'URL de depart est une boucle: detectee gratuitement.
  if (memeUrl(reponse.cible, check.url)) {
    return { ok: false, message: `boucle de redirection vers ${reponse.cible}` };
  }

  const attendue = check.cible_attendue;
  if (attendue && !memeUrl(reponse.cible, attendue)) {
    return { ok: false, message: `redirige vers ${reponse.cible} au lieu de ${attendue}` };
  }
  if (check.statut_attendu != null && statut !== check.statut_attendu) {
    return { ok: false, message: `redirection ${statut} au lieu de ${check.statut_attendu}` };
  }

  return { ok: true, message: `${statut} vers ${reponse.cible}` };
}

/**
 * Verdict d'un check de domaine: ou il pointe, et quand il expire.
 *
 * Meme logique que le certificat - on echoue AVANT l'expiration, parce que
 * c'est une panne entierement previsible et qu'un domaine se recupere beaucoup
 * moins vite qu'un certificat.
 *
 * Une expiration illisible ne fait pas echouer le check: un TLD sans serveur
 * RDAP n'est pas un probleme du domaine, et crier sur une absence de donnee
 * userait l'alerte pour rien.
 */
export function evaluerDomaine(check, reponse = {}, seuilParDefaut = SEUIL_DOMAINE_JOURS) {
  if (reponse.erreur) return { ok: false, message: reponse.erreur };

  const adresses = reponse.adresses ?? [];
  const attendue = String(check.cible_attendue ?? "").trim();
  if (attendue && !adresses.includes(attendue)) {
    return {
      ok: false,
      message: `resout vers ${adresses.join(", ") || "rien"} au lieu de ${attendue}`,
    };
  }

  const jours = reponse.jours_restants;
  const seuil = check.seuil_jours ?? seuilParDefaut;
  if (jours != null) {
    if (jours < 0) return { ok: false, message: `domaine expire depuis ${-jours} jour(s)` };
    if (jours <= seuil) return { ok: false, message: `domaine expire dans ${jours} jour(s)` };
  }

  const expiration =
    jours == null
      ? (reponse.erreur_expiration ?? "expiration inconnue")
      : `expire dans ${jours} jour(s)`;
  return { ok: true, message: `${adresses.join(", ")} · ${expiration}` };
}
