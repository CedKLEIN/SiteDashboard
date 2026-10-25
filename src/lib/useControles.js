import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { REGISTRE, controlesDus } from "./controles";
import { ecrirePreference, lirePreference } from "./queries";
import { tracer } from "./trace";

/** Preference JSON : id du controle -> ISO de son dernier lancement. */
const CLE = "controles_derniers";

async function lireDerniers() {
  try {
    return JSON.parse((await lirePreference(CLE, "{}")) || "{}");
  } catch {
    return {};
  }
}

/**
 * Lance les controles dus, un a la fois, a chaque `rafraichissement` (le cycle
 * de supervision, toutes les minutes). Le lancement est note a la fin, meme en
 * cas d'echec : un controle casse ne doit pas etre relance chaque minute, son
 * rapport en echec suffit a le signaler.
 */
export function useControles(rafraichissement, onTermine) {
  const [derniers, setDerniers] = useState({});
  const [enCours, setEnCours] = useState(null);
  const [resultats, setResultats] = useState({});
  // Verrou hors du rendu : StrictMode et deux cycles proches ne doivent pas lancer en double
  const verrou = useRef(false);

  const lancer = useCallback(
    async (id) => {
      if (verrou.current) return false;
      verrou.current = true;
      setEnCours(id);
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
        const nouveaux = { ...(await lireDerniers()), [id]: new Date().toISOString() };
        await ecrirePreference(CLE, JSON.stringify(nouveaux));
        setDerniers(nouveaux);
      } finally {
        setResultats((avant) => ({ ...avant, [id]: resultat }));
        setEnCours(null);
        verrou.current = false;
        onTermine?.();
      }
      return true;
    },
    [onTermine],
  );

  useEffect(() => {
    let annule = false;
    (async () => {
      const lus = await lireDerniers();
      if (annule) return;
      setDerniers(lus);
      const dus = controlesDus(REGISTRE, lus);
      // onTermine relance ce cycle : les controles dus s'enchainent un par un
      if (dus.length && !verrou.current) lancer(dus[0].id);
    })().catch((e) => tracer("controles", `planning impossible : ${e}`));
    return () => {
      annule = true;
    };
  }, [rafraichissement, lancer]);

  return { derniers, enCours, resultats, lancer };
}
