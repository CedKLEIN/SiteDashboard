import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Depenses from "./pages/Depenses";
import Revenus from "./pages/Revenus";
import Abonnements from "./pages/Abonnements";
import Sites from "./pages/Sites";
import Preferences, { INTERVALLE_DEFAUT_S } from "./pages/Preferences";
import DetailSite from "./pages/DetailSite";
import Agents from "./pages/Agents";
import { lancerCycle } from "./lib/monitoring";
import { nbAgentsEnRetard } from "./lib/tachesPlanifiees";
import { useAgentsAttendus } from "./lib/useAgentsAttendus";
import { useNotifications } from "./lib/useNotifications";
import { resumeMiseAJour, useMiseAJour } from "./lib/miseAJour";
import { lirePreference, listerSites } from "./lib/queries";
import { tracer } from "./lib/trace";

export default function App() {
  const [onglet, setOnglet] = useState("dashboard");
  const [siteOuvert, setSiteOuvert] = useState(null);
  const [sites, setSites] = useState([]);
  const [cheminBase, setCheminBase] = useState("");
  const [verificationEnCours, setVerificationEnCours] = useState(false);
  const [intervalleS, setIntervalleS] = useState(INTERVALLE_DEFAUT_S);
  // Incremente a chaque ecriture en base: force les ecrans a se recalculer
  const [revision, setRevision] = useState(0);

  const signalerModification = useCallback(() => setRevision((r) => r + 1), []);

  const verifier = useCallback(async () => {
    setVerificationEnCours(true);
    try {
      const resultat = await lancerCycle();
      tracer(
        "supervision",
        resultat.ignore
          ? "cycle ignore: le precedent tourne encore"
          : `cycle termine: ${resultat.checks} check(s)`,
      );
      // Un cycle ignore (le precedent tourne encore) n'a rien ecrit a relire
      if (!resultat.ignore) signalerModification();
    } catch (erreur) {
      // La supervision ne doit jamais faire tomber l'UI, mais un echec silencieux
      // serait pire: on trace avant d'avaler.
      tracer("supervision", `echec du cycle: ${erreur?.stack ?? erreur}`);
    } finally {
      setVerificationEnCours(false);
    }
  }, [signalerModification]);

  useEffect(() => {
    invoke("chemin_base")
      .then(setCheminBase)
      .catch(() => setCheminBase(""));
  }, []);

  useEffect(() => {
    let annule = false;
    listerSites().then((s) => {
      if (!annule) setSites(s);
    });
    return () => {
      annule = true;
    };
  }, [revision]);

  // L'intervalle est une preference: on le relit a chaque modification pour que
  // le changement prenne effet sans redemarrer l'application.
  useEffect(() => {
    let annule = false;
    lirePreference("intervalle_supervision_s", String(INTERVALLE_DEFAUT_S)).then((v) => {
      const secondes = Number(v);
      if (!annule && Number.isFinite(secondes) && secondes > 0) setIntervalleS(secondes);
    });
    return () => {
      annule = true;
    };
  }, [revision]);

  useEffect(() => {
    // Cas d'usage canonique d'un effet: on synchronise avec un systeme externe
    // (les sites a interroger). Le setState immediat est le drapeau "en cours",
    // qu'on veut justement voir des le premier cycle.
    // oxlint-disable-next-line react/set-state-in-effect
    verifier();
    const minuterie = setInterval(verifier, intervalleS * 1000);
    return () => clearInterval(minuterie);
  }, [verifier, intervalleS]);

  const agents = useAgentsAttendus(revision);
  useNotifications(revision, agents.attendus);
  const miseAJour = useMiseAJour();

  const site = sites.find((s) => s.id === siteOuvert);

  const pages = {
    dashboard: <Dashboard rafraichissement={revision} onOuvrirSite={setSiteOuvert} />,
    depenses: <Depenses onModification={signalerModification} />,
    revenus: <Revenus onModification={signalerModification} />,
    abonnements: <Abonnements onModification={signalerModification} />,
    sites: <Sites onModification={signalerModification} />,
    agents: (
      <Agents
        sites={sites}
        rafraichissement={revision}
        attendus={agents.attendus}
        configTrouvee={agents.configTrouvee}
      />
    ),
    preferences: (
      <Preferences
        onModification={signalerModification}
        cheminBase={cheminBase}
        miseAJour={miseAJour}
      />
    ),
  };

  function changerOnglet(cle) {
    setSiteOuvert(null);
    setOnglet(cle);
  }

  return (
    <Layout
      ongletActif={siteOuvert ? null : onglet}
      onChangerOnglet={changerOnglet}
      cheminBase={cheminBase}
      verificationEnCours={verificationEnCours}
      intervalleS={intervalleS}
      alertes={{ agents: nbAgentsEnRetard(agents.attendus) }}
      miseAJour={resumeMiseAJour(miseAJour.etat)}
    >
      {site ? (
        <DetailSite
          key={site.id}
          site={site}
          onRetour={() => setSiteOuvert(null)}
          onVerifierMaintenant={verifier}
          verificationEnCours={verificationEnCours}
          rafraichissement={revision}
        />
      ) : (
        pages[onglet]
      )}
    </Layout>
  );
}
