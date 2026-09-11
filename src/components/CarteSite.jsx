import { CircleAlert, CircleCheck, CircleDashed, CircleOff, CircleX } from "lucide-react";
import { couleurEtat, etatSite, iconeEtat, libelleEtat } from "../lib/statut";

const ICONES = {
  ok: CircleCheck,
  alerte: CircleAlert,
  ko: CircleX,
  inconnu: CircleDashed,
  aucun: CircleOff,
};

/** '2026-09-11 20:31:04' -> '20:31' */
function heure(horodatage) {
  if (!horodatage) return null;
  return String(horodatage).slice(11, 16);
}

export default function CarteSite({ site, onOuvrir }) {
  const etat = etatSite(site);
  const couleur = couleurEtat(etat);
  const Icone = ICONES[iconeEtat(etat)] ?? CircleDashed;

  return (
    <button
      type="button"
      onClick={() => onOuvrir(site.id)}
      title={`${site.nom} — ${libelleEtat(etat)}`}
      // Hauteur fixe et non carree: etirees sur toute la largeur, des cartes
      // carrees deviendraient enormes des qu'il n'y a que deux sites.
      className="group relative flex h-32 w-full flex-col justify-between overflow-hidden rounded-xl border border-bord bg-surface p-3 pl-4 text-left transition hover:border-accent hover:bg-surface-2"
    >
      {/*
        La couleur du site devient une barre laterale, pas une seconde pastille:
        deux ronds colores cote a cote se lisaient comme la meme information.
      */}
      <span
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: site.couleur }}
        aria-hidden="true"
      />

      <div className="flex items-start justify-between gap-2">
        {site.favicon ? (
          <img src={site.favicon} alt="" className="size-5 shrink-0 rounded" aria-hidden="true" />
        ) : (
          <span className="size-5 shrink-0" />
        )}
        {/* L'etat est porte par la FORME de l'icone, la couleur ne fait que la renforcer */}
        <Icone size={18} strokeWidth={2.25} style={{ color: couleur }} className="shrink-0" />
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-texte">{site.nom}</p>
        <p className="truncate text-[11px]" style={{ color: couleur }}>
          {libelleEtat(etat)}
        </p>
      </div>

      <div className="text-[11px] text-texte-doux">
        {site.latence_moyenne != null && etat !== "ko" && (
          <p className="tabular-nums">{Math.round(site.latence_moyenne)} ms</p>
        )}
        {site.derniere_verif && <p className="tabular-nums">verifie {heure(site.derniere_verif)}</p>}
      </div>
    </button>
  );
}
