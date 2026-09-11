import { couleurEtat, etatSite, libelleEtat } from "../lib/statut";

/** '2026-09-11 20:31:04' -> '20:31' */
function heure(horodatage) {
  if (!horodatage) return null;
  return String(horodatage).slice(11, 16);
}

export default function CarteSite({ site, onOuvrir }) {
  const etat = etatSite(site);
  const couleur = couleurEtat(etat);
  const enAlerte = etat === "ko" || etat === "partiel";

  return (
    <button
      type="button"
      onClick={() => onOuvrir(site.id)}
      title={`${site.nom} — ${libelleEtat(etat)}`}
      className="group flex aspect-square w-full flex-col justify-between rounded-xl border border-bord bg-surface p-3 text-left transition hover:border-accent hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="mt-0.5 size-3 shrink-0 rounded-full"
          style={{
            background: couleur,
            // Le halo n'apparait que sur les etats qui demandent une action:
            // un mur de pastilles vertes aureolees ne signalerait plus rien.
            boxShadow: enAlerte ? `0 0 0 4px ${couleur}33` : "none",
          }}
        />
        {site.favicon ? (
          <img
            src={site.favicon}
            alt=""
            className="size-5 shrink-0 rounded"
            // L'icone est decorative: le nom du site est juste en dessous
            aria-hidden="true"
          />
        ) : (
          <span
            className="size-2.5 shrink-0 rounded-full opacity-60"
            style={{ background: site.couleur }}
            title="Couleur du site"
          />
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-texte">{site.nom}</p>
        <p className="truncate text-[11px] text-texte-doux">{libelleEtat(etat)}</p>
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
