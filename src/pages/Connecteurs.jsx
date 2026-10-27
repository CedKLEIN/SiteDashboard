import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleCheck, CircleX, ClipboardCopy, ClipboardPaste, ExternalLink, Loader, LogIn, Pencil, Plug, RefreshCw, Unplug } from "lucide-react";
import { Bouton, Carte, Champ, Interrupteur, MenuActions, SelecteurSites, Tiroir } from "../components/ui";
import { CONNECTEURS } from "../lib/connecteurs/definitions";
import { ecrireConnecteurs, lireConnecteurs, synchroniserEtEnregistrer } from "../lib/connecteurs/moteur";
import { listerSites } from "../lib/queries";

/** « il y a 5 min », « il y a 3 h », « le 12/10 ». */
function depuis(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 48 * 60) return `il y a ${Math.round(minutes / 60)} h`;
  return `le ${new Date(iso).toLocaleDateString("fr-FR")}`;
}

/**
 * Copie l'etat de la connexion Anthropic (`ant auth status` : organisation,
 * droits accordes) et l'erreur : de quoi comprendre un refus en un collage.
 */
function CopierEtatAnthropic({ erreur }) {
  const [etat, setEtat] = useState(null);
  async function copier() {
    let statut;
    try {
      statut = await invoke("ant_statut");
    } catch (e) {
      statut = `ant auth status impossible : ${e}`;
    }
    try {
      await writeText(`=== Connecteur Anthropic ===\nErreur : ${erreur}\n\n--- ant auth status ---\n${statut}`);
      setEtat("Copié !");
    } catch (e) {
      setEtat(`Impossible : ${e}`);
    }
    setTimeout(() => setEtat(null), 2500);
  }
  return (
    <Bouton variante="fantome" className="mt-2 flex items-center gap-1.5 self-start text-xs" onClick={copier}>
      <ClipboardCopy size={13} />
      {etat ?? "Copier l'état de la connexion"}
    </Bouton>
  );
}

/** Une etape numerotee du panneau de connexion. */
function Etape({ numero, titre, children }) {
  return (
    <div className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent-2">{numero}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-[13px] font-medium">{titre}</p>
        {children}
      </div>
    </div>
  );
}

