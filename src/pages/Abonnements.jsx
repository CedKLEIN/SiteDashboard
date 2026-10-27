import { Fragment, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Calendar, CircleCheck, Clock, History, Image as ImageIcon, Pencil, Play, Receipt, Repeat, Square, Trash2 } from "lucide-react";
import { Bouton, Carte, Champ, EtatVide, Kpi, MenuActions, Segments } from "../components/ui";
import HistoriqueTarifs from "../components/HistoriqueTarifs";
import {
  arreterAbonnement,
  listerAbonnements,
  listerSites,
  listerTarifs,
  majFaviconFournisseur,
  reprendreAbonnement,
  restaurer,
  supprimerAnnulable,
} from "../lib/queries";
import { useSuppressionAnnulable } from "../components/Toasts";
import { choisirImageLocale } from "../lib/icones";
import { coutMensuelEquivalent, echeanceSuivante, totalPaye } from "../lib/abonnements";
import { aujourdhuiIso, dateFr, formatMontant } from "../lib/format";

const FILTRES = [
  { cle: "actifs", libelle: "Actifs" },
  { cle: "arretes", libelle: "Arrêtés" },
  { cle: "tous", libelle: "Tous" },
];

/** Jours entre deux dates ISO. */
function joursEntre(de, a) {
  const [y1, m1, d1] = de.split("-").map(Number);
  const [y2, m2, d2] = a.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Icone du fournisseur, sinon son initiale. */
function IconeFournisseur({ abonnement, taille = 40 }) {
  if (abonnement.fournisseur_favicon) {
    return (
      <img
        src={abonnement.fournisseur_favicon}
        alt=""
        aria-hidden="true"
        style={{ width: taille, height: taille }}
        className="shrink-0 rounded-xl bg-surface-2 object-contain p-2 ring-1 ring-bord"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: taille, height: taille }}
      className="grid shrink-0 place-items-center rounded-xl bg-abonnement/12 text-sm font-bold text-abonnement"
    >
      {(abonnement.fournisseur_nom ?? abonnement.libelle).charAt(0).toUpperCase()}
    </span>
  );
}

