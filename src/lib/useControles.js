import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { appliquerReglages, controlesDus, enregistrerNouvelles, file } from "./controles";
import { ecrirePreference, lirePreference } from "./queries";
import { tracer } from "./trace";

/** Preferences JSON : derniers lancements, horaires modifies, agents desactives. */
const CLES = { derniers: "controles_derniers", horaires: "controles_horaires", desactives: "controles_desactives" };

async function lireJson(cle, defaut) {
  try {
    return JSON.parse((await lirePreference(cle, JSON.stringify(defaut))) || JSON.stringify(defaut));
  } catch {
    return defaut;
  }
}

/**
 * Lance les controles et agents dus a chaque `rafraichissement` (le cycle de
 * supervision, toutes les minutes). Deux files independantes, une a la fois
 * chacune : les scripts (secondes) et les agents Claude (jusqu'a des heures,
 * l'indexation attend le quota Google) ne se bloquent pas entre eux.
 *
 * Le registre (modeles appliques aux sites) est lu au demarrage et apres chaque
 * ajout ou retrait : il vit dans des fichiers, pas dans l'appli compilee.
 *
 * Le lancement est note a la fin, meme en cas d'echec : un controle casse ne
 * doit pas etre relance chaque minute, son rapport en echec suffit a le dire.
 */
export function useControles(rafraichissement, onTermine) {
  const [registre, setRegistre] = useState({ charge: false, controles: [], modeles: [], erreur: null });
  const [derniers, setDerniers] = useState({});
  const [reglages, setReglages] = useState({ horaires: {}, desactives: [] });
  const [enCours, setEnCours] = useState({ script: null, claude: null });
  const [resultats, setResultats] = useState({});
  // Verrous hors du rendu : StrictMode et deux cycles proches ne doivent pas lancer en double
  const verrous = useRef({ script: false, claude: false });
  const taches = useRef([]);
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

  const controles = useMemo(() => appliquerReglages(registre.controles, reglages), [registre.controles, reglages]);

  const lancer = useCallback(
    async (id) => {
      const controle = taches.current.find((c) => c.id === id);
      if (!controle) return false;
      const voie = file(controle);
      if (verrous.current[voie]) return false;
      verrous.current[voie] = true;
      setEnCours((avant) => ({ ...avant, [voie]: id }));
      let resultat;
      try {
        const r = await invoke("lancer_controle", { id });
        resultat = r.resume ?? { statut: "echec", erreur: r.erreurs || `code ${r.code}` };
        if (r.code !== 0) tracer("controles", `${id} : code ${r.code} ${r.erreurs}`);
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
      const [lusBruts, horaires, desactives] = await Promise.all([
        lireJson(CLES.derniers, {}),
        lireJson(CLES.horaires, {}),
        lireJson(CLES.desactives, []),
      ]);
      if (annule) return;
      // Taches nouvelles : enregistrees sans rattrapage (voir enregistrerNouvelles)
      const avecNouvelles = enregistrerNouvelles(registre.controles, lusBruts);
      if (avecNouvelles) await ecrirePreference(CLES.derniers, JSON.stringify(avecNouvelles));
      const lus = avecNouvelles ?? lusBruts;
      setDerniers(lus);
      setReglages({ horaires, desactives });
      // onTermine relance ce cycle : les controles dus s'enchainent, file par file
      const dus = controlesDus(appliquerReglages(registre.controles, { horaires, desactives }), lus);
      for (const voie of ["script", "claude"]) {
        const prochain = dus.find((c) => file(c) === voie);
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
      recharger();
    },
    [recharger],
  );

  return {
    controles,
    modeles: registre.modeles,
    erreurRegistre: registre.erreur,
    derniers,
    enCours,
    resultats,
    lancer,
    modifierHoraire,
    activer,
    ajouter,
    retirer,
  };
}