/** Connexion Anthropic par le navigateur : installe l'outil ant si besoin, puis ouvre la page de connexion. */
function ConnexionNavigateur({ onConnecte }) {
  const [etape, setEtape] = useState(null);
  const [erreur, setErreur] = useState("");

  async function connecter() {
    setErreur("");
    try {
      setEtape("Vérification de l'outil Anthropic…");
      const etat = await invoke("ant_etat");
      if (!etat.installe) {
        setEtape("Installation de l'outil Anthropic (une seule fois)…");
        await invoke("ant_installer");
      }
      setEtape("Valide la connexion dans ton navigateur…");
      await invoke("ant_connexion");
      setEtape(null);
      await onConnecte();
    } catch (e) {
      setEtape(null);
      setErreur(String(e?.message ?? e));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-accent/8 p-4 ring-1 ring-accent/25">
      <p className="text-[13px] font-medium">Le plus simple : se connecter</p>
      <p className="text-xs text-texte-doux">
        Une page Anthropic s&apos;ouvre dans ton navigateur : connecte-toi et accepte. Pas de clé à créer ni à copier. Il faut être
        administrateur de l&apos;organisation.
      </p>
      <Bouton className="mt-1 flex items-center justify-center gap-2 self-start" onClick={connecter} disabled={Boolean(etape)}>
        {etape ? <Loader size={14} className="animate-spin" /> : <LogIn size={14} />}
        {etape ?? "Se connecter avec Anthropic"}
      </Bouton>
      {erreur && (
        <p className="rounded-lg bg-ko/10 px-3 py-2 text-xs text-ko">
          {erreur}
          <span className="mt-1 block text-texte-doux">Tu peux aussi coller une clé Admin ci-dessous.</span>
        </p>
      )}
    </div>
  );
}

/**
 * Connexion d'un service, en etapes : ouvrir la bonne page, copier la cle (elle
 * est detectee dans le presse-papiers des qu'on revient), choisir les sites,
 * connecter — la premiere synchronisation tourne ici et dit tout de suite si
 * c'est bon. Les cles enregistrees ne sont jamais reaffichees.
 */
function TiroirConnecteur({ def, config, sites, onFermer, onEnregistre }) {
  const [cles, setCles] = useState({});
  const [detectee, setDetectee] = useState(false);
  const [siteIds, setSiteIds] = useState(config?.siteIds ?? []);
  const [erreur, setErreur] = useState("");
  const [resultat, setResultat] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const champUnique = def.champs.length === 1 ? def.champs[0] : null;

  // La cle copiee dans le navigateur arrive toute seule quand on revient sur l'appli
  useEffect(() => {
    if (!champUnique?.format) return undefined;
    const lire = async () => {
      try {
        const texte = String((await readText()) ?? "").trim();
        if (champUnique.format.test(texte)) {
          setCles((c) => (c[champUnique.cle] ? c : { ...c, [champUnique.cle]: texte }));
          setDetectee(true);
        }
      } catch {
        // presse-papiers vide ou illisible : rien a faire
      }
    };
    lire();
    window.addEventListener("focus", lire);
    return () => window.removeEventListener("focus", lire);
  }, [champUnique]);

  async function coller(champ) {
    try {
      const texte = String((await readText()) ?? "").trim();
      if (texte) setCles((c) => ({ ...c, [champ.cle]: texte }));
    } catch {
      setErreur("Presse-papiers illisible : colle la clé avec Ctrl+V.");
    }
  }

  /** Enregistre (cles, sites) puis synchronise ; reste ouvert si ca echoue. */
  async function connecter(secret = null) {
    setErreur("");
    setResultat(null);
    const remplies = Object.fromEntries(Object.entries(cles).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    if (!secret && !config && def.champs.some((c) => !remplies[c.cle])) {
      setErreur(def.navigateur ? "Connecte-toi avec le bouton ci-dessus, ou colle une clé Admin." : "Colle la clé pour continuer.");
      return;
    }
    const malFormee = def.champs.find((c) => remplies[c.cle] && c.format && !c.format.test(remplies[c.cle]));
    if (malFormee) {
      setErreur(`Ça ne ressemble pas à une ${malFormee.libelle.toLowerCase()} (${malFormee.exemple}). Vérifie que tu as copié la bonne.`);
      return;
    }
    setEnvoi(true);
    try {
      if (secret) {
        await invoke("enregistrer_secret_connecteur", { id: def.type, secret });
      } else if (Object.keys(remplies).length > 0) {
        const anciens = config ? ((await invoke("secrets_connecteurs"))?.[def.type] ?? {}) : {};
        // Une cle collee remplace la connexion par le navigateur
        const { mode: _mode, ...sansMode } = anciens;
        await invoke("enregistrer_secret_connecteur", { id: def.type, secret: { ...sansMode, ...remplies } });
      }
      const liste = await lireConnecteurs();
      const suivant = { ...(config ?? { id: def.type, type: def.type, actif: true }), nom: def.nom, siteIds };
      await ecrireConnecteurs([...liste.filter((c) => c.id !== def.type), suivant]);
      const r = await synchroniserEtEnregistrer(def.type);
      onEnregistre();
      if (r && !r.ok) {
        setErreur(r.message);
        setEnvoi(false);
        return;
      }
      setResultat(r?.message ?? "Connecté");
      setTimeout(onFermer, 1500);
    } catch (e) {
      setErreur(String(e?.message ?? e));
      setEnvoi(false);
    }
  }

  return (
    <Tiroir
      titre={config ? `${def.nom} : réglages` : `Connecter ${def.nom}`}
      ouvert
      onFermer={onFermer}
      largeur="w-[480px]"
      pied={
        <>
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton onClick={() => connecter()} disabled={envoi}>
            {envoi ? "Connexion…" : config ? "Enregistrer" : "Connecter"}
          </Bouton>
        </>
      }
    >
      <p className="text-[13px] text-texte-doux">{def.description}</p>

      {def.navigateur && <ConnexionNavigateur onConnecte={() => connecter({ mode: "ant" })} />}

      <div className="flex flex-col gap-5">
        {def.navigateur && <p className="text-xs font-medium tracking-wider text-pale uppercase">Ou avec une clé</p>}
        {def.lien && (
          <Etape numero={1} titre="Ouvre la page de création de clé">
            <Bouton variante="fantome" className="flex items-center gap-1.5 self-start text-xs" onClick={() => openUrl(def.lien).catch(() => {})}>
              <ExternalLink size={13} />
              Ouvrir {new URL(def.lien).hostname}
            </Bouton>
            {def.etapes && (
              <ul className="flex flex-col gap-1 text-xs text-texte-doux">
                {def.etapes.map((e) => (
                  <li key={e} className="flex gap-1.5">
                    <span className="text-pale">•</span>
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </Etape>
        )}
        <Etape numero={def.lien ? 2 : 1} titre={champUnique ? "Colle la clé" : "Colle les clés"}>
          {def.champs.map((champ) => {
            const valeur = cles[champ.cle] ?? "";
            const valide = valeur && champ.format?.test(valeur.trim());
            return (
              <div key={champ.cle} className="flex flex-col gap-1">
                <div className="flex items-end gap-2">
                  <Champ
                    label={champ.libelle}
                    type="password"
                    autoComplete="off"
                    className="flex-1"
                    placeholder={config ? "•••••••• enregistrée — vide pour la garder" : champ.exemple}
                    value={valeur}
                    onChange={(e) => setCles((c) => ({ ...c, [champ.cle]: e.target.value }))}
                  />
                  <Bouton variante="fantome" className="flex items-center gap-1.5 text-xs" onClick={() => coller(champ)} title="Coller depuis le presse-papiers">
                    <ClipboardPaste size={13} />
                    Coller
                  </Bouton>
                </div>
                {valide && (
                  <span className="flex items-center gap-1 text-[11px] text-ok">
                    <CircleCheck size={12} />
                    {detectee ? "Clé détectée dans le presse-papiers" : "Format reconnu"}
                  </span>
                )}
              </div>
            );
          })}
        </Etape>
        <Etape numero={def.lien ? 3 : 2} titre="Rattache-le à des sites (facultatif)">
          <SelecteurSites
            label=""
            sites={sites}
            selection={siteIds}
            onBasculer={(id) => setSiteIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
            aide={siteIds.length ? "Montants répartis à parts égales entre ces sites" : "Aucun site : coût ou revenu transverse"}
          />
        </Etape>
      </div>

      <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-texte-doux">
        Les clés restent sur cet ordinateur (%USERPROFILE%\.sitedashboard\connecteurs.json), jamais dans la base ni dans ses
        sauvegardes. Lecture seule suffit.
      </p>
      {erreur && (
        <div className="flex flex-col rounded-lg bg-ko/10 px-3 py-2 text-xs text-ko">
          {erreur}
          {def.navigateur && <CopierEtatAnthropic erreur={erreur} />}
        </div>
      )}
      {resultat && (
        <p className="flex items-center gap-2 rounded-lg bg-ok/10 px-3 py-2 text-xs text-ok">
          <CircleCheck size={14} />
          Connecté : {resultat}
        </p>
      )}
    </Tiroir>
  );
}

/**
 * Reglages › Connecteurs : Stripe, Anthropic et OpenAI importent revenus et
 * depenses tout seuls, toutes les 6 heures, sans doublon.
 */
export default function Connecteurs({ rafraichissement, onModification }) {
  const [configs, setConfigs] = useState([]);
  const [sites, setSites] = useState([]);
  const [edition, setEdition] = useState(null);
  const [enCours, setEnCours] = useState({});

  useEffect(() => {
    let annule = false;
    Promise.all([lireConnecteurs(), listerSites()]).then(([c, s]) => {
      if (annule) return;
      setConfigs(c);
      setSites(s.filter((x) => x.actif));
    });
    return () => {
      annule = true;
    };
  }, [rafraichissement]);

  async function synchroniser(id) {
    setEnCours((e) => ({ ...e, [id]: true }));
    await synchroniserEtEnregistrer(id);
    setEnCours((e) => ({ ...e, [id]: false }));
    onModification();
  }

  async function modifier(id, changement) {
    const liste = await lireConnecteurs();
    await ecrireConnecteurs(liste.map((c) => (c.id === id ? { ...c, ...changement } : c)));
    onModification();
  }

  async function deconnecter(def) {
    if (!window.confirm(`Déconnecter ${def.nom} ? Ses clés sont oubliées ; ce qu'il a déjà importé reste.`)) return;
    await invoke("enregistrer_secret_connecteur", { id: def.type, secret: null }).catch(() => {});
    await ecrireConnecteurs((await lireConnecteurs()).filter((c) => c.id !== def.type));
    onModification();
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        {CONNECTEURS.map((def) => {
          const config = configs.find((c) => c.id === def.type);
          const resultat = config?.dernierResultat;
          const tourne = enCours[def.type];
          const nomsSites = (config?.siteIds ?? []).map((id) => sites.find((s) => s.id === id)?.nom).filter(Boolean);
          return (
            <Carte key={def.type} className={config && !config.actif ? "opacity-70" : ""}>
              <div className="flex items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl text-base font-bold text-white" style={{ background: def.couleur }}>
                  {def.nom.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-semibold">{def.nom}</h2>
                    {config && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${config.actif ? "bg-ok/12 text-ok" : "bg-surface-3 text-texte-doux"}`}>
                        {config.actif ? "Connecté" : "En pause"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-texte-doux">{def.description}</p>
                </div>
                {config && (
                  <MenuActions
                    actions={[
                      { libelle: "Modifier les clés et les sites", Icone: Pencil, onClick: () => setEdition(def) },
                      { libelle: "Déconnecter", Icone: Unplug, onClick: () => deconnecter(def), danger: true, separe: true },
                    ]}
                  />
                )}
              </div>

              {config ? (
                <div className="mt-4 flex flex-col gap-3 border-t border-bord pt-4">
                  <p className="flex items-center gap-2 text-xs">
                    {!resultat ? (
                      <span className="text-texte-doux">Jamais synchronisé</span>
                    ) : resultat.ok ? (
                      <>
                        <CircleCheck size={14} className="shrink-0 text-ok" />
                        <span className="text-texte-doux">
                          {resultat.message} · {depuis(resultat.le)}
                        </span>
                      </>
                    ) : (
                      <>
                        <CircleX size={14} className="shrink-0 text-ko" />
                        <span className="text-ko">
                          {resultat.message}
                          {def.navigateur && <CopierEtatAnthropic erreur={resultat.message} />}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="text-xs text-pale">{nomsSites.length ? `Rattaché à ${nomsSites.join(", ")}` : "Transverse (aucun site)"}</p>
                  <div className="flex items-center justify-between gap-3">
                    <Interrupteur actif={Boolean(config.actif)} onChanger={(actif) => modifier(def.type, { actif })} className="text-xs text-texte-doux">
                      Synchroniser toutes les 6 h
                    </Interrupteur>
                    <Bouton variante="fantome" className="flex items-center gap-1.5 text-xs" disabled={tourne} onClick={() => synchroniser(def.type)}>
                      <RefreshCw size={13} className={tourne ? "animate-spin" : ""} />
                      {tourne ? "Synchronisation…" : "Synchroniser"}
                    </Bouton>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex justify-end border-t border-bord pt-4">
                  <Bouton className="flex items-center gap-1.5" onClick={() => setEdition(def)}>
                    <Plug size={14} />
                    Connecter
                  </Bouton>
                </div>
              )}
            </Carte>
          );
        })}
      </div>

      {edition && (
        <TiroirConnecteur
          def={edition}
          config={configs.find((c) => c.id === edition.type) ?? null}
          sites={sites}
          onFermer={() => setEdition(null)}
          onEnregistre={onModification}
        />
      )}
    </>
  );
}