/** Les prelevements des 30 prochains jours, sur une ligne de temps. */
function Frise({ abonnements, aujourdhui }) {
  const parJour = new Map();
  for (const a of abonnements) {
    const date = echeanceSuivante(a, aujourdhui);
    if (!date) continue;
    const jours = joursEntre(aujourdhui, date);
    if (jours < 0 || jours > 30) continue;
    if (!parJour.has(date)) parJour.set(date, { date, jours, libelles: [], montant: 0 });
    const j = parJour.get(date);
    j.libelles.push(a.libelle);
    j.montant += a.montant_cents ?? 0;
  }
  const points = [...parJour.values()].sort((x, y) => x.date.localeCompare(y.date));
  if (points.length === 0) return <EtatVide>Aucun prélèvement dans les 30 prochains jours.</EtatVide>;
  const total = points.reduce((t, p) => t + p.montant, 0);
  return (
    <>
      <div className="relative mx-10 h-20">
        <div className="absolute inset-x-0 top-[38px] h-px bg-bord" />
        <span className="absolute top-[32px] -left-1 size-3 rounded-full bg-accent ring-4 ring-accent/20" title="Aujourd'hui" />
        {points.map((p) => (
          <div
            key={p.date}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
            style={{ left: `${Math.max(3, (p.jours / 30) * 100)}%` }}
            title={`${dateFr(p.date)} : ${p.libelles.join(", ")}`}
          >
            <span className="chiffres text-[11px] font-semibold whitespace-nowrap">{formatMontant(p.montant)}</span>
            <span className="my-1.5 size-3 rounded-full bg-abonnement ring-4 ring-abonnement/20" />
            <span className="max-w-32 truncate text-[11px] text-texte-doux">{p.libelles.join(" · ")}</span>
            <span className="text-[10px] text-pale">{p.jours === 0 ? "aujourd'hui" : `J-${p.jours}`}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-right text-xs text-texte-doux">
        Total sur 30 jours : <span className="chiffres font-semibold text-texte">{formatMontant(total)}</span>
      </p>
    </>
  );
}

export default function Abonnements({ rafraichissement, onModifier, onModification }) {
  const [abonnements, setAbonnements] = useState([]);
  const [tarifs, setTarifs] = useState([]);
  const [sites, setSites] = useState([]);
  const [filtre, setFiltre] = useState("actifs");
  const [historiqueOuvert, setHistoriqueOuvert] = useState(null);
  const [arret, setArret] = useState(null);
  const [erreur, setErreur] = useState("");
  const supprimerAvecAnnulation = useSuppressionAnnulable(onModification);

  async function recharger() {
    try {
      const [a, t, s] = await Promise.all([listerAbonnements(), listerTarifs(), listerSites()]);
      setAbonnements(a);
      setTarifs(t);
      setSites(s);
    } catch (e) {
      setErreur(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    recharger();
  }, [rafraichissement]);

  /** Une action, puis rechargement et signal aux autres ecrans ; l'erreur s'affiche. */
  async function agir(action) {
    setErreur("");
    try {
      await action();
      onModification?.();
    } catch (e) {
      setErreur(String(e?.message ?? e));
    }
  }

  async function iconeFournisseur(abonnement) {
    if (!abonnement.fournisseur_id) {
      setErreur(`« ${abonnement.libelle} » n'a pas de fournisseur : renseigne-le d'abord (Modifier).`);
      return;
    }
    await agir(async () => {
      const favicon = abonnement.fournisseur_url
        ? await invoke("recuperer_favicon", { url: abonnement.fournisseur_url }).catch(() => null)
        : null;
      const image = favicon ?? (await choisirImageLocale());
      // Selection annulee : on ne touche a rien
      if (image) await majFaviconFournisseur(abonnement.fournisseur_id, image);
    });
  }

  // Sans confirmation : tarifs et parts compris, tout revient avec « Annuler »
  function supprimer(abonnement) {
    supprimerAvecAnnulation(`Abonnement « ${abonnement.libelle} » supprimé`, () => supprimerAnnulable("abonnements", abonnement.id), restaurer);
  }

  const aujourdhui = aujourdhuiIso();
  const tarifsDe = (id) => tarifs.filter((t) => t.abonnement_id === id);
  const actifs = abonnements.filter((a) => a.actif);
  const mensuel = actifs.reduce((t, a) => t + coutMensuelEquivalent(a), 0);
  // Cumul sur TOUS les abonnements, resilies compris : ce qui a ete paye l'a ete
  const dejaPaye = abonnements.reduce((t, a) => t + totalPaye(a, tarifsDe(a.id), aujourdhui), 0);
  const affiches = abonnements.filter((a) => (filtre === "actifs" ? a.actif : filtre === "arretes" ? !a.actif : true));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi libelle="Par mois" valeur={formatMontant(mensuel)} ton="abonnement" Icone={Repeat} />
        <Kpi libelle="Par an" valeur={formatMontant(mensuel * 12)} ton="abonnement" Icone={Calendar} detail="au tarif actuel" />
        <Kpi libelle="Total déjà payé" valeur={formatMontant(dejaPaye)} ton="depense" Icone={Receipt} detail="depuis la première échéance" />
        <Kpi libelle="Actifs" valeur={String(actifs.length)} Icone={CircleCheck} detail={`${abonnements.length - actifs.length} arrêté(s)`} />
      </div>

      <Carte titre="Les 30 prochains jours">
        <Frise abonnements={actifs} aujourdhui={aujourdhui} />
      </Carte>

      {erreur && <p className="rounded-lg bg-ko/10 px-3 py-2 text-xs text-ko">{erreur}</p>}

      <Carte sansMarge titre={`${affiches.length} abonnement(s)`} action={<Segments options={FILTRES} valeur={filtre} onChanger={setFiltre} />}>
        {affiches.length === 0 ? (
          <EtatVide Icone={Repeat}>Aucun abonnement ici.</EtatVide>
        ) : (
          affiches.map((a) => {
            const sesTarifs = tarifsDe(a.id);
            const prochaine = a.actif ? echeanceSuivante(a, aujourdhui) : null;
            const jours = prochaine ? joursEntre(aujourdhui, prochaine) : null;
            const sesSites = (a.sites_noms ?? "").split(" + ").filter(Boolean);
            return (
              <Fragment key={a.id}>
                <div
                  className={`flex cursor-pointer items-center gap-4 border-t border-bord/70 px-5 py-3.5 transition hover:bg-surface-2/50 ${a.actif ? "" : "opacity-60"}`}
                  onClick={() => onModifier(a)}
                >
                  <IconeFournisseur abonnement={a} />
                  <span className="w-52 min-w-0">
                    <span className="flex items-center gap-2 text-[13px] font-semibold">
                      <span className="truncate">{a.libelle}</span>
                      {a.fin && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-normal text-texte-doux">Arrêté le {dateFr(a.fin)}</span>}
                    </span>
                    <span className="block truncate text-xs text-pale">{a.fournisseur_nom ?? "—"}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {sesSites.length === 0 ? (
                      <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-pale">Transverse</span>
                    ) : (
                      sesSites.map((nom) => (
                        <span key={nom} className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-texte-doux">
                          <span className="size-1.5 rounded-full" style={{ background: sites.find((s) => s.nom === nom)?.couleur ?? "var(--color-pale)" }} />
                          {nom}
                        </span>
                      ))
                    )}
                  </span>
                  <span className="w-32 shrink-0 text-xs">
                    {prochaine ? (
                      <span className={`flex items-center gap-1 font-medium ${jours <= 7 ? "text-alerte" : "text-texte-doux"}`} title={dateFr(prochaine)}>
                        <Clock size={12} />
                        {jours === 0 ? "aujourd'hui" : jours <= 31 ? `dans ${jours} j` : dateFr(prochaine)}
                      </span>
                    ) : (
                      <span className="text-pale">—</span>
                    )}
                  </span>
                  <span className="w-36 shrink-0 text-right">
                    <span className="chiffres block text-[13px] font-semibold">
                      {formatMontant(a.montant_cents, a.devise)}
                      <span className="font-normal text-pale"> /{a.periodicite === "annuel" ? "an" : "mois"}</span>
                    </span>
                    <span className="block text-[11px] text-pale">
                      {formatMontant(totalPaye(a, sesTarifs, aujourdhui))} payés{sesTarifs.length > 1 ? ` · ${sesTarifs.length} tarifs` : ""}
                    </span>
                  </span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <MenuActions
                      actions={[
                        { libelle: "Modifier", Icone: Pencil, onClick: () => onModifier(a) },
                        { libelle: "Historique des tarifs", Icone: History, onClick: () => setHistoriqueOuvert(historiqueOuvert === a.id ? null : a.id) },
                        { libelle: "Changer l'icône", Icone: ImageIcon, onClick: () => iconeFournisseur(a) },
                        a.fin
                          ? { libelle: "Reprendre", Icone: Play, onClick: () => agir(() => reprendreAbonnement(a.id)) }
                          : { libelle: "Arrêter l'abonnement", Icone: Square, onClick: () => setArret({ id: a.id, date: aujourdhuiIso() }) },
                        { libelle: "Supprimer", Icone: Trash2, onClick: () => supprimer(a), danger: true, separe: true },
                      ]}
                    />
                  </span>
                </div>

                {arret?.id === a.id && (
                  <div className="flex flex-wrap items-end gap-3 border-t border-bord/70 bg-surface-2/40 px-5 py-3">
                    <Champ
                      label="Arrêter à partir du"
                      type="date"
                      value={arret.date}
                      onChange={(e) => setArret((x) => ({ ...x, date: e.target.value }))}
                      className="w-44"
                    />
                    <Bouton
                      disabled={!arret.date}
                      onClick={() =>
                        agir(async () => {
                          await arreterAbonnement(a.id, arret.date);
                          setArret(null);
                        })
                      }
                    >
                      Arrêter
                    </Bouton>
                    <Bouton variante="fantome" onClick={() => setArret(null)}>
                      Annuler
                    </Bouton>
                    <p className="text-xs text-pale">Les paiements avant cette date restent comptés.</p>
                  </div>
                )}

                {historiqueOuvert === a.id && (
                  <div className="border-t border-bord/70 bg-surface-2/40 px-5 py-4">
                    <HistoriqueTarifs abonnement={a} tarifs={sesTarifs} onErreur={setErreur} onModifie={() => onModification?.()} />
                  </div>
                )}
              </Fragment>
            );
          })
        )}
      </Carte>
    </>
  );
}
