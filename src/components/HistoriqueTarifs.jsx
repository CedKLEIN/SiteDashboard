import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Bouton, Champ } from "./ui";
import { ajouterTarif, majTarif, supprimerTarif } from "../lib/queries";
import { aujourdhuiIso, formatMontant, parseMontant } from "../lib/format";

/** Un tarif vierge, date du jour : calcule a chaque fois, l'appli peut rester ouverte des jours. */
function tarifVide() {
  return { debut: aujourdhuiIso(), montant: "" };
}

/**
 * Historique des tarifs d'un abonnement : correction, suppression et ajout
 * d'un nouveau prix a partir d'une date. `onModifie` est appele apres chaque
 * ecriture, `onErreur` recoit les messages de saisie ("" pour effacer).
 */
export default function HistoriqueTarifs({ abonnement, tarifs, onModifie, onErreur }) {
  const [nouveauTarif, setNouveauTarif] = useState(tarifVide);
  const [tarifEnEdition, setTarifEnEdition] = useState(null);

  async function enregistrerTarif() {
    onErreur("");
    const montantCents = parseMontant(nouveauTarif.montant);
    if (montantCents === null || montantCents <= 0) {
      onErreur("Nouveau tarif invalide.");
      return;
    }
    await ajouterTarif(abonnement.id, { debut: nouveauTarif.debut, montantCents });
    setNouveauTarif(tarifVide());
    await onModifie();
  }

  async function enregistrerCorrection() {
    onErreur("");
    const montantCents = parseMontant(tarifEnEdition.montant);
    if (montantCents === null || montantCents <= 0) {
      onErreur("Montant invalide.");
      return;
    }
    await majTarif(tarifEnEdition.id, { debut: tarifEnEdition.debut, montantCents });
    setTarifEnEdition(null);
    await onModifie();
  }

  async function retirerTarif(tarifId) {
    if (tarifs.length <= 1) {
      onErreur("Un abonnement doit garder au moins un tarif.");
      return;
    }
    await supprimerTarif(tarifId);
    await onModifie();
  }

  /**
   * Icone d'un fournisseur: on tente son site, et a defaut on ouvre le
   * selecteur de fichier.
   *
   * Sans ce repli, un fournisseur dont le site ne sert pas d'icone exploitable
   * etait un cul-de-sac: le message d'echec ne laissait rien a faire, alors que
   * la commande d'import existait deja pour les sites.
   */

  return (
    <>
      <p className="mb-2 text-xs font-medium text-texte-doux">
        Historique des tarifs — chaque ligne s&apos;applique a partir de sa
        date, les echeances anterieures gardent l&apos;ancien prix
      </p>
      <ul className="mb-3 flex flex-col gap-1">
        {tarifs.map((t) =>
          tarifEnEdition?.id === t.id ? (
            <li key={t.id} className="flex items-end gap-2 text-sm">
              <Champ
                label="A partir du"
                type="date"
                value={tarifEnEdition.debut}
                onChange={(e) =>
                  setTarifEnEdition((x) => ({ ...x, debut: e.target.value }))
                }
                className="w-40"
              />
              <Champ
                label="Montant"
                inputMode="decimal"
                value={tarifEnEdition.montant}
                onChange={(e) =>
                  setTarifEnEdition((x) => ({ ...x, montant: e.target.value }))
                }
                className="w-28"
              />
              <Bouton
                className="px-2 py-1 text-xs"
                onClick={enregistrerCorrection}
              >
                Corriger
              </Bouton>
              <Bouton
                variante="fantome"
                className="px-2 py-1 text-xs"
                onClick={() => setTarifEnEdition(null)}
              >
                Annuler
              </Bouton>
            </li>
          ) : (
            <li key={t.id} className="flex items-center gap-3 text-sm">
              <span className="w-24 tabular-nums text-texte-doux">
                {t.debut}
              </span>
              <span className="tabular-nums">
                {formatMontant(t.montant_cents, abonnement.devise)}
              </span>
              <Bouton
                variante="fantome"
                className="px-1.5 py-0.5"
                title="Corriger ce tarif"
                onClick={() =>
                  setTarifEnEdition({
                    id: t.id,
                    debut: t.debut,
                    montant: (t.montant_cents / 100).toFixed(2),
                  })
                }
              >
                <Pencil size={12} />
              </Bouton>
              <Bouton
                variante="danger"
                className="px-1.5 py-0.5"
                title="Supprimer ce tarif"
                onClick={() => retirerTarif(t.id)}
              >
                <Trash2 size={12} />
              </Bouton>
            </li>
          ),
        )}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <Champ
          label="A partir du"
          type="date"
          value={nouveauTarif.debut}
          onChange={(e) =>
            setNouveauTarif((t) => ({ ...t, debut: e.target.value }))
          }
          className="w-40"
        />
        <Champ
          label="Nouveau montant (€)"
          inputMode="decimal"
          placeholder="11,00"
          value={nouveauTarif.montant}
          onChange={(e) =>
            setNouveauTarif((t) => ({ ...t, montant: e.target.value }))
          }
          className="w-36"
        />
        <Bouton onClick={enregistrerTarif}>
          Ajouter ce tarif
        </Bouton>
      </div>
    </>
  );
}
