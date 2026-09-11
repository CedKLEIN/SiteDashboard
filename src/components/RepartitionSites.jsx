import { Bouton, SelecteurSites } from "./ui";
import { formatMontant, parseMontant } from "../lib/format";
import { repartir } from "../lib/repartition";

/**
 * Choix des sites concernes + repartition du montant entre eux.
 *
 * Deux modes: parts egales (par defaut) ou parts saisies a la main, pour le cas
 * ou un cout mutualise ne se partage pas moitie-moitie (un hebergement qui sert
 * surtout a un site, par exemple).
 */
export default function RepartitionSites({
  sites,
  selection,
  onBasculerSite,
  montantCents,
  parts,
  onChangerParts,
  aideVide,
}) {
  const sitesChoisis = selection
    .map((id) => sites.find((s) => s.id === id))
    .filter(Boolean);

  const partageable = selection.length > 1 && montantCents > 0;
  const manuel = parts !== null;

  function passerEnManuel() {
    const egales = repartir(montantCents, selection.length);
    onChangerParts(
      Object.fromEntries(selection.map((id, i) => [id, (egales[i] / 100).toFixed(2)])),
    );
  }

  const partsCents = manuel
    ? selection.map((id) => parseMontant(parts[id] ?? "") ?? 0)
    : [];
  const somme = partsCents.reduce((total, p) => total + p, 0);
  const ecart = somme - (montantCents ?? 0);

  const apercuEgal = partageable
    ? `reparti en ${repartir(montantCents, selection.length)
        .map((p) => formatMontant(p))
        .join(" + ")}`
    : aideVide;

  return (
    <div className="flex min-w-64 flex-col gap-2">
      <SelecteurSites
        label="Sites concernes"
        sites={sites}
        selection={selection}
        onBasculer={onBasculerSite}
        aide={manuel ? null : apercuEgal}
      />

      {partageable && !manuel && (
        <Bouton variante="fantome" className="self-start px-2 py-1 text-xs" onClick={passerEnManuel}>
          Repartir manuellement
        </Bouton>
      )}

      {partageable && manuel && (
        <div className="flex flex-col gap-2 rounded-lg border border-bord bg-surface-2/40 p-2.5">
          <div className="flex flex-wrap items-end gap-2">
            {sitesChoisis.map((site) => (
              <label key={site.id} className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-[11px] text-texte-doux">
                  <span className="size-2 rounded-full" style={{ background: site.couleur }} />
                  {site.nom}
                </span>
                <input
                  inputMode="decimal"
                  value={parts[site.id] ?? ""}
                  onChange={(e) => onChangerParts({ ...parts, [site.id]: e.target.value })}
                  className="w-24 rounded-lg border border-bord bg-surface px-2 py-1 text-sm text-texte outline-none focus:border-accent"
                />
              </label>
            ))}
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <span className={ecart === 0 ? "text-revenu" : "text-depense"}>
              total des parts : {formatMontant(somme)}
              {ecart !== 0 &&
                ` — il ${ecart > 0 ? "faut retirer" : "reste a repartir"} ${formatMontant(
                  Math.abs(ecart),
                )}`}
            </span>
            <Bouton
              variante="fantome"
              className="ml-auto px-2 py-0.5 text-[11px]"
              onClick={() => onChangerParts(null)}
            >
              Parts egales
            </Bouton>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Parts a transmettre a la couche de donnees: `null` en mode egal (la
 * repartition sera calculee la-bas), sinon le tableau ordonne comme `selection`.
 */
export function partsCentsDepuisSaisie(selection, parts) {
  if (parts === null) return null;
  return selection.map((id) => parseMontant(parts[id] ?? "") ?? 0);
}
