import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronRight, TriangleAlert } from "lucide-react";
import Coquille, { TitrePage } from "./components/Coquille";
import Palette from "./components/Palette";
import TiroirTransaction from "./components/TiroirTransaction";
import TiroirAbonnement from "./components/TiroirAbonnement";
import TiroirSite from "./components/TiroirSite";
import Accueil from "./pages/Accueil";
import ListeSites from "./pages/ListeSites";
import FicheSite from "./pages/FicheSite";
import Transactions from "./pages/Transactions";
import Abonnements from "./pages/Abonnements";
import Preferences, { INTERVALLE_DEFAUT_S } from "./pages/Preferences";
import Agents from "./pages/Agents";
import Connecteurs from "./pages/Connecteurs";
import { lireConnecteurs, synchroniserSiBesoin } from "./lib/connecteurs/moteur";
import { lancerCycle } from "./lib/monitoring";
import { vueParSite } from "./lib/vueAgents";
import { useAgentsAttendus } from "./lib/useAgentsAttendus";
import { useControles } from "./lib/useControles";
import { useNotifications } from "./lib/useNotifications";
import { resumeMiseAJour, useMiseAJour } from "./lib/miseAJour";
import { checksEnEchec, echeancesProches, ecrirePreference, etatsDesSites, lirePreference, listerSites } from "./lib/queries";
import { construireATraiter, etatBarre, nbATraiter } from "./lib/aTraiter";
import { aujourdhuiIso } from "./lib/format";
import { tracer } from "./lib/trace";

/** Le planning des taches regarde ce qui est du toutes les minutes. */
const BATTEMENT_PLANNING_MS = 60_000;

const ONGLETS_DEFAUT = { site: "sante", finances: "transactions", reglages: "general" };

/** Sous-onglets dans la barre du haut (Finances, Reglages). */
function SousOnglets({ options, valeur, onChanger }) {
  return (
    <div className="flex gap-1 text-[13px] font-medium" role="tablist">
      {options.map((o) => (
        <button
          key={o.cle}
          type="button"
          role="tab"
          aria-selected={valeur === o.cle}
          onClick={() => onChanger(o.cle)}
          className={`rounded-lg px-2.5 py-1.5 transition ${valeur === o.cle ? "bg-surface-2 text-texte" : "text-texte-doux hover:text-texte"}`}
        >
          {o.libelle}
        </button>
      ))}
    </div>
  );
}

/** Theme applique : celui choisi, ou celui de Windows en mode « systeme ». */
function useTheme() {
  const [choix, setChoix] = useState("systeme");
  const [systemeSombre, setSystemeSombre] = useState(() => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);

  useEffect(() => {
    lirePreference("theme", "systeme")
      .then(setChoix)
      .catch(() => {});
    const requete = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    const suivre = (e) => setSystemeSombre(e.matches);
    requete?.addEventListener?.("change", suivre);
    return () => requete?.removeEventListener?.("change", suivre);
  }, []);

  const effectif = choix === "systeme" ? (systemeSombre ? "sombre" : "clair") : choix;
  useEffect(() => {
    document.documentElement.classList.toggle("clair", effectif === "clair");
  }, [effectif]);

  const changer = useCallback((valeur) => {
    setChoix(valeur);
    ecrirePreference("theme", valeur).catch(() => {});
  }, []);

  return { choix, effectif, changer };
}

