import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ajouterSuites,
  appliquerReglages,
  controlesDus,
  enregistrerNouvelles,
  file,
  planifierReessai,
  reessaisDus,
  separerAjouts,
} from "./controles";
import { ecrirePreference, lirePreference } from "./queries";
import { tracer } from "./trace";

/**
 * Preferences JSON : derniers lancements, ajouts des taches, horaires modifies,
 * agents desactives, nouveaux essais prevus (gardes si l'appli redemarre).
 */
const CLES = {
  derniers: "controles_derniers",
  ajouts: "controles_ajouts",
  horaires: "controles_horaires",
  desactives: "controles_desactives",
  reessais: "controles_reessais",
};

async function lireJson(cle, defaut) {
  try {
    return JSON.parse((await lirePreference(cle, JSON.stringify(defaut))) || JSON.stringify(defaut));
  } catch {
    return defaut;
  }
}

/**
 * Lance les controles et agents dus a chaque `rafraichissement` (chaque minute,
 * et apres chaque ecriture en base). Deux files independantes, une a la fois
 * chacune : les scripts (secondes) et les agents Claude (jusqu'a des heures,
 * l'indexation attend le quota Google) ne se bloquent pas entre eux.
 *
 * Le registre (modeles appliques aux sites) est lu au demarrage et apres chaque
 * ajout ou retrait : il vit dans des fichiers, pas dans l'appli compilee.
 *
 * Le lancement est note a la fin, meme en cas d'echec : un controle casse ne
 * doit pas etre relance chaque minute, son rapport en echec suffit a le dire.
 *
 * Une tache sans horaire n'est jamais due : elle part a la main, ou quand un
 * controle la demande en finissant (l'audit demande le correctif des
 * dependances), au cycle suivant, avant les taches a l'heure.
 */
