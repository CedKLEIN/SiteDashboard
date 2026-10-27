import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CircleCheck, CircleX, Pencil, Plug, RefreshCw, Unplug } from "lucide-react";
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

/** Saisie des cles et des sites d'un connecteur. Les cles ne sont jamais reaffichees. */
function TiroirConnecteur({ def, config, sites, onFermer, onEnregistre }) {
  const [cles, setCles] = useState({});
  const [siteIds, setSiteIds] = useState(config?.siteIds ?? []);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer(e) {
    e?.preventDefault();
    setErreur("");
    const remplies = Object.fromEntries(Object.entries(cles).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    if (!config && def.champs.some((c) => !remplies[c.cle])) {
      setErreur("Renseigne toutes les clés.");
      return;
    }
    setEnvoi(true);
    try {
      if (Object.keys(remplies).length > 0) {
        const anciens = config ? ((await invoke("secrets_connecteurs"))?.[def.type] ?? {}) : {};
        await invoke("enregistrer_secret_connecteur", { id: def.type, secret: { ...anciens, ...remplies } });
      }
      const liste = await lireConnecteurs();
      const suivant = { ...(config ?? { id: def.type, type: def.type, actif: true }), nom: def.nom, siteIds };
      await ecrireConnecteurs([...liste.filter((c) => c.id !== def.type), suivant]);
      onEnregistre(true);
      onFermer();
    } catch (e2) {
      setErreur(String(e2?.message ?? e2));
      setEnvoi(false);
    }
  }

  return (
    <Tiroir
      titre={config ? `${def.nom} : réglages` : `Connecter ${def.nom}`}
      ouvert
      onFermer={onFermer}
      largeur="w-[460px]"
      pied={
        <>
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton onClick={enregistrer} disabled={envoi}>
            {config ? "Enregistrer" : "Connecter et synchroniser"}
          </Bouton>
        </>
      }
    >
      <form onSubmit={enregistrer} className="flex flex-col gap-5">
        <p className="text-[13px] text-texte-doux">{def.description}</p>
        {def.champs.map((champ) => (
          <div key={champ.cle} className="flex flex-col gap-1.5">
            <Champ
              label={champ.libelle}
              type="password"
              autoComplete="off"
              placeholder={config ? "•••••••• enregistrée — laisser vide pour la garder" : ""}
              value={cles[champ.cle] ?? ""}
              onChange={(e) => setCles((c) => ({ ...c, [champ.cle]: e.target.value }))}
            />
            {champ.aide && <span className="text-[11px] text-pale">{champ.aide}</span>}
          </div>
        ))}
        <SelecteurSites
          label="Rattacher aux sites"
          sites={sites}
          selection={siteIds}
          onBasculer={(id) => setSiteIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
          aide={siteIds.length ? "Montants répartis à parts égales entre ces sites" : "Aucun site : coût ou revenu transverse"}
        />
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-texte-doux">
          Les clés restent sur cet ordinateur, dans %USERPROFILE%\.sitedashboard\connecteurs.json : jamais dans la base ni dans
          ses sauvegardes. Une clé en lecture seule suffit.
        </p>
        {erreur && <p className="rounded-lg bg-ko/10 px-3 py-2 text-xs text-ko">{erreur}</p>}
        <button type="submit" hidden aria-hidden="true" />
      </form>
    </Tiroir>
  );
}

/**
 * Reglages › Connecteurs : Stripe, Anthropic, OpenAI, OVH importent revenus et
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
                        <span className="text-ko">{resultat.message}</span>
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
          onEnregistre={async () => {
            const nouveau = !configs.some((c) => c.id === edition.type);
            const id = edition.type;
            onModification();
            // Premiere connexion : on synchronise tout de suite, pour verifier la cle
            if (nouveau) await synchroniser(id);
          }}
        />
      )}
    </>
  );
}