export default function App() {
  const [vue, setVue] = useState({ page: "accueil", onglet: null, siteId: null });
  const [tiroir, setTiroir] = useState(null);
  const [palette, setPalette] = useState(false);
  const [sites, setSites] = useState([]);
  const [etats, setEtats] = useState([]);
  const [echecs, setEchecs] = useState([]);
  const [echeances, setEcheances] = useState([]);
  const [connecteurs, setConnecteurs] = useState([]);
  const [cheminBase, setCheminBase] = useState("");
  const [verificationEnCours, setVerificationEnCours] = useState(false);
  const [intervalleS, setIntervalleS] = useState(INTERVALLE_DEFAUT_S);
  // Incremente a chaque ecriture en base : force les ecrans a se recalculer
  const [revision, setRevision] = useState(0);
  const theme = useTheme();

  const signalerModification = useCallback(() => setRevision((r) => r + 1), []);

  const verifier = useCallback(async () => {
    setVerificationEnCours(true);
    try {
      const resultat = await lancerCycle();
      tracer("supervision", resultat.ignore ? "cycle ignore: le précédent tourne encore" : `cycle termine: ${resultat.checks} check(s)`);
      // Un cycle ignore (le precedent tourne encore) n'a rien ecrit a relire
      if (!resultat.ignore) signalerModification();
    } catch (erreur) {
      // La supervision ne doit jamais faire tomber l'UI, mais un echec silencieux
      // serait pire : on trace avant d'avaler.
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

  // Sites, etat de supervision, checks en echec et prelevements proches : la
  // barre laterale et « A traiter » en dependent sur tous les ecrans.
  useEffect(() => {
    let annule = false;
    Promise.all([listerSites(), etatsDesSites(), checksEnEchec(), echeancesProches(7), lireConnecteurs()])
      .then(([s, e, k, ec, co]) => {
        if (annule) return;
        setSites(s);
        setEtats(e);
        setEchecs(k);
        setEcheances(ec);
        setConnecteurs(co);
      })
      .catch((e) => tracer("app", `lecture impossible: ${e}`));
    return () => {
      annule = true;
    };
  }, [revision]);

  // L'intervalle est une preference : relu a chaque modification, il prend
  // effet sans redemarrer l'application.
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
    // Synchronisation avec un systeme externe (les sites a interroger) : le
    // drapeau « en cours » doit se voir des le premier cycle.
    // oxlint-disable-next-line react/set-state-in-effect
    verifier();
    const minuterie = setInterval(verifier, intervalleS * 1000);
    return () => clearInterval(minuterie);
  }, [verifier, intervalleS]);

  // Connecteurs (Stripe, Anthropic...) : au lancement, puis chacun toutes les 6 h ;
  // on regarde toutes les 10 minutes lesquels sont dus.
  useEffect(() => {
    let annule = false;
    const passer = () =>
      synchroniserSiBesoin()
        .then((change) => change && !annule && signalerModification())
        .catch((e) => tracer("connecteurs", `synchronisation impossible: ${e}`));
    passer();
    const minuterie = setInterval(passer, 10 * 60_000);
    return () => {
      annule = true;
      clearInterval(minuterie);
    };
  }, [signalerModification]);

  // Le planning des taches bat a la minute, quel que soit l'intervalle de
  // supervision : avec des cycles de 30 min, une tache de 9 h partait a 9 h 08
  const [battement, setBattement] = useState(0);
  useEffect(() => {
    const minuterie = setInterval(() => setBattement((b) => b + 1), BATTEMENT_PLANNING_MS);
    return () => clearInterval(minuterie);
  }, []);

  // Les deux compteurs ne font que croitre : leur somme change a chaque battement comme a chaque ecriture
  const controles = useControles(revision + battement, signalerModification);
  const agents = useAgentsAttendus(revision, controles.controles, controles.derniers, controles.ajouts);
  const notifications = useNotifications(revision, agents.attendus);
  const miseAJour = useMiseAJour();

  // Statuts des agents, site par site : vue d'ensemble, liste des sites et fiche
  const vuesAgents = useMemo(
    () =>
      vueParSite({
        rapports: agents.rapports,
        attendus: agents.attendus,
        controles: controles.controles,
        sites,
        enCours: Object.values(controles.enCours).filter(Boolean),
      }),
    [agents.rapports, agents.attendus, controles.controles, controles.enCours, sites],
  );

  const aTraiter = useMemo(
    () => construireATraiter({ echecs, vuesAgents, echeances, connecteurs, aujourdhui: aujourdhuiIso() }),
    [echecs, vuesAgents, echeances, connecteurs],
  );

  // Pastille et infobulle de l'icone dans la barre des taches
  useEffect(() => {
    const { etat, infobulle } = etatBarre(etats, aTraiter);
    invoke("etat_barre", { etat, infobulle }).catch(() => {});
  }, [etats, aTraiter]);

  // « Verifier maintenant » depuis le menu de l'icone
  useEffect(() => {
    const arret = listen("barre:verifier", () => verifier());
    return () => {
      arret.then((f) => f()).catch(() => {});
    };
  }, [verifier]);

  const naviguer = useCallback((page, options = {}) => {
    setVue({ page, onglet: options.onglet ?? ONGLETS_DEFAUT[page] ?? null, siteId: options.siteId ?? null });
  }, []);
  const ouvrirSite = useCallback((siteId, onglet = "sante") => setVue({ page: "site", onglet, siteId }), []);

  const nouveau = useCallback((type) => {
    if (type === "depense" || type === "revenu") setTiroir({ type: "transaction", sens: type });
    else setTiroir({ type });
  }, []);

  // Raccourcis : Ctrl+K pour la palette, N pour une depense (hors saisie)
  useEffect(() => {
    const touche = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      const saisie = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
      if (!saisie && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n" && !tiroir && !palette) {
        e.preventDefault();
        nouveau("depense");
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [tiroir, palette, nouveau]);

  function actionPalette(item) {
    const [genre, valeur] = item.cle.split(":");
    if (genre === "nouveau") nouveau(valeur);
    else if (genre === "verifier") verifier();
    else if (genre === "theme") theme.changer(theme.effectif === "clair" ? "sombre" : "clair");
    else if (genre === "site") ouvrirSite(Number(valeur));
    else if (genre === "transaction") setTiroir({ type: "transaction", edition: item.transaction });
    else if (valeur === "abonnements") naviguer("finances", { onglet: "abonnements" });
    else if (valeur === "agents" || valeur === "connecteurs") naviguer("reglages", { onglet: valeur });
    else naviguer(valeur);
  }

  function ouvrirCible(cible) {
    if (cible.page === "site") ouvrirSite(cible.siteId, cible.onglet);
    else naviguer(cible.page, { onglet: cible.onglet });
  }

  const modifierTransaction = useCallback((ligne) => setTiroir({ type: "transaction", edition: ligne }), []);
  const site = vue.page === "site" ? sites.find((s) => s.id === vue.siteId) : null;
  const changerOnglet = (onglet) => setVue((v) => ({ ...v, onglet }));
  const nbAlertes = nbATraiter(aTraiter);

  let titre;
  let contenu;
  switch (vue.page) {
    case "site":
      titre = (
        <div className="flex items-center gap-1.5 text-[13px] text-texte-doux">
          <button type="button" onClick={() => naviguer("sites")} className="hover:text-texte">
            Sites
          </button>
          <ChevronRight size={14} />
          <span className="font-medium text-texte">{site?.nom}</span>
        </div>
      );
      contenu = site ? (
        <FicheSite
          key={site.id}
          site={site}
          etat={etats.find((e) => e.id === site.id) ?? null}
          onglet={vue.onglet}
          onChangerOnglet={changerOnglet}
          onRetour={() => naviguer("sites")}
          onVerifierMaintenant={verifier}
          verificationEnCours={verificationEnCours}
          rafraichissement={revision}
          vueAgents={vuesAgents.find((v) => v.siteId === site.id) ?? null}
          controles={controles}
          erreurAgents={agents.erreur}
          sites={sites}
          onModifierTransaction={modifierTransaction}
          onModification={signalerModification}
        />
      ) : null;
      break;
    case "sites":
      titre = <TitrePage titre="Sites" sousTitre={`${etats.length} suivi(s)`} />;
      contenu = (
        <ListeSites rafraichissement={revision} etats={etats} vuesAgents={vuesAgents} onOuvrirSite={ouvrirSite} onNouveau={() => nouveau("site")} />
      );
      break;
    case "finances":
      titre = (
        <TitrePage titre="Finances">
          <SousOnglets
            valeur={vue.onglet}
            onChanger={changerOnglet}
            options={[
              { cle: "transactions", libelle: "Transactions" },
              { cle: "abonnements", libelle: "Abonnements" },
            ]}
          />
        </TitrePage>
      );
      contenu =
        vue.onglet === "abonnements" ? (
          <Abonnements rafraichissement={revision} onModifier={(a) => setTiroir({ type: "abonnement", edition: a })} onModification={signalerModification} />
        ) : (
          <Transactions rafraichissement={revision} sites={sites} onModifier={modifierTransaction} onModification={signalerModification} />
        );
      break;
    case "reglages":
      titre = (
        <TitrePage titre="Réglages">
          <SousOnglets
            valeur={vue.onglet}
            onChanger={changerOnglet}
            options={[
              { cle: "general", libelle: "Général" },
              { cle: "connecteurs", libelle: "Connecteurs" },
              { cle: "agents", libelle: "Agents" },
            ]}
          />
        </TitrePage>
      );
      contenu =
        vue.onglet === "connecteurs" ? (
          <Connecteurs rafraichissement={revision} onModification={signalerModification} />
        ) : vue.onglet === "agents" ? (
          <Agents sites={sites} configTrouvee={agents.configTrouvee} dossierRapports={agents.dossier} controles={controles} />
        ) : (
          <Preferences
            onModification={signalerModification}
            cheminBase={cheminBase}
            miseAJour={miseAJour}
            theme={theme.choix}
            onChangerTheme={theme.changer}
          />
        );
      break;
    default: {
      const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
      titre = (
        <TitrePage
          titre="Vue d'ensemble"
          sousTitre={`${date.charAt(0).toUpperCase()}${date.slice(1)} · ${nbAlertes === 0 ? "tout est au vert" : `${nbAlertes} point(s) à traiter`}`}
        />
      );
      contenu = (
        <Accueil
          rafraichissement={revision}
          sites={etats}
          aTraiter={aTraiter}
          onOuvrirCible={ouvrirCible}
          onOuvrirSite={ouvrirSite}
          onNaviguer={naviguer}
        />
      );
    }
  }

  return (
    <>
      <Coquille
        page={vue.page === "site" ? "sites" : vue.page}
        siteActif={vue.page === "site" ? vue.siteId : null}
        titre={titre}
        sites={etats}
        aTraiter={nbAlertes}
        miseAJour={resumeMiseAJour(miseAJour.etat)}
        verificationEnCours={verificationEnCours}
        intervalleS={intervalleS}
        theme={theme.effectif}
        onBasculerTheme={() => theme.changer(theme.effectif === "clair" ? "sombre" : "clair")}
        onNaviguer={naviguer}
        onOuvrirSite={ouvrirSite}
        onNouveau={nouveau}
        onPalette={() => setPalette(true)}
        bandeau={
          notifications.bloqueesParWindows && (
            <p className="flex items-center gap-2 border-b border-alerte/30 bg-alerte/10 px-8 py-2 text-xs text-texte">
              <TriangleAlert size={14} className="shrink-0 text-alerte" />
              Notifications coupées dans Windows : aucune alerte ne s&apos;affichera. Rallume-les dans Paramètres › Système › Notifications.
            </p>
          )
        }
      >
        {contenu}
      </Coquille>

      {/* Montes seulement quand ils s'ouvrent : chaque ouverture repart d'une saisie vierge */}
      {tiroir?.type === "transaction" && (
        <TiroirTransaction
          ouvert
          sens={tiroir?.sens ?? "depense"}
          edition={tiroir?.edition ?? null}
          siteIdParDefaut={vue.page === "site" ? vue.siteId : null}
          onFermer={() => setTiroir(null)}
          onEnregistre={signalerModification}
        />
      )}
      {tiroir?.type === "abonnement" && (
        <TiroirAbonnement
          ouvert
          edition={tiroir?.edition ?? null}
          onFermer={() => setTiroir(null)}
          onEnregistre={signalerModification}
        />
      )}
      {tiroir?.type === "site" && (
        <TiroirSite
          ouvert
          onFermer={() => setTiroir(null)}
          onCree={(id, details) => {
            signalerModification();
            if (id && !details?.icone) ouvrirSite(id);
          }}
        />
      )}
      {palette && <Palette ouvert onFermer={() => setPalette(false)} sites={sites.filter((s) => s.actif)} onAction={actionPalette} />}
    </>
  );
}