export function useControles(rafraichissement, onTermine) {
  const [registre, setRegistre] = useState({ charge: false, controles: [], modeles: [], erreur: null });
  const [derniers, setDerniers] = useState({});
  const [ajouts, setAjouts] = useState({});
  const [reglages, setReglages] = useState({ horaires: {}, desactives: [] });
  const [enCours, setEnCours] = useState({ script: null, claude: null });
  const [resultats, setResultats] = useState({});
  // Verrous hors du rendu : StrictMode et deux cycles proches ne doivent pas lancer en double
  const verrous = useRef({ script: false, claude: false });
  const taches = useRef([]);
  // Taches demandees par un controle termine (l'audit demande le correctif), lancees au cycle suivant
  const attente = useRef([]);
  const reglagesActuels = useRef(reglages);
  // Relu au demarrage, puis a chaque ajout ou retrait
  const [versionRegistre, setVersionRegistre] = useState(0);
  const recharger = useCallback(() => setVersionRegistre((v) => v + 1), []);

  useEffect(() => {
    let annule = false;
    invoke("registre_agents", { action: "liste", args: [] })
      .then(({ controles, modeles }) => {
        if (!annule) setRegistre({ charge: true, controles, modeles, erreur: null });
      })
      .catch((e) => {
        tracer("controles", `registre illisible : ${e}`);
        if (!annule) setRegistre((avant) => ({ ...avant, charge: true, erreur: String(e) }));
      });
    return () => {
      annule = true;
    };
  }, [versionRegistre]);

  useEffect(() => {
    taches.current = registre.controles;
  }, [registre.controles]);

  useEffect(() => {
    reglagesActuels.current = reglages;
  }, [reglages]);

  const controles = useMemo(() => appliquerReglages(registre.controles, reglages), [registre.controles, reglages]);

  const lancer = useCallback(
    async (id) => {
      const controle = taches.current.find((c) => c.id === id);
      if (!controle) return false;
      const voie = file(controle);
      if (verrous.current[voie]) return false;
      verrous.current[voie] = true;
      attente.current = attente.current.filter((x) => x !== id);
      setEnCours((avant) => ({ ...avant, [voie]: id }));
      let resultat;
      try {
        const r = await invoke("lancer_controle", { id });
        resultat = r.resume ?? { statut: "echec", erreur: r.erreurs || `code ${r.code}` };
        if (r.code !== 0) tracer("controles", `${id} : code ${r.code} ${r.erreurs}`);
        // Agents dont le travail n'a pas pu se faire (Chrome deconnecte) : reessayes toutes les 30 min
        const reessais = planifierReessai(await lireJson(CLES.reessais, {}), id, r.resume);
        await ecrirePreference(CLES.reessais, JSON.stringify(reessais));
        attente.current = ajouterSuites(
          attente.current,
          r.resume?.suites,
          appliquerReglages(taches.current, reglagesActuels.current),
        );
      } catch (e) {
        resultat = { statut: "echec", erreur: String(e) };
        tracer("controles", `${id} : ${e}`);
      }
      try {
        const nouveaux = { ...(await lireJson(CLES.derniers, {})), [id]: new Date().toISOString() };
        await ecrirePreference(CLES.derniers, JSON.stringify(nouveaux));
        setDerniers(nouveaux);
      } finally {
        setResultats((avant) => ({ ...avant, [id]: resultat }));
        setEnCours((avant) => ({ ...avant, [voie]: null }));
        verrous.current[voie] = false;
        onTermine?.();
      }
      return true;
    },
    [onTermine],
  );

  useEffect(() => {
    // Rien a planifier tant que le registre n'est pas lu
    if (!registre.charge) return undefined;
    let annule = false;
    (async () => {
      let [lus, ajoutsLus, horaires, desactives, reessais] = await Promise.all([
        lireJson(CLES.derniers, {}),
        lireJson(CLES.ajouts, null),
        lireJson(CLES.horaires, {}),
        lireJson(CLES.desactives, []),
        lireJson(CLES.reessais, {}),
      ]);
      if (annule) return;
      if (ajoutsLus === null) {
        // Premiere fois depuis la separation ajout / lancement (voir separerAjouts)
        ({ derniers: lus, ajouts: ajoutsLus } = separerAjouts(lus));
        await ecrirePreference(CLES.derniers, JSON.stringify(lus));
        await ecrirePreference(CLES.ajouts, JSON.stringify(ajoutsLus));
      }
      // Taches nouvelles : enregistrees sans rattrapage (voir enregistrerNouvelles)
      const avecNouvelles = enregistrerNouvelles(registre.controles, lus, ajoutsLus);
      if (avecNouvelles) await ecrirePreference(CLES.ajouts, JSON.stringify(avecNouvelles));
      const ajoutsTous = avecNouvelles ?? ajoutsLus;
      setDerniers(lus);
      setAjouts(ajoutsTous);
      setReglages({ horaires, desactives });
      // onTermine relance ce cycle : les controles dus s'enchainent, file par file
      const avecReglages = appliquerReglages(registre.controles, { horaires, desactives });
      const dus = controlesDus(avecReglages, lus, new Date(), ajoutsTous);
      // Les taches demandees par un controle, et les nouveaux essais, passent avant les horaires
      const demandees = [...attente.current, ...reessaisDus(reessais, avecReglages)]
        .map((id) => registre.controles.find((c) => c.id === id))
        .filter(Boolean);
      for (const voie of ["script", "claude"]) {
        const prochain = [...demandees, ...dus].find((c) => file(c) === voie);
        if (prochain && !verrous.current[voie]) lancer(prochain.id);
      }
    })().catch((e) => tracer("controles", `planning impossible : ${e}`));
    return () => {
      annule = true;
    };
  }, [rafraichissement, lancer, registre]);

  /** Nouvel horaire (cron) ; null revient a l'horaire par defaut. */
  const modifierHoraire = useCallback(async (id, cron) => {
    const horaires = { ...(await lireJson(CLES.horaires, {})) };
    if (cron) horaires[id] = cron;
    else delete horaires[id];
    await ecrirePreference(CLES.horaires, JSON.stringify(horaires));
    setReglages((avant) => ({ ...avant, horaires }));
  }, []);

  const activer = useCallback(async (id, actif) => {
    const avant = await lireJson(CLES.desactives, []);
    const desactives = actif ? avant.filter((x) => x !== id) : [...new Set([...avant, id])];
    await ecrirePreference(CLES.desactives, JSON.stringify(desactives));
    setReglages((r) => ({ ...r, desactives }));
  }, []);

  /** Applique un modele a un site. Le premier passage sera le prochain de son horaire. */
  const ajouter = useCallback(
    async (modele, site) => {
      await invoke("registre_agents", { action: "ajouter", args: [modele, site] });
      recharger();
    },
    [recharger],
  );

  const retirer = useCallback(
    async (id) => {
      await invoke("registre_agents", { action: "retirer", args: [id] });
      // L'historique part avec la tache : sinon elle reste a l'ecran par ses anciens rapports
      await invoke("supprimer_rapports_agent", { agent: id }).catch((e) => tracer("controles", `historique de ${id} non efface: ${e}`));
      recharger();
    },
    [recharger],
  );

  return {
    controles,
    modeles: registre.modeles,
    erreurRegistre: registre.erreur,
    derniers,
    ajouts,
    enCours,
    resultats,
    lancer,
    modifierHoraire,
    activer,
    ajouter,
    retirer,
  };
}
